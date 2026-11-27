import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Montaje del recorrido completo contra la pila **local** de Supabase.
 *
 * El recorrido en modo demostración (`tests/e2e/happy-path.spec.ts`) prueba la
 * interfaz contra un repositorio en memoria. Este prueba lo mismo contra
 * Postgres, el bucket y Anthropic de verdad, que es donde aparecen los fallos
 * que la demostración no puede ver: una consulta que el esquema ya no admite,
 * un permiso retirado, un modelo que tarda más de lo que dura la función.
 *
 * Todo lo que crea es ficticio y se retira al terminar. El destino se comprueba
 * antes de escribir: si no es local, aborta.
 */

export interface DatosDePrueba {
  apiUrl: string;
  anonKey: string;
  serviceKey: string;
  institucion: string;
  estudiante: string;
  docenteId: string;
  correo: string;
  contrasena: string;
}

const ARCHIVO = join(tmpdir(), "acta-pro-e2e-local.json");

export function rutaDelMontaje() {
  return ARCHIVO;
}

export function leerMontaje(): DatosDePrueba {
  if (!existsSync(ARCHIVO)) {
    throw new Error("No hay montaje: ejecute la configuración global antes de las pruebas.");
  }
  return JSON.parse(readFileSync(ARCHIVO, "utf8")) as DatosDePrueba;
}

/** Lee la configuración de la pila local del propio CLI, no de un archivo. */
export function pilaLocal(): { apiUrl: string; anonKey: string; serviceKey: string } {
  // Playwright carga estos archivos como CommonJS, de modo que aquí no hay
  // `import.meta`: la ruta se resuelve desde la raíz del proyecto.
  const cli = resolve("node_modules/supabase/dist/supabase.js");
  const salida = execFileSync(process.execPath, [cli, "status", "-o", "env"], { encoding: "utf8" });
  const valores: Record<string, string> = {};
  for (const linea of salida.split(/\r?\n/)) {
    const encaje = /^([A-Z_]+)="?([^"]*)"?$/.exec(linea.trim());
    if (encaje) valores[encaje[1]] = encaje[2];
  }
  const apiUrl = valores.API_URL;
  if (!apiUrl) throw new Error("La pila local de Supabase no está en pie.");
  const host = new URL(apiUrl).hostname;
  if (!["127.0.0.1", "localhost", "::1", "0.0.0.0"].includes(host)) {
    throw new Error(`El destino ${host} no es local. Abortado.`);
  }
  return { apiUrl, anonKey: valores.ANON_KEY, serviceKey: valores.SERVICE_ROLE_KEY };
}

/** Variables del archivo local, para las claves de los servicios externos. */
export function clavesExternas(): Record<string, string> {
  const texto = readFileSync(".env.local", "utf8");
  return Object.fromEntries(
    texto
      .split(/\r?\n/)
      .filter((linea) => linea.includes("=") && !linea.trimStart().startsWith("#"))
      .map((linea) => [linea.slice(0, linea.indexOf("=")).trim(), linea.slice(linea.indexOf("=") + 1).trim()]),
  );
}

export async function montar(): Promise<DatosDePrueba> {
  const { apiUrl, anonKey, serviceKey } = pilaLocal();
  const admin = createClient(apiUrl, serviceKey, { auth: { persistSession: false } });

  const institucion = randomUUID();
  const estudiante = randomUUID();
  const representante = randomUUID();
  const correo = `recorrido-${randomUUID()}@test.invalid`;
  // Contraseña de una cuenta desechable, en una base local, generada aquí y
  // usada una vez. No corresponde a ninguna persona.
  const contrasena = randomBytes(18).toString("base64url");

  const creada = await admin.auth.admin.createUser({ email: correo, password: contrasena, email_confirm: true });
  if (creada.error || !creada.data.user) throw new Error(`cuenta: ${creada.error?.message}`);
  const docenteId = creada.data.user.id;

  const debe = async (etiqueta: string, promesa: PromiseLike<{ error: unknown }>) => {
    const { error } = await promesa;
    if (error) throw new Error(`${etiqueta}: ${(error as { message?: string }).message}`);
  };

  await debe("institución", admin.from("institutions").insert({ id: institucion, name: "Unidad Educativa de prueba" }));
  await debe(
    "perfil",
    admin.from("profiles").insert({
      id: docenteId,
      full_name: "Docente de prueba",
      email: correo,
      role: "teacher",
      institution_id: institucion,
    }),
  );
  await debe(
    "estudiante",
    admin.from("students").insert({
      id: estudiante,
      institution_id: institucion,
      full_name: "Alumna Ficticia Ejemplo",
      grade: "8vo",
      section: "B",
    }),
  );
  await debe(
    "representante",
    admin.from("representatives").insert({
      id: representante,
      full_name: "Madre Ficticia Ejemplo",
      email: `madre-${representante}@test.invalid`,
    }),
  );
  await debe(
    "vínculo",
    admin
      .from("student_representatives")
      .insert({ student_id: estudiante, representative_id: representante, relationship: "madre" }),
  );

  const datos: DatosDePrueba = {
    apiUrl,
    anonKey,
    serviceKey,
    institucion,
    estudiante,
    docenteId,
    correo,
    contrasena,
  };
  writeFileSync(ARCHIVO, JSON.stringify(datos), { mode: 0o600 });
  return datos;
}

