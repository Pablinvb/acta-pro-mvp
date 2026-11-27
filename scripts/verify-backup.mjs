#!/usr/bin/env node
/**
 * Verifica un respaldo creado por `backup-remote.mjs`.
 *
 * Un respaldo que no se ha verificado no es un respaldo: es un directorio con
 * la forma de uno. Aquí se comprueba, pieza por pieza, que lo guardado es lo
 * que se guardó, que no falta ni sobra nada, y que cada documento registrado
 * tiene su archivo con el SHA-256 que le corresponde.
 *
 *   node scripts/verify-backup.mjs <directorio> [--contra-destino]
 *
 * Con `--contra-destino` comprueba además el proyecto que indica `.env.local`:
 * es la verificación que cierra una restauración, porque confirma que lo que
 * quedó en el destino coincide con lo respaldado. Es de solo lectura.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const resultados = [];
const comprobar = (nombre, ok, detalle = "") => {
  resultados.push({ nombre, ok, detalle });
  console.log(`  ${ok ? "OK   " : "FALLO"}  ${nombre.padEnd(46)}${detalle}`);
};

const sha256File = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

function loadEnv() {
  const env = {};
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
    if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

async function main() {
  const dir = process.argv[2] ? resolve(process.argv[2]) : null;
  if (!dir) throw new Error("Indique el directorio del respaldo.");

  const manifiesto = JSON.parse(readFileSync(join(dir, "MANIFIESTO.json"), "utf8"));
  console.log(`Respaldo del proyecto ${manifiesto.proyecto}, creado ${manifiesto.creado}\n`);

  // ----------------------------------------------- integridad de las piezas
  const alteradas = [];
  const ausentes = [];
  for (const pieza of manifiesto.piezas) {
    const ruta = join(dir, pieza.archivo);
    try {
      statSync(ruta);
    } catch {
      ausentes.push(pieza.archivo);
      continue;
    }
    if (sha256File(ruta) !== pieza.sha256) alteradas.push(pieza.archivo);
  }

  comprobar(
    `Piezas presentes (${manifiesto.piezas.length})`,
    ausentes.length === 0,
    ausentes.length === 0 ? "" : `faltan: ${ausentes.join(", ").slice(0, 70)}`,
  );
  comprobar(
    "Ninguna pieza alterada",
    alteradas.length === 0,
    alteradas.length === 0 ? "" : `cambiaron: ${alteradas.join(", ").slice(0, 70)}`,
  );

  const presentes = new Set(manifiesto.piezas.map((p) => p.archivo));
  const sobrantes = [...walk(dir)]
    .map((p) => relative(dir, p).split("\\").join("/"))
    .filter((p) => p !== "MANIFIESTO.json" && !presentes.has(p));
  comprobar(
    "Sin archivos ajenos al manifiesto",
    sobrantes.length === 0,
    sobrantes.length === 0 ? "" : sobrantes.join(", ").slice(0, 70),
  );

  // ------------------------------- los documentos tienen sus bytes, no solo su fila
  // Es la comprobación que distingue un respaldo útil de uno que solo parece
  // completo: `datos.sql` puede traer la tabla `documents` entera sin que exista
  // ni un PDF detrás.
  const datos = readFileSync(join(dir, "datos.sql"), "utf8");
  const rutas = [...datos.matchAll(/([0-9a-f-]{36}\/[0-9a-f-]{36}\/[^\s\t"']+\.pdf)/gi)].map(
    (m) => m[1],
  );
  const unicas = [...new Set(rutas)];
  const sinArchivo = unicas.filter((ruta) => {
    try {
      statSync(join(dir, "almacenamiento", ruta));
      return false;
    } catch {
      return true;
    }
  });
  comprobar(
    `Rutas de documento con archivo (${unicas.length})`,
    sinArchivo.length === 0,
    sinArchivo.length === 0 ? "" : `sin bytes: ${sinArchivo.join(", ").slice(0, 70)}`,
  );

  // ------------------------------------------------------ contra el destino
  if (process.argv.includes("--contra-destino")) {
    const env = loadEnv();
    const { createClient } = await import("@supabase/supabase-js");
    const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const documentos = await admin.from("documents").select("id,storage_path,sha256");
    if (documentos.error) {
      comprobar("Documentos del destino", false, documentos.error.message.slice(0, 60));
    } else {
      const problemas = [];
      for (const doc of documentos.data ?? []) {
        const { data, error } = await admin.storage.from("acta-documents").download(doc.storage_path);
        if (error || !data) {
          problemas.push(`${doc.id}: sin archivo en el destino`);
          continue;
        }
        const bytes = Buffer.from(await data.arrayBuffer());
        if (createHash("sha256").update(bytes).digest("hex") !== doc.sha256) {
          problemas.push(`${doc.id}: SHA-256 distinto en el destino`);
        }
      }
      comprobar(
        `Documentos del destino verificados (${documentos.data.length})`,
        problemas.length === 0,
        problemas.join("; ").slice(0, 80),
      );
    }
  }

  const fallos = resultados.filter((r) => !r.ok).length;
  console.log(`\n  ${resultados.length - fallos} / ${resultados.length} comprobaciones superadas\n`);

  if (manifiesto.no_incluye?.length) {
    console.log("Lo que este respaldo no cubre, y hay que resolver a mano:");
    for (const nota of manifiesto.no_incluye) console.log(`  · ${nota}`);
    console.log("");
  }

  if (fallos > 0) {
    console.error("El respaldo no se puede dar por válido.");
    process.exit(1);
  }
  console.log("Respaldo verificado.");
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
