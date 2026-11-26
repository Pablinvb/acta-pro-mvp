#!/usr/bin/env node
/**
 * Ejecuta la suite de pruebas de seguridad SQL contra Supabase **local**.
 *
 * Cada archivo de `supabase/tests/security/` corre dentro de una transaccion
 * que revierte al terminar, de modo que no deja registros residuales y puede
 * repetirse tantas veces como haga falta.
 *
 * Nunca toca la base remota: resuelve el contenedor de Postgres del stack
 * local y aborta si no lo encuentra.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const TESTS_DIR = "supabase/tests/security";

function run(cmd, args, options = {}) {
  return execFileSync(cmd, args, { encoding: "utf8", ...options });
}

function findLocalContainer() {
  let names;
  try {
    names = run("docker", ["ps", "--format", "{{.Names}}"]).split(/\r?\n/);
  } catch {
    throw new Error(
      "Docker no responde. El stack local de Supabase debe estar arriba: npx supabase start",
    );
  }

  const container = names.map((n) => n.trim()).find((n) => n.startsWith("supabase_db_"));
  if (!container) {
    throw new Error("No se encontro el contenedor de Postgres local. Ejecute: npx supabase start");
  }
  return container;
}

/** Deja solo las lineas utiles del informe de psql. */
function formatOutput(output) {
  const lines = String(output)
    .split(/\r?\n/)
    .filter((line) => /PASA|FALLA|superadas/.test(line))
    .map((line) => `  ${line.trim()}`);
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

function main() {
  const container = findLocalContainer();

  // Comprobacion explicita de destino: solo se admite el stack local.
  const bindings = run("docker", [
    "inspect",
    "-f",
    "{{range $p, $conf := .NetworkSettings.Ports}}{{range $conf}}{{.HostIp}} {{end}}{{end}}",
    container,
  ]).trim();

  const remote = bindings
    .split(/\s+/)
    .filter(Boolean)
    .find((ip) => !/^(127\.0\.0\.1|0\.0\.0\.0|::)$/.test(ip));

  if (remote) {
    throw new Error(`El contenedor ${container} expone ${remote}, que no es local. Abortado.`);
  }

  console.log(`Destino: ${container} · Supabase local\n`);

  const files = readdirSync(TESTS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  if (files.length === 0) throw new Error(`No hay pruebas en ${TESTS_DIR}`);

  let failed = 0;

  for (const file of files) {
    console.log(`── ${file}`);
    const sql = readFileSync(join(TESTS_DIR, file), "utf8");
    try {
      const output = run(
        "docker",
        ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-f", "-"],
        { input: sql },
      );
      process.stdout.write(formatOutput(output));
    } catch (error) {
      failed += 1;
      process.stdout.write(formatOutput(error.stdout));
      const reason = String(error.stderr ?? error.message).trim().split(/\r?\n/)[0];
      process.stderr.write(`  ERROR: ${reason}\n`);
    }
    console.log("");
  }

  if (failed > 0) {
    console.error(`${failed} archivo(s) de prueba con fallos.`);
    process.exit(1);
  }
  console.log("Todas las pruebas de seguridad SQL pasaron.");
}

main();
