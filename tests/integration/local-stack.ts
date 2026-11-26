import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Acceso al stack **local** de Supabase para las pruebas de integración.
 *
 * Estas pruebas no se omiten solas si falta algo: fallan. Una prueba que se
 * salta en silencio informa de un éxito que nadie comprobó, y ese fue
 * exactamente el problema que tenían las pruebas smoke antes.
 *
 * Las claves se leen de `supabase status`, nunca de `.env.local`: son las de
 * demostración del stack local, públicas y documentadas por Supabase, y asi no
 * hay manera de que una prueba acabe apuntando al proyecto remoto.
 */

export interface LocalStack {
  apiUrl: string;
  anonKey: string;
  serviceKey: string;
}

let cached: LocalStack | null = null;

/** Comprobacion explicita de destino: solo direcciones de esta maquina. */
function assertLocal(apiUrl: string) {
  const host = new URL(apiUrl).hostname;
  if (!["127.0.0.1", "localhost", "::1", "0.0.0.0"].includes(host)) {
    throw new Error(`El destino ${host} no es local. Abortado.`);
  }
}

export function localStack(): LocalStack {
  if (cached) return cached;

  // Permite apuntar a otra pila local -por ejemplo la desechable de la
  // validacion de instalacion limpia- sin tocar el proyecto. Se exige el
  // conjunto completo para que no se mezclen a medias dos pilas distintas.
  const override = process.env.ACTA_TEST_API_URL;
  if (override) {
    const anonKey = process.env.ACTA_TEST_ANON_KEY;
    const serviceKey = process.env.ACTA_TEST_SERVICE_KEY;
    if (!anonKey || !serviceKey) {
      throw new Error(
        "ACTA_TEST_API_URL requiere tambien ACTA_TEST_ANON_KEY y ACTA_TEST_SERVICE_KEY.",
      );
    }
    cached = { apiUrl: override, anonKey, serviceKey };
    assertLocal(cached.apiUrl);
    return cached;
  }

  let raw: string;
  try {
    // Se invoca el CLI con el propio Node, no a través de `npx`: en Windows el
    // ejecutable sería un `.cmd` y lanzarlo exigiría un intérprete de órdenes
    // por medio, con los argumentos solo concatenados.
    raw = execFileSync(
      process.execPath,
      [fileURLToPath(import.meta.resolve("supabase/dist/supabase.js")), "status", "-o", "json"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (error) {
    throw new Error(
      "El stack local de Supabase no responde. Estas pruebas lo necesitan: " +
        "ejecute `npx supabase start`. " +
        String((error as { message?: string }).message ?? "").slice(0, 120),
    );
  }

  // `supabase status` puede imprimir avisos antes del JSON.
  const start = raw.indexOf("{");
  if (start < 0) throw new Error("No se pudo interpretar la salida de `supabase status`.");
  const status = JSON.parse(raw.slice(start)) as Record<string, string>;

  const apiUrl = status.API_URL;
  const anonKey = status.ANON_KEY;
  const serviceKey = status.SERVICE_ROLE_KEY;

  if (!apiUrl || !anonKey || !serviceKey) {
    throw new Error("`supabase status` no devolvió la URL y las claves del stack local.");
  }

  assertLocal(apiUrl);

  cached = { apiUrl, anonKey, serviceKey };
  return cached;
}

export function adminClient(): SupabaseClient {
  const { apiUrl, serviceKey } = localStack();
  return createClient(apiUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function anonClient(): SupabaseClient {
  const { apiUrl, anonKey } = localStack();
  return createClient(apiUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Crea una cuenta de prueba en el stack local y devuelve un cliente con su
 * sesión. La contraseña se genera aquí, se usa una vez y no se imprime.
 */
export async function signedInClient(email: string): Promise<{
  client: SupabaseClient;
  userId: string;
}> {
  const admin = adminClient();
  const password = randomBytes(24).toString("base64url");

  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    throw new Error(`No se pudo crear la cuenta de prueba: ${created.error?.message}`);
  }

  const { apiUrl, anonKey } = localStack();
  const client = createClient(apiUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) {
    throw new Error(`No se pudo iniciar sesión de prueba: ${signedIn.error.message}`);
  }

  return { client, userId: created.data.user.id };
}

/** Identificadores propios de cada ejecución, para que no se pisen entre sí. */
export function fixtureIds() {
  return {
    institution: randomUUID(),
    student: randomUUID(),
    meeting: randomUUID(),
    minutes: randomUUID(),
    email: `integracion-${randomUUID()}@test.invalid`,
  };
}

export interface Fixture extends ReturnType<typeof fixtureIds> {
  teacherId: string;
}

/**
 * Monta una reunión aprobada con su acta, por el camino legítimo: la reunión
 * nace en `ready` y sube por la máquina de estados, porque las guardas de la
 * base la vigilan incluso para el rol de servicio.
 */
export async function createApprovedMeeting(
  admin: SupabaseClient,
  ids: ReturnType<typeof fixtureIds>,
  teacherId: string,
): Promise<Fixture> {
  const must = async <T>(label: string, promise: PromiseLike<{ error: unknown; data?: T }>) => {
    const { error } = await promise;
    if (error) throw new Error(`${label}: ${(error as { message?: string }).message}`);
  };

  await must(
    "institución",
    admin.from("institutions").insert({ id: ids.institution, name: "Institución de integración" }),
  );
  await must(
    "perfil",
    admin.from("profiles").insert({
      id: teacherId,
      full_name: "Docente de integración",
      email: ids.email,
      role: "teacher",
      institution_id: ids.institution,
    }),
  );
  await must(
    "estudiante",
    admin.from("students").insert({
      id: ids.student,
      institution_id: ids.institution,
      full_name: "Alumna de integración",
      grade: "7mo",
      section: "A",
    }),
  );
  await must(
    "reunión",
    admin.from("meetings").insert({
      id: ids.meeting,
      institution_id: ids.institution,
      teacher_id: teacherId,
      student_id: ids.student,
      title: "Reunión de integración",
      status: "ready",
    }),
  );

  for (const status of ["recording", "processing", "draft", "approved"]) {
    await must(`estado ${status}`, admin.from("meetings").update({ status }).eq("id", ids.meeting));
  }

  await must(
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

  return { ...ids, teacherId };
}

/**
 * Retira los datos de la prueba. Las actas y las firmas finalizadas no se
 * pueden borrar desde la aplicación, a propósito, así que la limpieza se hace
 * por SQL desactivando esas guardas: es el montaje de la prueba, no una
 * operación de la aplicación.
 */
export function cleanupFixture(ids: { institution: string; email: string }) {
  const container = execFileSync("docker", ["ps", "--format", "{{.Names}}"], { encoding: "utf8" })
    .split(/\r?\n/)
    .map((n) => n.trim())
    .find((n) => n.startsWith("supabase_db_"));

  if (!container) throw new Error("No se encontró el contenedor local de Postgres.");

  const sql = `
BEGIN;
ALTER TABLE public.signatures DISABLE TRIGGER protect_finalized_signatures_trigger;
ALTER TABLE public.minutes DISABLE TRIGGER protect_finalized_minutes_trigger;
DELETE FROM public.audit_logs WHERE institution_id = '${ids.institution}';
DELETE FROM public.meetings WHERE institution_id = '${ids.institution}';
DELETE FROM public.students WHERE institution_id = '${ids.institution}';
DELETE FROM public.profiles WHERE institution_id = '${ids.institution}';
DELETE FROM public.institutions WHERE id = '${ids.institution}';
DELETE FROM auth.users WHERE email = '${ids.email}';
ALTER TABLE public.signatures ENABLE TRIGGER protect_finalized_signatures_trigger;
ALTER TABLE public.minutes ENABLE TRIGGER protect_finalized_minutes_trigger;
COMMIT;
`;

  execFileSync(
    "docker",
    ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-f", "-"],
    { input: sql, encoding: "utf8" },
  );
}

export const DOCUMENTS_BUCKET = "acta-documents";

function localContainer() {
  const named = process.env.ACTA_DB_CONTAINER;
  if (named) {
    if (!named.startsWith("supabase_db_")) {
      throw new Error(`ACTA_DB_CONTAINER=${named} no es un contenedor de Supabase.`);
    }
    return named;
  }

  const container = execFileSync("docker", ["ps", "--format", "{{.Names}}"], { encoding: "utf8" })
    .split(/\r?\n/)
    .map((n) => n.trim())
    .find((n) => n.startsWith("supabase_db_"));
  if (!container) throw new Error("No se encontró el contenedor local de Postgres.");
  return container;
}

/**
 * Un valor leído directamente de Postgres, sin pasar por la API de datos.
 *
 * Existe para poder separar dos cosas que se confunden con facilidad: lo que un
 * rol tiene **concedido** en la base y lo que además es **alcanzable** a través
 * de la API de datos. Un privilegio que la API no expone sigue siendo un
 * privilegio, y cualquier otra vía de acceso lo encontraría ahí.
 */
export function sqlScalar(sql: string): string {
  return execFileSync(
    "docker",
    [
      "exec",
      "-i",
      localContainer(),
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-tAc",
      sql,
    ],
    { encoding: "utf8" },
  ).trim();
}
