#!/usr/bin/env node
/**
 * Ensayo de restauración del respaldo remoto, sobre una pila local
 * **independiente y desechable**.
 *
 * Un respaldo con todas sus piezas y con los hashes coincidentes sigue sin
 * demostrar que se pueda restaurar. Esto lo comprueba del único modo que lo
 * demuestra: levantando un Supabase nuevo y vacío -el que se crearía en una
 * recuperación real-, cargando el volcado y contando lo que queda dentro.
 *
 * No toca el proyecto remoto ni la pila de desarrollo: el destino se comprueba
 * por nombre de contenedor y por puerto antes de cargar nada.
 *
 *   node scripts/verify-restore.mjs <directorio-del-respaldo> [--keep]
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const PROJECT_ID = "acta-pro-restore";
const CONTAINER = `supabase_db_${PROJECT_ID}`;
const PORTS = {
  api: 45431,
  db: 45432,
  shadow: 45430,
  studio: 45433,
  smtp: 45434,
  analytics: 45437,
  pooler: 45439,
  inspector: 8193,
};

const respaldo = process.argv[2] ? resolve(process.argv[2]) : null;
const keep = process.argv.includes("--keep");
const workdir = join(tmpdir(), `acta-pro-restore-${process.pid}`);
const cli = resolve("node_modules/supabase/dist/supabase.js");

if (!respaldo || !existsSync(respaldo)) {
  console.error("Uso: node scripts/verify-restore.mjs <directorio-del-respaldo> [--keep]");
  process.exit(2);
}

const pasos = [];
const anotar = (nombre, ok, detalle = "") => {
  pasos.push({ nombre, ok, detalle });
  console.log(`  ${ok ? "OK   " : "FALLA"}  ${nombre.padEnd(46)}${detalle}`);
};

function supabase(args) {
  const r = spawnSync(process.execPath, [cli, ...args, "--workdir", workdir], { encoding: "utf8" });
  return { ok: r.status === 0, stdout: String(r.stdout ?? ""), stderr: String(r.stderr ?? "") };
}

/**
 * Deja de un volcado de datos solo los bloques `COPY` de los esquemas pedidos.
 *
 * Hace falta porque el volcado trae también las tablas internas de Supabase
 * -`auth`, `storage`-, y la versión de la plataforma alojada va por delante de
 * la que empaqueta el CLI: columnas como `auth.custom_oauth_providers.
 * client_auth_method` existen allí y no aquí. Eso no dice nada sobre los datos
 * de la institución, y en una recuperación real esas tablas las recrea la
 * propia plataforma. Lo que hay que demostrar restaurable es lo nuestro.
 */
function filtrar(archivo, esquemas) {
  const lineas = readFileSync(join(respaldo, archivo), "utf8").split(/\r?\n/);
  const salida = ["SET session_replication_role = replica;", "SET client_encoding = 'UTF8';"];
  let copiando = false;
  let conservar = false;
  for (const linea of lineas) {
    if (!copiando) {
      const copia = /^COPY "([^"]+)"\."([^"]+)"/.exec(linea);
      if (copia) {
        copiando = true;
        conservar = esquemas.includes(copia[1]);
        if (conservar) salida.push(linea);
        continue;
      }
      continue;
    }
    if (conservar) salida.push(linea);
    if (linea === "\\.") {
      copiando = false;
      conservar = false;
    }
  }
  return salida.join("\n") + "\n";
}

function cargar(archivo, sql = null) {
  const r = spawnSync(
    "docker",
    ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"],
    { input: sql ?? readFileSync(join(respaldo, archivo), "utf8"), encoding: "utf8" },
  );
  const salida = String(r.stderr ?? "");
  if (r.status !== 0) {
    const registro = join(tmpdir(), `acta-pro-restore-${archivo}.log`);
    writeFileSync(registro, salida);
    console.log(`         salida completa de psql en ${registro}`);
  }
  const errores = salida
    .split("\n")
    .filter((linea) => /^(ERROR|psql:|FATAL|DETAIL|detail:)/.test(linea.trim()))
    .slice(0, 3)
    .join(" | ");
  return { ok: r.status === 0, error: errores || salida.split("\n").filter(Boolean).slice(-2).join(" | ") };
}

function escalar(sql) {
  return execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-tAc", sql], {
    encoding: "utf8",
  }).trim();
}

