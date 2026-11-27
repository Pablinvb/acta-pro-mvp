#!/usr/bin/env node
/**
 * Ejecuta la suite de pruebas de seguridad SQL contra Supabase **local**.
 *
 * Cada archivo de `supabase/tests/security/` corre dentro de una transaccion
 * que revierte al terminar, de modo que no deja registros residuales y puede
 * repetirse tantas veces como haga falta.
 *
 * Nunca toca la base remota: el destino lo resuelve `local-target.mjs`, que
 * aborta si el contenedor no es el del stack local.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { psql, resolveLocalContainer } from "./local-target.mjs";

const TESTS_DIR = "supabase/tests/security";

/** Deja solo las lineas utiles del informe de psql. */
function formatOutput(output) {
  const lines = String(output)
    .split(/\r?\n/)
    .filter((line) => /PASA|FALLA|superadas/.test(line))
    .map((line) => `  ${line.trim()}`);
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

function main() {
  const container = resolveLocalContainer();
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
      process.stdout.write(formatOutput(psql(container, readFileSync("tests/integration/signing-fixture.sql","utf8") + "\n" + sql)));
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
