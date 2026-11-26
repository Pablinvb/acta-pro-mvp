import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { SupabaseRepository } from "@/lib/data/supabase-repository";
import { sha256Hex } from "@/lib/pdf/render";
import type { Session } from "@/lib/session";

import {
  DOCUMENTS_BUCKET,
  adminClient,
  cleanupFixture,
  createApprovedMeeting,
  fixtureIds,
  signedInClient,
  type Fixture,
} from "./local-stack";

/**
 * Las rutas de documentos, ejecutadas de verdad contra Supabase local.
 *
 * Se invoca el manejador real -el mismo código que atiende la petición- con
 * una sesión ya resuelta. Lo único que se sustituye es la lectura de la cookie,
 * que pertenece al servidor de Next y no a lo que aquí se quiere comprobar: la
 * idempotencia, la integridad y el control de acceso, contra Postgres y el
 * bucket reales.
 */

const state = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("@/lib/session", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/session")>();
  return {
    ...original,
    requireApiSession: async () => {
      if (!state.session) throw new original.UnauthorizedError();
      return state.session;
    },
  };
});

const { POST: generate } = await import("@/app/api/documents/[minutesId]/pdf/route");
const { GET: download } = await import("@/app/api/documents/download/[documentId]/route");

const params = <T extends object>(value: T) => ({ params: Promise.resolve(value) });

describe("rutas de documentos contra Supabase local", () => {
  const ids = fixtureIds();
  const otherIds = fixtureIds();
  let fixture: Fixture;
  let admin: SupabaseClient;
  let repository: SupabaseRepository;
  let documentId: string;
  let storagePath: string;
  let fileHash: string;

  beforeAll(async () => {
    admin = adminClient();

    const signedIn = await signedInClient(ids.email);
    fixture = await createApprovedMeeting(admin, ids, signedIn.userId);
    repository = new SupabaseRepository(signedIn.client, admin);

    // Una segunda institución, con su propia docente, para comprobar que el
    // aislamiento no depende de que la interfaz oculte el enlace.
    const otherTeacher = await signedInClient(otherIds.email);
    await createApprovedMeeting(admin, otherIds, otherTeacher.userId);

    const profile = await repository.getProfile(signedIn.userId);
    const institution = await repository.getInstitution(ids.institution);
    if (!profile || !institution) throw new Error("No se pudo montar la sesión de prueba.");

    state.session = { profile, institution, mode: "supabase", repository };
  }, 120_000);

  afterAll(async () => {
    if (storagePath) await admin.storage.from(DOCUMENTS_BUCKET).remove([storagePath]);
    cleanupFixture(ids);
    cleanupFixture(otherIds);
  }, 120_000);

  it("genera el documento y lo deja verificable", async () => {
    const response = await generate(new Request("http://local/pdf", { method: "POST" }), params({
      minutesId: fixture.minutes,
    }));
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.reused).toBe(false);
    expect(body.kind).toBe("final");
    expect(body.sha256).toMatch(/^[a-f0-9]{64}$/);

    documentId = body.documentId;
    fileHash = body.sha256;

    const record = await repository.getDocument(documentId);
    expect(record).not.toBeNull();
    storagePath = record!.storage_path;

    const bytes = await repository.getDocumentFile(storagePath);
    expect(bytes).not.toBeNull();
    expect(sha256Hex(bytes!)).toBe(fileHash);
  });

  it("repetir la solicitud devuelve el mismo documento, no uno nuevo", async () => {
    const response = await generate(new Request("http://local/pdf", { method: "POST" }), params({
      minutesId: fixture.minutes,
    }));
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.reused).toBe(true);
    expect(body.documentId).toBe(documentId);
    expect(body.sha256).toBe(fileHash);

    const { count } = await admin
      .from("documents")
      .select("id", { count: "exact", head: true })
      .eq("minutes_id", fixture.minutes);
    expect(count).toBe(1);
  });

  it("la reutilización no vuelve a anotar la generación en la auditoría", async () => {
    const { count } = await admin
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .eq("meeting_id", fixture.meeting)
      .eq("action", "document.generated");
    expect(count).toBe(1);
  });

  it("la descarga entrega el PDF y comprueba su hash", async () => {
    const response = await download(
      new Request(`http://local/download/${documentId}`),
      params({ documentId }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("cache-control")).toBe("private, no-store");

    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(sha256Hex(bytes)).toBe(fileHash);
  });

  it("no entrega un acta de otra institución", async () => {
    const response = await generate(new Request("http://local/pdf", { method: "POST" }), params({
      minutesId: otherIds.minutes,
    }));
    expect([401, 403, 404]).toContain(response.status);
  });

  it("sin sesión no se genera nada", async () => {
    const saved = state.session;
    state.session = null;
    try {
      const response = await generate(new Request("http://local/pdf", { method: "POST" }), params({
        minutesId: fixture.minutes,
      }));
      expect(response.status).toBe(401);
    } finally {
      state.session = saved;
    }
  });

  // Los dos últimos casos alteran el archivo almacenado a propósito, así que
  // van al final: lo que comprueban es que un documento manipulado deja de
  // pasar por válido, ni al descargarlo ni al volver a generarlo.

  it("detecta que el archivo almacenado fue manipulado", async () => {
    const { error } = await admin.storage
      .from(DOCUMENTS_BUCKET)
      .upload(storagePath, new Uint8Array([37, 80, 68, 70, 0, 0, 0, 1]), {
        contentType: "application/pdf",
        upsert: true,
      });
    expect(error).toBeNull();

    const response = await download(
      new Request(`http://local/download/${documentId}`),
      params({ documentId }),
    );
    expect(response.status).toBe(409);

    const regenerated = await generate(
      new Request("http://local/pdf", { method: "POST" }),
      params({ minutesId: fixture.minutes }),
    );
    expect(regenerated.status).toBe(409);
  });

  it("no reutiliza un documento cuyo archivo ha desaparecido", async () => {
    await admin.storage.from(DOCUMENTS_BUCKET).remove([storagePath]);

    const response = await generate(new Request("http://local/pdf", { method: "POST" }), params({
      minutesId: fixture.minutes,
    }));
    expect(response.status).toBe(409);

    const body = await response.json();
    expect(String(body.error ?? body.message ?? "")).toMatch(/no se encuentra|almacenamiento/i);

    // Y el registro sigue intacto: no se borra la evidencia porque falte el
    // archivo, se informa.
    const record = await repository.getDocument(documentId);
    expect(record?.id).toBe(documentId);
  });

  it("el identificador de documento inexistente no revela nada", async () => {
    const response = await download(
      new Request("http://local/download/x"),
      params({ documentId: randomUUID() }),
    );
    expect(response.status).toBe(404);
  });
});
