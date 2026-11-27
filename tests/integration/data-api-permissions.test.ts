import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  adminClient,
  anonClient,
  cleanupFixture,
  createApprovedMeeting,
  fixtureIds,
  signedInClient,
  sqlScalar,
  type Fixture,
} from "./local-stack";

/**
 * Permisos efectivos, vistos desde los dos lados.
 *
 * Conviene no mezclar dos preguntas distintas:
 *
 *  1. Qué tiene **concedido** un rol en PostgreSQL. Es lo que decide qué puede
 *     hacer cualquier vía de acceso a la base, no solo la API de datos.
 *  2. Qué es **alcanzable** a través de la API de datos de Supabase, que es
 *     por donde entra la aplicación y por donde entraría quien tuviera una
 *     clave anónima.
 *
 * La segunda es más estrecha que la primera: `TRUNCATE`, por ejemplo, no tiene
 * ninguna forma de expresarse en la API de datos. Eso no lo hacía inofensivo,
 * porque la primera pregunta seguía respondiendo que sí, y `TRUNCATE` no pasa
 * por RLS. Por eso aquí se comprueban las dos.
 */

const TABLES = [
  "institutions",
  "profiles",
  "students",
  "representatives",
  "meetings",
  "meeting_participants",
  "transcript_segments",
  "minutes",
  "signatures",
  "documents",
  "audit_logs",
  "google_credentials",
];

describe("permisos concedidos en PostgreSQL", () => {
  it("anon no tiene ningún privilegio sobre las tablas de la aplicación", () => {
    const granted = sqlScalar(`
      SELECT coalesce(string_agg(DISTINCT table_name || ':' || privilege_type, ', '), '')
      FROM information_schema.role_table_grants
      WHERE grantee = 'anon' AND table_schema = 'public';
    `);
    expect(granted).toBe("");
  });

  it("authenticated no puede vaciar ninguna tabla", () => {
    const truncatable = sqlScalar(`
      SELECT coalesce(string_agg(c.relname, ', '), '')
      FROM pg_class c
      WHERE c.relnamespace = 'public'::regnamespace
        AND c.relkind = 'r'
        AND has_table_privilege('authenticated', c.oid, 'TRUNCATE');
    `);
    expect(truncatable).toBe("");
  });

  it("authenticated no puede alterar ni borrar la auditoría", () => {
    expect(sqlScalar(`SELECT has_table_privilege('authenticated','public.audit_logs','UPDATE');`)).toBe(
      "f",
    );
    expect(sqlScalar(`SELECT has_table_privilege('authenticated','public.audit_logs','DELETE');`)).toBe(
      "f",
    );
  });

  it("las credenciales de Google son solo del rol de servicio", () => {
    for (const role of ["anon", "authenticated"]) {
      for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
        expect(
          sqlScalar(`SELECT has_table_privilege('${role}','public.google_credentials','${privilege}');`),
        ).toBe("f");
      }
    }
  });

  it("todas las tablas de la aplicación tienen RLS activo", () => {
    const sinRls = sqlScalar(`
      SELECT coalesce(string_agg(c.relname, ', '), '')
      FROM pg_class c
      WHERE c.relnamespace = 'public'::regnamespace
        AND c.relkind = 'r'
        AND NOT c.relrowsecurity;
    `);
    expect(sinRls).toBe("");
  });

  it("las funciones con SECURITY DEFINER fijan su search_path", () => {
    // Una función definer sin `search_path` fijo puede ser desviada creando
    // objetos con el mismo nombre en un esquema que el llamante controle.
    const sinSearchPath = sqlScalar(`
      SELECT coalesce(string_agg(n.nspname || '.' || p.proname, ', '), '')
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('public', 'acta_private')
        AND p.prosecdef
        AND NOT EXISTS (
          SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) AS cfg
          WHERE cfg LIKE 'search_path=%'
        );
    `);
    expect(sinSearchPath).toBe("");
  });
});

