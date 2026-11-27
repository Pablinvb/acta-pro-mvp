import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { SupabaseRepository } from "@/lib/data/supabase-repository";
import { sha256Hex } from "@/lib/pdf/render";
import type { Session } from "@/lib/session";

/**
 * Verificación del proyecto **remoto** tras aplicar el historial completo.
 *
 * Lo que se comprueba aquí es lo que no se puede comprobar de otro modo: que
 * las guardas, los permisos y las rutas reales se comportan sobre la base de
 * producción igual que sobre la local. Se ejecuta el manejador real de cada
 * ruta; lo único sustituido es la lectura de la cookie de sesión, que pertenece
 * al servidor de Next.
 *
 * **Lo que no se hace aquí, a propósito: firmar un acta.** Desde `signed` la
 * única transición permitida es `sent`, y las guardas de finalización vigilan
 * también el `DELETE`. Una firma de prueba quedaría para siempre en la base de
 * la institución, con su estudiante y su reunión inventados, y en el remoto no
 * hay forma de desactivar un trigger para retirarla. Que la firma atómica
 * funciona está demostrado sobre la base local, cuyo esquema y cuyos permisos
 * son hoy idénticos a los del remoto. Aquí se comprueba el rechazo, que no
 * deja nada.
 *
 * Exige optar explícitamente: `ACTA_VERIFY_REMOTE` ha de coincidir con la
 * referencia del proyecto que indica `.env.local`, o valer `local` para
 * ensayarlo contra la pila local antes de tocar el remoto.
 *
 *   ACTA_VERIFY_REMOTE=<referencia> npx vitest run -c vitest.remote.config.mts
 */

function entorno(): Record<string, string> {
  const texto = readFileSync(".env.local", "utf8");
  const pares = texto
    .split(/\r?\n/)
    .filter((linea) => linea.includes("=") && !linea.trimStart().startsWith("#"))
    .map((linea) => [linea.slice(0, linea.indexOf("=")).trim(), linea.slice(linea.indexOf("=") + 1).trim()]);
  return Object.fromEntries(pares);
}

const env = entorno();
const apiUrl = process.env.ACTA_TEST_API_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.ACTA_TEST_ANON_KEY ?? env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const serviceKey = process.env.ACTA_TEST_SERVICE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
const DOCUMENTS_BUCKET = "acta-documents";

const host = new URL(apiUrl).hostname;
const esLocal = ["127.0.0.1", "localhost", "::1", "0.0.0.0"].includes(host);
const referencia = host.split(".")[0];
const pedido = process.env.ACTA_VERIFY_REMOTE;

if (!pedido) {
  throw new Error(
    "Falta ACTA_VERIFY_REMOTE. Indique la referencia del proyecto remoto, o 'local' para ensayar contra la pila local.",
  );
}
if (esLocal && pedido !== "local") {
  throw new Error(`El destino es local (${host}) y ACTA_VERIFY_REMOTE pide ${pedido}. Abortado.`);
}
if (!esLocal && pedido !== referencia) {
  throw new Error(`El destino es ${referencia} y ACTA_VERIFY_REMOTE pide ${pedido}. Abortado.`);
}

const sinSesion = { auth: { persistSession: false, autoRefreshToken: false } };
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

const { POST: generar } = await import("@/app/api/documents/[minutesId]/pdf/route");
const { GET: descargar } = await import("@/app/api/documents/download/[documentId]/route");
const parametros = <T extends object>(valor: T) => ({ params: Promise.resolve(valor) });

