#!/usr/bin/env node
/**
 * Validación de instalación limpia, sobre una pila local **independiente y
 * desechable**.
 *
 * Que las migraciones funcionen sobre la base de desarrollo no demuestra que
 * funcionen sobre una base nueva: la de desarrollo ha ido acumulando el
 * resultado de cada intento. Aquí se levanta una pila aparte, con su propio
 * `project_id` y sus propios puertos, se aplica el historial desde cero, se
 * cargan los datos semilla, se ejecutan las pruebas contra ella y se destruye.
 *
 * Nada de esto toca el proyecto remoto ni la pila de desarrollo. El destino se
 * comprueba por nombre de contenedor y por puerto antes de cada paso.
 *
 *   node scripts/verify-clean-install.mjs [--keep]
 *
 * Con `--keep` la pila se deja en pie para inspeccionarla; sin él se detiene y
 * se borra, que es el comportamiento previsto.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const PROJECT_ID = "acta-pro-clean";
const CONTAINER = `supabase_db_${PROJECT_ID}`;
const PORTS = {
  api: 54421,
  db: 54422,
  shadow: 54420,
  studio: 54423,
  smtp: 54424,
  analytics: 54427,
  pooler: 54429,
  inspector: 8183,
};

const keep = process.argv.includes("--keep");
const workdir = join(tmpdir(), `acta-pro-clean-install-${process.pid}`);
const cli = resolve("node_modules/supabase/dist/supabase.js");

const steps = [];
const record = (name, passed, detail = "") => {
  steps.push({ name, passed, detail });
  console.log(`  ${passed ? "PASA " : "FALLA"}  ${name.padEnd(58)}${detail}`);
};

function supabase(args, options = {}) {
  const result = spawnSync(process.execPath, [cli, ...args, "--workdir", workdir], {
    encoding: "utf8",
    ...options,
  });
  return {
    ok: result.status === 0,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
  };
}

function psql(sql) {
  return execFileSync(
    "docker",
    ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-f", "-"],
    { input: sql, encoding: "utf8" },
  );
}

function scalar(sql) {
  return execFileSync(
    "docker",
    ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tAc", sql],
    { encoding: "utf8" },
  ).trim();
}

/** Copia el proyecto a un directorio aparte y le cambia identidad y puertos. */
function prepareWorkdir() {
  rmSync(workdir, { recursive: true, force: true });
  mkdirSync(join(workdir, "supabase"), { recursive: true });

  cpSync("supabase/migrations", join(workdir, "supabase/migrations"), { recursive: true });
  cpSync("supabase/seed.sql", join(workdir, "supabase/seed.sql"));

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

  // Studio, analíticas, realtime y funciones de borde no participan en lo que
  // se valida aquí -esquema, API de datos, autenticación y almacenamiento- y
  // levantarlos duplicaría el consumo de una máquina que ya tiene en pie la
  // pila de desarrollo. Se deja constancia de la diferencia.
  config = config
    .replace(`"studio": {\n    "enabled": true,`, `"studio": {\n    "enabled": false,`)
    .replace(`"realtime": {\n    "enabled": true,`, `"realtime": {\n    "enabled": false,`)
    .replace(`"edge_runtime": {\n    "enabled": true,`, `"edge_runtime": {\n    "enabled": false,`)
    .replace(`"analytics": {\n    "enabled": true,`, `"analytics": {\n    "enabled": false,`);

  writeFileSync(join(workdir, "supabase/config.jsonc"), config);
}

function assertCleanTarget() {
  const bindings = execFileSync(
    "docker",
    [
      "inspect",
      "-f",
      "{{range $p, $conf := .NetworkSettings.Ports}}{{range $conf}}{{.HostIp}}:{{.HostPort}} {{end}}{{end}}",
      CONTAINER,
    ],
    { encoding: "utf8" },
  ).trim();

  const foreign = bindings
    .split(/\s+/)
    .filter(Boolean)
    .find((entry) => !/^(127\.0\.0\.1|0\.0\.0\.0|::):/.test(entry));
  if (foreign) throw new Error(`${CONTAINER} expone ${foreign}, que no es local. Abortado.`);

  if (!bindings.includes(`:${PORTS.db}`)) {
    throw new Error(
      `${CONTAINER} no publica el puerto ${PORTS.db}. No se confirma que sea la pila desechable.`,
    );
  }
}

function stack() {
  const status = supabase(["status", "-o", "json"]);
  const start = status.stdout.indexOf("{");
  if (!status.ok || start < 0) {
    throw new Error(`No se pudo leer el estado de la pila desechable: ${status.stderr.slice(0, 200)}`);
  }
  return JSON.parse(status.stdout.slice(start));
}

