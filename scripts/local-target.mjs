/**
 * Resolución del destino para las pruebas: **solo** el stack local.
 *
 * Vive en un único archivo a propósito. La comprobación de que no se está
 * escribiendo contra la base remota no debe estar duplicada en cada script,
 * porque entonces basta con que a uno se le olvide.
 */
import { execFileSync, spawn } from "node:child_process";

export function run(cmd, args, options = {}) {
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

/**
 * Devuelve el contenedor local y aborta si alguno de sus puertos está publicado
 * en una dirección que no sea de esta máquina. Un contenedor accesible desde
 * fuera no es el destino de pruebas que se supone.
 */
export function resolveLocalContainer() {
  const container = findLocalContainer();

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

  return container;
}

const PSQL_ARGS = ["psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-f", "-"];

/** Ejecuta SQL y devuelve la salida. Lanza si psql termina con error. */
export function psql(container, sql) {
  return run("docker", ["exec", "-i", container, ...PSQL_ARGS], { input: sql });
}

/**
 * Un único valor, ya desnudo: sin encabezados, sin bordes y sin el recuento de
 * filas. Es lo que hace legible una comprobación como `=== "2"`.
 */
export function psqlScalar(container, sql) {
  return run("docker", [
    "exec",
    "-i",
    container,
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-v",
    "ON_ERROR_STOP=1",
    "-tAc",
    sql,
  ]).trim();
}

/**
 * Abre una sesión aparte y devuelve una promesa con su resultado.
 *
 * Es lo que permite probar la concurrencia de verdad: dos procesos psql son dos
 * conexiones distintas, con sus propias transacciones y sus propios bloqueos.
 * Simularlo desde una sola sesión no probaría nada.
 */
export function psqlAsync(container, sql) {
  return new Promise((resolve) => {
    const child = spawn("docker", ["exec", "-i", container, ...PSQL_ARGS], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code) => resolve({ ok: code === 0, code, stdout, stderr }));

    child.stdin.end(sql);
  });
}

export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