describe(`verificación del proyecto ${esLocal ? "local" : referencia}`, () => {
  const ids = {
    institution: randomUUID(),
    student: randomUUID(),
    meeting: randomUUID(),
    minutes: randomUUID(),
    email: `verificacion-${randomUUID()}@test.invalid`,
  };

  let admin: SupabaseClient;
  let docente: SupabaseClient;
  let docenteId = "";
  let repositorio: SupabaseRepository;
  let documentId = "";
  let storagePath = "";
  let hashArchivo = "";
  const inventarioPrevio: Record<string, number> = {};

  const TABLAS = [
    "institutions",
    "profiles",
    "students",
    "meetings",
    "minutes",
    "signatures",
    "documents",
    "audit_logs",
  ] as const;

  const contar = async (cliente: SupabaseClient, tabla: string) => {
    const { count } = await cliente.from(tabla).select("id", { count: "exact", head: true });
    return count ?? 0;
  };

  const debe = async (etiqueta: string, promesa: PromiseLike<{ error: unknown }>) => {
    const { error } = await promesa;
    if (error) throw new Error(`${etiqueta}: ${(error as { message?: string }).message}`);
  };

  beforeAll(async () => {
    admin = createClient(apiUrl, serviceKey, sinSesion);

    for (const tabla of TABLAS) inventarioPrevio[tabla] = await contar(admin, tabla);

    const clave = randomBytes(24).toString("base64url");
    const creada = await admin.auth.admin.createUser({
      email: ids.email,
      password: clave,
      email_confirm: true,
    });
    if (creada.error || !creada.data.user) {
      throw new Error(`No se pudo crear la cuenta de prueba: ${creada.error?.message}`);
    }
    docenteId = creada.data.user.id;

    docente = createClient(apiUrl, anonKey, sinSesion);
    const entrada = await docente.auth.signInWithPassword({ email: ids.email, password: clave });
    if (entrada.error) throw new Error(`No se pudo iniciar sesión: ${entrada.error.message}`);

    await debe(
      "institución",
      admin.from("institutions").insert({ id: ids.institution, name: "Institución de verificación" }),
    );
    await debe(
      "perfil",
      admin.from("profiles").insert({
        id: docenteId,
        full_name: "Docente de verificación",
        email: ids.email,
        role: "teacher",
        institution_id: ids.institution,
      }),
    );
    await debe(
      "estudiante",
      admin.from("students").insert({
        id: ids.student,
        institution_id: ids.institution,
        full_name: "Alumna de verificación",
        grade: "7mo",
        section: "A",
      }),
    );
    await debe(
      "reunión",
      admin.from("meetings").insert({
        id: ids.meeting,
        institution_id: ids.institution,
        teacher_id: docenteId,
        student_id: ids.student,
        title: "Reunión de verificación",
        status: "ready",
      }),
    );
    for (const status of ["recording", "processing", "draft", "approved"]) {
      await debe(`estado ${status}`, admin.from("meetings").update({ status }).eq("id", ids.meeting));
    }
    await debe(
      "acta",
      admin.from("minutes").insert({
        id: ids.minutes,
        meeting_id: ids.meeting,
        version: 1,
        status: "approved",
        summary: "Resumen del acuerdo alcanzado.",
        approved_at: new Date("2026-11-21T16:00:00.000Z").toISOString(),
        generator: "demo",
      }),
    );

    repositorio = new SupabaseRepository(docente, admin);
    const perfil = await repositorio.getProfile(docenteId);
    const institucion = await repositorio.getInstitution(ids.institution);
    if (!perfil || !institucion) throw new Error("No se pudo montar la sesión de verificación.");
    state.session = { profile: perfil, institution: institucion, mode: "supabase", repository: repositorio };
  }, 180_000);

  afterAll(async () => {
    // Se retira todo por el camino legítimo: primero se reabre la reunión, que
    // revoca la aprobación y descarta las firmas, y solo entonces el acta deja
    // de estar protegida y se puede borrar.
    if (storagePath) await admin.storage.from(DOCUMENTS_BUCKET).remove([storagePath]);
    await admin.from("documents").delete().eq("minutes_id", ids.minutes);
    await admin.from("meetings").update({ status: "draft" }).eq("id", ids.meeting);
    await admin.from("signatures").delete().eq("minutes_id", ids.minutes);
    await admin.from("minutes").delete().eq("id", ids.minutes);
    await admin.from("audit_logs").delete().eq("institution_id", ids.institution);
    await admin.from("meetings").delete().eq("id", ids.meeting);
    await admin.from("students").delete().eq("id", ids.student);
    await admin.from("profiles").delete().eq("id", docenteId);
    await admin.from("institutions").delete().eq("id", ids.institution);
    if (docenteId) await admin.auth.admin.deleteUser(docenteId);

    const restos: string[] = [];
    for (const tabla of TABLAS) {
      const ahora = await contar(admin, tabla);
      if (ahora !== inventarioPrevio[tabla]) {
        restos.push(`${tabla}: ${inventarioPrevio[tabla]} -> ${ahora}`);
      }
    }
    if (restos.length > 0) {
      throw new Error(`La verificación dejó residuo en la base: ${restos.join(", ")}`);
    }
  }, 180_000);

  it("el inicio de sesión funciona y entrega una sesión utilizable", async () => {
    const { data } = await docente.auth.getUser();
    expect(data.user?.id).toBe(docenteId);
    expect(data.user?.email).toBe(ids.email);
  });

  it("la clave publicable sin sesión no lee nada", async () => {
    const anonimo = createClient(apiUrl, anonKey, sinSesion);
    const { data, error } = await anonimo.from("meetings").select("id").limit(1);
    expect(error !== null || (data ?? []).length === 0).toBe(true);
  });

  it("una docente solo ve las reuniones de su institución", async () => {
    const { data } = await docente.from("meetings").select("id, institution_id");
    const ajenas = (data ?? []).filter((fila) => fila.institution_id !== ids.institution);
    expect(ajenas).toEqual([]);
    expect((data ?? []).length).toBe(1);
  });

  it("la escritura directa sobre firmas está revocada", async () => {
    const { error } = await docente.from("signatures").insert({
      minutes_id: ids.minutes,
      signer_role: "teacher",
      signer_name: "Intento directo",
      signature_path: "firmas/intento.png",
    });
    expect(error).not.toBeNull();
  });

  it("la auditoría no se puede alterar ni borrar", async () => {
    await debe(
      "huella de auditoría",
      admin.from("audit_logs").insert({
        institution_id: ids.institution,
        meeting_id: ids.meeting,
        actor_id: docenteId,
        action: "verification.probe",
      }),
    );
    const actualiza = await docente.from("audit_logs").update({ action: "otra" }).eq("meeting_id", ids.meeting);
    const borra = await docente.from("audit_logs").delete().eq("meeting_id", ids.meeting);
    expect(actualiza.error !== null || (actualiza.count ?? 0) === 0).toBe(true);
    expect(borra.error !== null || (borra.count ?? 0) === 0).toBe(true);
    const { count } = await admin
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .eq("meeting_id", ids.meeting)
      .eq("action", "verification.probe");
    expect(count).toBe(1);
  });

  it("las transiciones inválidas se rechazan en la base", async () => {
    const { error } = await admin.from("meetings").update({ status: "recording" }).eq("id", ids.meeting);
    expect(error).not.toBeNull();
  });

  it("la identidad de la reunión es inmutable", async () => {
    const { error } = await admin.from("meetings").update({ institution_id: randomUUID() }).eq("id", ids.meeting);
    expect(error).not.toBeNull();
  });

  it("no se puede finalizar una reunión sin las firmas obligatorias", async () => {
    const { error } = await admin.from("meetings").update({ status: "signed" }).eq("id", ids.meeting);
    expect(error).not.toBeNull();
    expect(String((error as { message?: string }).message)).toMatch(/signed|firma|approved/i);
  });

  it("la firma atómica está publicada y rechaza lo que no corresponde", async () => {
    const { error } = await docente.rpc("sign_minutes", {
      p_minutes_id: randomUUID(),
      p_signatures: [],
      p_acceptance_text_version: "v1",
    });
    expect(error).not.toBeNull();
  });

  it("genera el documento y lo deja verificable", async () => {
    const respuesta = await generar(
      new Request("http://verificacion/pdf", { method: "POST" }),
      parametros({ minutesId: ids.minutes }),
    );
    expect(respuesta.status).toBe(200);

    const cuerpo = await respuesta.json();
    expect(cuerpo.reused).toBe(false);
    expect(cuerpo.kind).toBe("final");
    expect(cuerpo.sha256).toMatch(/^[a-f0-9]{64}$/);

    documentId = cuerpo.documentId;
    hashArchivo = cuerpo.sha256;

    const registro = await repositorio.getDocument(documentId);
    expect(registro).not.toBeNull();
    storagePath = registro!.storage_path;

    const bytes = await repositorio.getDocumentFile(storagePath);
    expect(bytes).not.toBeNull();
    expect(sha256Hex(bytes!)).toBe(hashArchivo);
  });

  it("repetir la solicitud no crea un segundo documento", async () => {
    const respuesta = await generar(
      new Request("http://verificacion/pdf", { method: "POST" }),
      parametros({ minutesId: ids.minutes }),
    );
    expect(respuesta.status).toBe(200);

    const cuerpo = await respuesta.json();
    expect(cuerpo.reused).toBe(true);
    expect(cuerpo.documentId).toBe(documentId);
    expect(cuerpo.sha256).toBe(hashArchivo);

    const { count } = await admin
      .from("documents")
      .select("id", { count: "exact", head: true })
      .eq("minutes_id", ids.minutes);
    expect(count).toBe(1);
  });

  it("los metadatos del documento son inmutables", async () => {
    const { error } = await docente.from("documents").update({ sha256: "0".repeat(64) }).eq("id", documentId);
    expect(error).not.toBeNull();
  });

  it("la descarga entrega el PDF y comprueba su hash", async () => {
    const respuesta = await descargar(
      new Request(`http://verificacion/download/${documentId}`),
      parametros({ documentId }),
    );
    expect(respuesta.status).toBe(200);
    expect(respuesta.headers.get("content-type")).toBe("application/pdf");

    const bytes = Buffer.from(await respuesta.arrayBuffer());
    expect(sha256Hex(bytes)).toBe(hashArchivo);
  });

  it("el bucket de documentos no es público", async () => {
    const anonimo = createClient(apiUrl, anonKey, sinSesion);
    const { data, error } = await anonimo.storage.from(DOCUMENTS_BUCKET).download(storagePath);
    expect(error !== null || data === null).toBe(true);
  });

  it("los documentos históricos de la institución siguen íntegros", async () => {
    const { data } = await admin
      .from("documents")
      .select("id, storage_path, sha256")
      .neq("minutes_id", ids.minutes);
    for (const fila of data ?? []) {
      const descarga = await admin.storage.from(DOCUMENTS_BUCKET).download(fila.storage_path);
      expect(descarga.error).toBeNull();
      const bytes = Buffer.from(await descarga.data!.arrayBuffer());
      expect(sha256Hex(bytes)).toBe(fila.sha256);
    }
  });

  it("reabrir revoca la aprobación y descarta las firmas", async () => {
    await debe("reapertura", admin.from("meetings").update({ status: "draft" }).eq("id", ids.meeting));
    const { data } = await admin.from("minutes").select("status, approved_at").eq("id", ids.minutes).single();
    expect(data?.status).not.toBe("approved");
    const { count } = await admin
      .from("signatures")
      .select("id", { count: "exact", head: true })
      .eq("minutes_id", ids.minutes);
    expect(count).toBe(0);
  });
});