async function main() {
  console.log("Validación de instalación limpia · pila desechable\n");

  prepareWorkdir();

  console.log("Levantando la pila desechable (puede tardar varios minutos)…\n");
  const started = supabase(["start"], { stdio: ["ignore", "pipe", "pipe"] });
  if (!started.ok) {
    throw new Error(`No se pudo levantar la pila desechable:\n${started.stderr.slice(0, 600)}`);
  }

  try {
    assertCleanTarget();
    record("A1 la pila desechable responde en su propio puerto", true, `db ${PORTS.db}`);

    // ---------------------------------------------------- el historial, desde cero
    const applied = supabase(["migration", "up"]);
    record(
      "A2 el historial de migraciones se aplica sobre base vacía",
      applied.ok,
      applied.ok ? "" : applied.stderr.split(/\r?\n/)[0]?.slice(0, 60),
    );
    if (!applied.ok) throw new Error("Las migraciones no se aplicaron en la pila limpia.");

    const archivos = readdirSync("supabase/migrations").filter((n) => n.endsWith(".sql")).length;
    const registradas = Number(
      scalar(`SELECT count(*) FROM supabase_migrations.schema_migrations;`),
    );
    record(
      "A3 quedan registradas las mismas migraciones que hay en disco",
      registradas === archivos,
      `${registradas} de ${archivos}`,
    );

    const diff = supabase(["db", "diff"]);
    record(
      "A4 el esquema resultante no difiere de las migraciones",
      diff.ok && /No schema changes found/.test(diff.stdout + diff.stderr),
      "",
    );

    // ------------------------------------------- avisos del analizador de esquema
    const lint = supabase(["db", "lint", "--level", "warning"]);
    const avisos = (lint.stdout.match(/"level"/g) ?? []).length;
    record(
      "A5 el analizador de esquema no reporta avisos",
      lint.ok && avisos === 0,
      avisos > 0 ? `${avisos} aviso(s)` : "",
    );

    // --------------------------------------------------------- los datos semilla
    const { API_URL, ANON_KEY, SERVICE_ROLE_KEY } = stack();

    // El archivo semilla no crea la cuenta de acceso: el perfil docente apunta a
    // `auth.users`, que se gestiona por la API de autenticación. En una
    // instalación limpia esto es un paso manual, y aquí se hace explícito.
    const demoTeacherId = readFileSync("supabase/seed.sql", "utf8").match(
      /insert into public\.profiles[\s\S]*?'([0-9a-f-]{36})'/i,
    )?.[1];
    const demoEmail = readFileSync("supabase/seed.sql", "utf8").match(
      /'([^']+@[^']+)'/,
    )?.[1];

    record(
      "B1 el archivo semilla declara la cuenta docente",
      Boolean(demoTeacherId && demoEmail),
      demoTeacherId ? "" : "no se pudo leer del archivo",
    );

    psql(`
      INSERT INTO auth.users (id, instance_id, aud, role, email, email_confirmed_at,
                              created_at, updated_at)
      VALUES ('${demoTeacherId}', '00000000-0000-0000-0000-000000000000',
              'authenticated', 'authenticated', '${demoEmail}', now(), now(), now())
      ON CONFLICT (id) DO NOTHING;
    `);

    psql(readFileSync("supabase/seed.sql", "utf8"));
    record("B2 los datos semilla se cargan sin errores", true, "");

    // Las tablas que el archivo semilla puebla. No se fija un número de filas:
    // lo que importa es que cada una quede con datos, porque un archivo semilla
    // que se carga "sin errores" pero deja tablas vacías no sirve de escenario.
    const sembradas = [
      "institutions",
      "profiles",
      "students",
      "representatives",
      "student_representatives",
      "meetings",
    ];
    for (const table of sembradas) {
      const total = Number(scalar(`SELECT count(*) FROM public.${table};`));
      record(`B3 ${table}: ${total} registro(s)`, total > 0, total > 0 ? "" : "quedó vacía");
    }

    const bucket = scalar(
      `SELECT coalesce((SELECT (NOT public)::text FROM storage.buckets WHERE id = 'acta-documents'), 'ausente');`,
    );
    record("B4 el bucket de documentos existe y es privado", bucket === "true", bucket);

    // ------------------------------- la suite de seguridad, contra la pila limpia
    const suite = spawnSync(process.execPath, ["scripts/verify-security.mjs"], {
      encoding: "utf8",
      env: { ...process.env, ACTA_DB_CONTAINER: CONTAINER },
    });
    const superadas = [...suite.stdout.matchAll(/(\d+) \/ (\d+) superadas/g)];
    const total = superadas.reduce((acc, m) => acc + Number(m[2]), 0);
    const pasadas = superadas.reduce((acc, m) => acc + Number(m[1]), 0);
    record(
      "C1 la suite de seguridad SQL pasa en la pila limpia",
      suite.status === 0 && total > 0 && pasadas === total,
      `${pasadas} / ${total}`,
    );

    // ------------------------- la aplicación de verdad, contra esta base limpia
    const integracion = spawnSync(
      process.execPath,
      ["node_modules/vitest/vitest.mjs", "run", "--config", "vitest.integration.config.mts"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          ACTA_TEST_API_URL: API_URL,
          ACTA_TEST_ANON_KEY: ANON_KEY,
          ACTA_TEST_SERVICE_KEY: SERVICE_ROLE_KEY,
          ACTA_DB_CONTAINER: CONTAINER,
        },
      },
    );
    const resumen = integracion.stdout.match(/Tests\s+(\d+) passed \((\d+)\)/);
    record(
      "C2 la aplicación opera contra esta base limpia",
      integracion.status === 0,
      resumen ? `${resumen[1]} / ${resumen[2]} pruebas` : integracion.stderr.slice(0, 60),
    );
  } finally {
    if (keep) {
      console.log(`\nLa pila desechable sigue en pie. Para retirarla:`);
      console.log(`  node ${cli} stop --workdir ${workdir}`);
    } else {
      console.log("\nRetirando la pila desechable…");
      supabase(["stop", "--no-backup"], { stdio: ["ignore", "pipe", "pipe"] });
      rmSync(workdir, { recursive: true, force: true });
    }
  }

  const pasadas = steps.filter((s) => s.passed).length;
  console.log(`\n  ${pasadas} / ${steps.length} comprobaciones superadas\n`);

  if (pasadas !== steps.length) {
    console.error("La validación de instalación limpia no se completó.");
    process.exit(1);
  }
  console.log("Instalación limpia validada.");
}

main().catch((error) => {
  console.error(`\n${error.message ?? error}`);
  process.exit(1);
});