function prepararWorkdir() {
  rmSync(workdir, { recursive: true, force: true });
  mkdirSync(join(workdir, "supabase/migrations"), { recursive: true });
  let config = readFileSync("supabase/config.jsonc", "utf8");
  config = config.replace(`"project_id": "acta-pro-mvp"`, `"project_id": "${PROJECT_ID}"`);
  config = config
    .replace(`"port": 54321`, `"port": ${PORTS.api}`)
    .replace(`"port": 54322`, `"port": ${PORTS.db}`)
    .replace(`"shadow_port": 54320`, `"shadow_port": ${PORTS.shadow}`)
    .replace(`"port": 54323`, `"port": ${PORTS.studio}`)
    .replace(`"port": 54324`, `"port": ${PORTS.smtp}`)
    .replace(`"port": 54327`, `"port": ${PORTS.analytics}`)
    .replace(`"port": 54329`, `"port": ${PORTS.pooler}`)
    .replace(`"inspector_port": 8083`, `"inspector_port": ${PORTS.inspector}`);
  config = config
    .replace(`"studio": {\n    "enabled": true,`, `"studio": {\n    "enabled": false,`)
    .replace(`"realtime": {\n    "enabled": true,`, `"realtime": {\n    "enabled": false,`)
    .replace(`"edge_runtime": {\n    "enabled": true,`, `"edge_runtime": {\n    "enabled": false,`)
    .replace(`"analytics": {\n    "enabled": true,`, `"analytics": {\n    "enabled": false,`);
  writeFileSync(join(workdir, "supabase/config.jsonc"), config);
}

function destinoEsLocal() {
  const puertos = execFileSync(
    "docker",
    [
      "inspect",
      "-f",
      "{{range $p, $conf := .NetworkSettings.Ports}}{{range $conf}}{{.HostIp}}:{{.HostPort}} {{end}}{{end}}",
      CONTAINER,
    ],
    { encoding: "utf8" },
  ).trim();
  const ajenos = puertos
    .split(/\s+/)
    .filter(Boolean)
    .filter((enlace) => {
      const ip = enlace.slice(0, enlace.lastIndexOf(":"));
      return !["127.0.0.1", "0.0.0.0", "::", "::1", "[::]", ""].includes(ip);
    });
  return { ok: ajenos.length === 0 && puertos.includes(`:${PORTS.db}`), puertos };
}

const TABLAS = [
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
  "commitment_tracking",
];

console.log(`\nEnsayo de restauración de ${respaldo}`);
console.log(`Destino: pila local desechable ${PROJECT_ID} (puerto ${PORTS.db})\n`);