describe("superficie alcanzable por la API de datos", () => {
  const ids = fixtureIds();
  const otherIds = fixtureIds();
  let fixture: Fixture;
  let admin: SupabaseClient;
  let user: SupabaseClient;
  let anon: SupabaseClient;
  let documentId: string;

  beforeAll(async () => {
    admin = adminClient();
    anon = anonClient();

    const signedIn = await signedInClient(ids.email);
    user = signedIn.client;
    fixture = await createApprovedMeeting(admin, ids, signedIn.userId);

    const otherTeacher = await signedInClient(otherIds.email);
    await createApprovedMeeting(admin, otherIds, otherTeacher.userId);

    const inserted = await admin
      .from("documents")
      .insert({
        minutes_id: ids.minutes,
        meeting_id: ids.meeting,
        storage_path: `${ids.institution}/${ids.student}/permisos.pdf`,
        sha256: "a".repeat(64),
        document_code: "ACTA-2026-PERM0001-v1",
        version: 1,
        generation_fingerprint: "b".repeat(64),
        kind: "final",
      })
      .select("id")
      .single();
    if (inserted.error) throw new Error(inserted.error.message);
    documentId = inserted.data.id as string;
  }, 120_000);

  afterAll(() => {
    cleanupFixture(ids);
    cleanupFixture(otherIds);
  }, 120_000);

  it("una sesión anónima no lee ninguna tabla", async () => {
    for (const table of TABLES) {
      const { data, error } = await anon.from(table).select("*").limit(1);
      const vacio = !error && Array.isArray(data) && data.length === 0;
      expect(error !== null || vacio, `anon pudo leer ${table}`).toBe(true);
    }
  });

  it("una sesión anónima no escribe en ninguna tabla", async () => {
    const { error: enReuniones } = await anon.from("meetings").insert({
      id: randomUUID(),
      institution_id: ids.institution,
      teacher_id: fixture.teacherId,
      student_id: ids.student,
      title: "Intrusa",
      status: "ready",
    });
    expect(enReuniones).not.toBeNull();

    const { error: enAuditoria } = await anon.from("audit_logs").insert({
      institution_id: ids.institution,
      actor_id: fixture.teacherId,
      meeting_id: ids.meeting,
      action: "meeting.created",
    });
    expect(enAuditoria).not.toBeNull();
  });

  it("una sesión anónima no puede invocar la firma", async () => {
    const { error } = await anon.rpc("sign_minutes_verified", {
      p_minutes_id: ids.minutes,
      p_signatures: [
        { signer_role: "teacher", signer_name: "X", signature_path: "data:image/png;base64,AA" },
      ],
      p_acceptance_text_version: "v1",
    });
    expect(error).not.toBeNull();
  });

  it("la docente ve su reunión y no la de otra institución", async () => {
    const propia = await user.from("meetings").select("id").eq("id", ids.meeting);
    expect(propia.error).toBeNull();
    expect(propia.data).toHaveLength(1);

    const ajena = await user.from("meetings").select("id").eq("id", otherIds.meeting);
    expect(ajena.error).toBeNull();
    expect(ajena.data).toHaveLength(0);
  });

  it("la docente no puede escribir firmas por la vía directa", async () => {
    const { error } = await user.from("signatures").insert({
      minutes_id: ids.minutes,
      signer_name: "Docente",
      signer_role: "teacher",
      signature_path: "data:image/png;base64,AA",
      acceptance_text_version: "v1",
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/permission denied/i);
  });

  it("la docente no puede ascenderse a administradora", async () => {
    const { error } = await user
      .from("profiles")
      .update({ role: "admin" })
      .eq("id", fixture.teacherId);
    expect(error).not.toBeNull();
  });

  it("la docente no puede borrar un documento", async () => {
    const { error } = await user.from("documents").delete().eq("id", documentId);
    // Sin política de DELETE, RLS no lanza: simplemente no alcanza la fila. Lo
    // que importa es que la fila siga ahí.
    expect(error).toBeNull();

    const { data } = await admin.from("documents").select("id").eq("id", documentId);
    expect(data).toHaveLength(1);
  });

  it("la docente no puede alterar un documento ya registrado", async () => {
    const { error } = await user
      .from("documents")
      .update({ sha256: "c".repeat(64) })
      .eq("id", documentId);
    expect(error).not.toBeNull();
  });

  it("la docente puede firmar por la vía transaccional", async () => {
    sqlScalar(readFileSync("tests/integration/signing-fixture.sql","utf8") + `\nSELECT pg_temp.prepare_signing_fixture('${ids.minutes}','Representante');`);
    const { data, error } = await user.rpc("sign_minutes_verified", {
      p_minutes_id: ids.minutes,
      p_signatures: [
        {
          signer_role: "teacher",
          signer_name: "Docente de integración",
          signature_path: "data:image/png;base64,AA",
        },
        {
          signer_role: "representative",
          signer_name: "Representante",
          signature_path: "data:image/png;base64,BB",
        },
      ],
      p_acceptance_text_version: "v1",
    });

    expect(error).toBeNull();
    expect((data as { already_signed: boolean }).already_signed).toBe(false);

    const { data: reunion } = await user.from("meetings").select("status").eq("id", ids.meeting);
    expect(reunion?.[0]?.status).toBe("signed");
  });

  it("no puede firmar el acta de otra institución", async () => {
    const { error } = await user.rpc("sign_minutes_verified", {
      p_minutes_id: otherIds.minutes,
      p_signatures: [
        { signer_role: "teacher", signer_name: "X", signature_path: "data:image/png;base64,AA" },
      ],
      p_acceptance_text_version: "v1",
    });
    expect(error).not.toBeNull();
  });
});