/**
 * Siembra la transcripción directamente en la base.
 *
 * El recorrido no puede hablar por un micrófono, y con `DEMO_MODE=false` el
 * botón de transcripción de demostración está desactivado a propósito. Esta es
 * la forma honesta de incorporar una transcripción sin fingir que se grabó:
 * se escribe en la base y se deja constancia de que ese paso no pasó por la
 * interfaz.
 */
export async function sembrarTranscripcion(reunion: string) {
  const { apiUrl, serviceKey } = pilaLocal();
  const admin: SupabaseClient = createClient(apiUrl, serviceKey, { auth: { persistSession: false } });

  const intervenciones = [
    ["Hablante 1", "Buenas tardes, gracias por venir. Quería conversar sobre el avance de la estudiante este quimestre."],
    ["Hablante 2", "Gracias a usted. En casa hemos notado que le cuesta concentrarse por las tardes."],
    ["Hablante 1", "En matemáticas ha mejorado de forma sostenida, sobre todo en la resolución de problemas con fracciones."],
    ["Hablante 2", "Establecimos una rutina de estudio de cuarenta minutos antes de cualquier actividad recreativa."],
    ["Hablante 1", "Persiste una dificultad con la comprensión lectora de textos largos cuando debe inferir información."],
    ["Hablante 2", "Me comprometo a revisar la agenda escolar todos los días y firmar las comunicaciones."],
    ["Hablante 1", "Acordamos que enviaré un reporte quincenal de avances al correo institucional de la representante."],
    ["Hablante 2", "Perfecto. ¿Hay algo más que debamos reforzar desde casa?"],
    ["Hablante 1", "La convivencia con sus compañeros ha mejorado notablemente desde el cambio de ubicación en el aula."],
  ];

  let segundo = 0;
  const filas = intervenciones.map(([hablante, texto]) => {
    const fila = {
      id: randomUUID(),
      meeting_id: reunion,
      speaker_label: hablante,
      start_seconds: segundo,
      end_seconds: segundo + 25,
      text: texto,
      confidence: 0.94,
      is_final: true,
    };
    segundo += 25;
    return fila;
  });

  const { error } = await admin.from("transcript_segments").insert(filas);
  if (error) throw new Error(`transcripción: ${error.message}`);

  // La máquina de estados no admite `ready -> processing` de un salto, y hace
  // bien: entre medias está la grabación. Se recorre el camino legítimo, que es
  // el que haría la interfaz si hubiera un micrófono.
  const { data: actual } = await admin.from("meetings").select("status").eq("id", reunion).single();
  const camino: Record<string, string[]> = {
    ready: ["recording", "processing"],
    recording: ["processing"],
    processing: [],
    draft: [],
  };
  const pasos = camino[(actual?.status as string) ?? ""];
  if (pasos === undefined) {
    throw new Error(`estado inesperado para sembrar la transcripción: ${actual?.status}`);
  }
  for (const paso of pasos) {
    const transicion = await admin.from("meetings").update({ status: paso }).eq("id", reunion);
    if (transicion.error) throw new Error(`estado ${paso}: ${transicion.error.message}`);
  }

  return filas.length;
}

export async function desmontar() {
  if (!existsSync(ARCHIVO)) return;
  const datos = leerMontaje();
  const admin = createClient(datos.apiUrl, datos.serviceKey, { auth: { persistSession: false } });

  const { data: reuniones } = await admin.from("meetings").select("id").eq("institution_id", datos.institucion);
  const ids = (reuniones ?? []).map((fila) => fila.id as string);

  for (const reunion of ids) {
    const { data: documentos } = await admin.from("documents").select("storage_path").eq("meeting_id", reunion);
    for (const documento of documentos ?? []) {
      await admin.storage.from("acta-documents").remove([documento.storage_path as string]);
    }
    await admin.from("documents").delete().eq("meeting_id", reunion);
    // Reabrir antes de borrar: las guardas de finalización vigilan el DELETE
    // sobre actas y firmas, y reabrir es el camino que el sistema reconoce.
    await admin.from("meetings").update({ status: "draft" }).eq("id", reunion);
    await admin.from("signatures").delete().in(
      "minutes_id",
      ((await admin.from("minutes").select("id").eq("meeting_id", reunion)).data ?? []).map((m) => m.id as string),
    );
    await admin.from("minutes").delete().eq("meeting_id", reunion);
    await admin.from("transcript_segments").delete().eq("meeting_id", reunion);
    await admin.from("meeting_participants").delete().eq("meeting_id", reunion);
    await admin.from("commitment_tracking").delete().eq("meeting_id", reunion);
  }

  await admin.from("audit_logs").delete().eq("institution_id", datos.institucion);
  await admin.from("meetings").delete().eq("institution_id", datos.institucion);
  await admin.from("student_representatives").delete().eq("student_id", datos.estudiante);
  await admin.from("students").delete().eq("institution_id", datos.institucion);
  await admin.from("profiles").delete().eq("institution_id", datos.institucion);
  await admin.from("institutions").delete().eq("id", datos.institucion);
  await admin.auth.admin.deleteUser(datos.docenteId);

  rmSync(ARCHIVO, { force: true });
}