let levantada = false;
try {
  prepararWorkdir();
  const arranque = supabase(["start"]);
  levantada = arranque.ok;
  anotar(
    "Supabase nuevo y vacío en pie",
    arranque.ok,
    arranque.ok ? `proyecto ${PROJECT_ID}` : arranque.stderr.split("\n")[0],
  );
  if (!arranque.ok) throw new Error("no se pudo levantar la pila");

  const destino = destinoEsLocal();
  anotar("Destino comprobado como local", destino.ok, destino.puertos.slice(0, 38));
  if (!destino.ok) throw new Error("el destino no es local");

  const vacia = escalar("select count(*) from information_schema.tables where table_schema = 'public'");
  anotar("Base de partida sin tablas de la aplicación", vacia === "0", `${vacia} tabla(s) en public`);

  if (vacia !== "0") throw new Error("la base de ensayo ya contiene tablas");
  // pg_dump enumera las concesiones del origen. Las concesiones predeterminadas
  // de la pila vacía se sumarían a ellas al crear las tablas restauradas.
  escalar("ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated, service_role");
  const esquema = cargar("esquema.sql");
  anotar("Estructura restaurada", esquema.ok, esquema.ok ? "esquema.sql" : esquema.error);
  if (!esquema.ok) throw new Error("la estructura no se restauró");

  const permisos = escalar("SELECT NOT has_table_privilege('anon','public.meetings','SELECT') AND NOT has_table_privilege('authenticated','public.signatures','UPDATE') AND NOT has_table_privilege('authenticated','public.audit_logs','TRUNCATE')");
  anotar("Permisos restaurados de la aplicación", permisos === "t");
  if (permisos !== "t") throw new Error("permisos distintos de los esperados");
  const nuestros = ["public", "acta_legacy_20261124"];
  const datos = cargar("datos.sql", filtrar("datos.sql", nuestros));
  anotar("Datos de la institución restaurados", datos.ok, datos.ok ? nuestros.join(", ") : datos.error);
  if (!datos.ok) throw new Error("el contenido de la aplicación no se restauró");

  // Informativo, no determinante: `auth` la gestiona la plataforma y su versión
  // alojada va por delante de la local, de modo que un fallo aquí no dice nada
  // sobre el respaldo. Las cuentas se recrean a mano -las contraseñas no son
  // recuperables-, y así lo indica RESTAURACION.md.
  const cuentas = cargar("datos.sql", filtrar("datos.sql", ["auth"]));
  console.log(
    `  ${cuentas.ok ? "OK   " : "AVISO"}  ${"Tablas internas de autenticación".padEnd(46)}${
      cuentas.ok ? "cargadas" : "no comparables con la versión local"
    }`,
  );

  const inventario = [];
  let vacias = 0;
  for (const tabla of TABLAS) {
    const filas = Number(escalar(`select count(*) from public.${tabla}`));
    inventario.push(`${tabla}=${filas}`);
    if (filas === 0) vacias += 1;
  }
  anotar("Tablas con contenido", vacias === 0, `${TABLAS.length - vacias}/${TABLAS.length} con filas`);

  const huerfanos = escalar(
    "select count(*) from public.documents d left join public.minutes m on m.id = d.minutes_id where m.id is null",
  );
  anotar("Sin referencias documentales rotas", huerfanos === "0", `${huerfanos} huérfano(s)`);

  // Cada perfil restaurado tiene que tener su cuenta en el inventario del
  // respaldo. Se comprueba contra `auth-usuarios.json` y no contra `auth.users`
  // porque esa tabla la gobierna la plataforma, no el respaldo.
  const guardados = JSON.parse(readFileSync(join(respaldo, "auth-usuarios.json"), "utf8"));
  const cuentasGuardadas = Array.isArray(guardados) ? guardados : (guardados.usuarios ?? []);
  const identificadores = new Set(cuentasGuardadas.map((cuenta) => cuenta.id));
  const perfiles = escalar("select id from public.profiles").split("\n").filter(Boolean);
  const sinCuenta = perfiles.filter((id) => !identificadores.has(id));
  anotar(
    "Cada perfil tiene su cuenta en el respaldo",
    sinCuenta.length === 0 && perfiles.length > 0,
    `${perfiles.length} perfil(es), ${cuentasGuardadas.length} cuenta(s)`,
  );

  // El almacenamiento no se restaura con SQL: `storage` pertenece a
  // `supabase_storage_admin` y sus tablas internas cambian con la versión de la
  // plataforma. Los archivos se vuelven a subir desde la carpeta del respaldo,
  // de modo que lo que hay que comprobar es que cada documento restaurado tenga
  // su archivo allí.
  const rutas = escalar("select storage_path from public.documents").split("\n").filter(Boolean);
  const presentes = rutas.filter((ruta) => existsSync(join(respaldo, "almacenamiento", ruta)));
  anotar(
    "Cada documento con su archivo en el respaldo",
    presentes.length === rutas.length && rutas.length > 0,
    `${presentes.length} de ${rutas.length} archivo(s)`,
  );

  console.log(`\n  Inventario restaurado: ${inventario.join(", ")}`);
} catch (error) {
  anotar("Ensayo completado", false);
  console.error(`\n  Interrumpido: ${error.message}`);
} finally {
  if (levantada && !keep) {
    supabase(["stop", "--no-backup"]);
    console.log("\n  Pila desechable detenida y borrada.");
  } else if (levantada) {
    console.log(`\n  Pila en pie por --keep. Detener con: node ${cli} stop --no-backup --workdir ${workdir}`);
  }
  if (!keep) rmSync(workdir, { recursive: true, force: true });
}

const fallos = pasos.filter((paso) => !paso.ok);
console.log(`\n  ${pasos.length - fallos.length} / ${pasos.length} comprobaciones superadas`);
if (fallos.length > 0) {
  console.log("\n  El respaldo NO se restaura por completo. No sirve para recuperar el proyecto tal cual.");
  process.exit(1);
}
console.log("\n  Respaldo restaurado y verificado sobre un Supabase nuevo.");
