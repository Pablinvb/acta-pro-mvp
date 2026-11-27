#!/usr/bin/env node
/**
 * Auditoría **de solo lectura** del proyecto remoto.
 *
 * Es el único guion de este repositorio que apunta al proyecto de producción, y
 * lo hace sin escribir nada: emite exclusivamente peticiones GET contra la API
 * de datos. No aplica migraciones, no borra registros y no modifica ajustes.
 *
 * Las credenciales se leen de `.env.local`, que está fuera del control de
 * versiones. No se imprime ninguna clave, ni completa ni parcial.
 *
 *   node scripts/audit-remote-readonly.mjs
 *
 * Lo que comprueba es si los datos que ya existen serían compatibles con las
 * restricciones que las migraciones pendientes introducen. Es la pregunta que
 * decide si esas migraciones se pueden aplicar sin pérdida, y conviene
 * responderla antes de tocar nada.
 */
import { readFileSync, writeFileSync } from "node:fs";

const findings = [];
const add = (area, titulo, detalle, bien) => findings.push({ area, titulo, detalle, bien });

function loadEnv() {
  const raw = readFileSync(".env.local", "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
    if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

async function main() {
  const env = loadEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local.");
  }

  const host = new URL(url).hostname;
  if (["127.0.0.1", "localhost", "::1", "0.0.0.0"].includes(host)) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL apunta a una dirección local. Esta auditoría es para el proyecto remoto.",
    );
  }

  // El identificador del proyecto se contrasta con el que el CLI tiene
  // vinculado, para no auditar por error otro proyecto.
  let linked = "";
  try {
    linked = readFileSync("supabase/.temp/project-ref", "utf8").trim();
  } catch {
    linked = "";
  }
  const ref = host.split(".")[0];
  if (linked && linked !== ref) {
    throw new Error(`El proyecto de .env.local (${ref}) no es el vinculado (${linked}). Abortado.`);
  }

  console.log(`Auditoría de solo lectura · proyecto ${ref}\n`);

  /** Única forma de acceso de este guion: GET. */
  const get = async (path) => {
    const response = await fetch(`${url}/rest/v1/${path}`, {
      method: "GET",
      headers: {
        apikey: key,
        authorization: `Bearer ${key}`,
        prefer: "count=exact",
        accept: "application/json",
      },
    });
    const total = Number(response.headers.get("content-range")?.split("/")[1] ?? NaN);
    const body = response.ok ? await response.json() : null;
    return { ok: response.ok, status: response.status, total, body };
  };

  // ------------------------------------------------------------- inventario

  const TABLES = [
    "institutions",
    "profiles",
    "students",
    "representatives",
    "student_representatives",
    "meetings",
    "meeting_participants",
    "transcript_segments",
    "minutes",
    "signatures",
    "documents",
    "audit_logs",
    "commitment_tracking",
    "google_credentials",
  ];

  const counts = {};
  for (const table of TABLES) {
    // `select=*` y no `select=id`: hay tablas sin columna `id` (clave
    // compuesta), y pedirla devolveria 400 y se leeria como inaccesible.
    const result = await get(`${table}?select=*&limit=1`);
    counts[table] = result.ok ? result.total : `inaccesible (${result.status})`;
  }
  add(
    "Inventario",
    "Registros por tabla",
    Object.entries(counts)
      .map(([t, n]) => `${t}=${n}`)
      .join(", "),
    true,
  );

  // --------------------------------------------- compatibilidad con las reglas

  const [meetings, profiles, students, minutes, signatures, documents] = await Promise.all([
    get("meetings?select=id,institution_id,teacher_id,student_id,status&limit=1000"),
    get("profiles?select=id,institution_id&limit=1000"),
    get("students?select=id,institution_id&limit=1000"),
    get("minutes?select=id,meeting_id,version,status&limit=1000"),
    get("signatures?select=id,minutes_id,signer_role&limit=1000"),
    get("documents?select=id,minutes_id,meeting_id,version,sha256&limit=1000"),
  ]);

  if (!meetings.ok) {
    add("Integridad", "No se pudieron leer las reuniones", `HTTP ${meetings.status}`, false);
  } else {
    const institucionDe = new Map();
    for (const p of profiles.body ?? []) institucionDe.set(`profile:${p.id}`, p.institution_id);
    for (const s of students.body ?? []) institucionDe.set(`student:${s.id}`, s.institution_id);

    // Las migraciones pendientes añaden claves foráneas compuestas que exigen
    // que docente y estudiante pertenezcan a la institución de la reunión. Si
    // algún registro existente no lo cumple, la migración fallaría.
    const cruzadas = (meetings.body ?? []).filter(
      (m) =>
        institucionDe.get(`profile:${m.teacher_id}`) !== m.institution_id ||
        institucionDe.get(`student:${m.student_id}`) !== m.institution_id,
    );
    add(
      "Integridad",
      "Reuniones con docente o estudiante de otra institución",
      cruzadas.length === 0 ? "ninguna" : cruzadas.map((m) => m.id).join(", "),
      cruzadas.length === 0,
    );

    // Finalizar exige un acta aprobada con las dos firmas obligatorias.
    const actasPorReunion = new Map();
    for (const a of minutes.body ?? []) {
      const previa = actasPorReunion.get(a.meeting_id);
      if (!previa || a.version > previa.version) actasPorReunion.set(a.meeting_id, a);
    }
    const rolesPorActa = new Map();
    for (const s of signatures.body ?? []) {
      if (!rolesPorActa.has(s.minutes_id)) rolesPorActa.set(s.minutes_id, new Set());
      rolesPorActa.get(s.minutes_id).add(s.signer_role);
    }

    const finalizadasSinFirmas = (meetings.body ?? [])
      .filter((m) => ["signed", "sent"].includes(m.status))
      .filter((m) => {
        const acta = actasPorReunion.get(m.id);
        if (!acta || acta.status !== "approved") return true;
        const roles = rolesPorActa.get(acta.id) ?? new Set();
        return !roles.has("teacher") || !roles.has("representative");
      });
    add(
      "Integridad",
      "Reuniones finalizadas sin las firmas obligatorias",
      finalizadasSinFirmas.length === 0 ? "ninguna" : finalizadasSinFirmas.map((m) => m.id).join(", "),
      finalizadasSinFirmas.length === 0,
    );

    // Unicidad de firma por rol.
    const duplicadas = [];
    const vistas = new Set();
    for (const s of signatures.body ?? []) {
      const clave = `${s.minutes_id}/${s.signer_role}`;
      if (vistas.has(clave)) duplicadas.push(clave);
      vistas.add(clave);
    }
    add(
      "Integridad",
      "Firmas duplicadas por rol en la misma acta",
      duplicadas.length === 0 ? "ninguna" : duplicadas.join(", "),
      duplicadas.length === 0,
    );

    // Formato del SHA-256 de los documentos.
    const malFormados = (documents.body ?? []).filter((d) => !/^[a-f0-9]{64}$/.test(d.sha256 ?? ""));
    add(
      "Integridad",
      "Documentos con SHA-256 de formato inválido",
      malFormados.length === 0 ? "ninguno" : malFormados.map((d) => d.id).join(", "),
      malFormados.length === 0,
    );

    // Referencia documental compuesta (minutes_id, meeting_id, version).
    const actaPorId = new Map((minutes.body ?? []).map((a) => [a.id, a]));
    const descolgados = (documents.body ?? []).filter((d) => {
      const acta = actaPorId.get(d.minutes_id);
      return !acta || acta.meeting_id !== d.meeting_id || acta.version !== d.version;
    });
    add(
      "Integridad",
      "Documentos cuya referencia al acta no cuadra",
      descolgados.length === 0 ? "ninguno" : descolgados.map((d) => d.id).join(", "),
      descolgados.length === 0,
    );

    // Duplicación documental: la idempotencia nueva impide varios documentos
    // para los mismos datos, pero los existentes pueden traerla ya puesta.
    const porActa = new Map();
    for (const d of documents.body ?? []) {
      porActa.set(d.minutes_id, (porActa.get(d.minutes_id) ?? 0) + 1);
    }
    const repetidos = [...porActa.entries()].filter(([, n]) => n > 1);
    add(
      "Integridad",
      "Actas con más de un documento registrado",
      repetidos.length === 0
        ? "ninguna"
        : repetidos.map(([id, n]) => `${id} (${n})`).join(", "),
      true, // No impide migrar: la huella de los documentos históricos es nula.
    );
  }

  // --------------------------------------------- superficie de la API de datos

  const legado = await get("meetings_read?select=meeting_id&limit=1");
  add(
    "Superficie",
    "El esquema archivado no se expone por la API de datos",
    legado.ok ? "SE EXPONE" : `no accesible (HTTP ${legado.status})`,
    !legado.ok,
  );

  const spec = await fetch(`${url}/rest/v1/`, {
    headers: { apikey: key, authorization: `Bearer ${key}`, accept: "application/openapi+json" },
  });
  if (spec.ok) {
    const paths = Object.keys((await spec.json()).paths ?? {});
    const rpcs = paths.filter((p) => p.startsWith("/rpc/"));
    add(
      "Superficie",
      "Funciones invocables por la API de datos",
      rpcs.length === 0 ? "ninguna" : rpcs.join(", "),
      true,
    );
  } else {
    add("Superficie", "No se pudo leer la especificación de la API", `HTTP ${spec.status}`, false);
  }

  // ------------------------------------------------------------------ informe

  const ancho = Math.max(...findings.map((f) => f.titulo.length));
  let informe = `# Auditoría de solo lectura del proyecto remoto\n\nProyecto \`${ref}\`.\n\n`;
  for (const area of [...new Set(findings.map((f) => f.area))]) {
    informe += `## ${area}\n\n`;
    for (const f of findings.filter((x) => x.area === area)) {
      console.log(`  ${f.bien ? "OK  " : "AVISO"}  ${f.titulo.padEnd(ancho)}  ${f.detalle}`);
      informe += `- **${f.titulo}**: ${f.detalle}\n`;
    }
    informe += "\n";
  }

  const destino = process.env.ACTA_AUDIT_OUT;
  if (destino) {
    writeFileSync(destino, informe);
    console.log(`\nInforme escrito en ${destino}`);
  }

  const avisos = findings.filter((f) => !f.bien).length;
  console.log(`\n  ${findings.length - avisos} sin hallazgos · ${avisos} con aviso\n`);
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
