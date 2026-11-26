#!/usr/bin/env node
/**
 * Respaldo completo del proyecto remoto, con el plan gratuito y sin contratar
 * nada. Solo lectura: no escribe en el proyecto.
 *
 * El punto de partida es un error fácil de cometer: **un volcado SQL no
 * contiene los archivos del almacenamiento.** `storage.objects` guarda los
 * metadatos -ruta, tamaño, tipo-, pero los PDF viven en un servicio de objetos
 * aparte. Restaurar solo el volcado deja una base que afirma tener documentos
 * cuyos bytes no existen, y cada descarga fallaría la verificación de SHA-256.
 * Por eso aquí se descargan los archivos uno a uno.
 *
 * Lo mismo ocurre con las cuentas: `auth.users` no está en el volcado del
 * esquema de la aplicación y se exporta por separado.
 *
 * Qué produce
 * -----------
 *   esquema.sql             estructura: tablas, políticas, funciones, grants
 *   datos.sql               contenido de las tablas de la aplicación
 *   roles.sql               roles del clúster
 *   auth-usuarios.json      cuentas, de la API de administración
 *   historial-migraciones.json  qué migraciones constan aplicadas
 *   almacenamiento/…        los PDF, con su ruta original
 *   MANIFIESTO.json         SHA-256 de cada pieza, para verificar
 *   RESTAURACION.md         el procedimiento, con sus límites
 *
 * Uso
 * ---
 *   node scripts/backup-remote.mjs [--salida <directorio>]
 *
 * Por omisión escribe **fuera del repositorio**, en `../acta-pro-respaldos/`:
 * un respaldo contiene datos personales y no debe acabar en el control de
 * versiones.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { createClient } from "@supabase/supabase-js";

const BUCKET = "acta-documents";
const cli = resolve("node_modules/supabase/dist/supabase.js");

function loadEnv() {
  const env = {};
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
    if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

function salidaElegida() {
  const index = process.argv.indexOf("--salida");
  if (index >= 0 && process.argv[index + 1]) return resolve(process.argv[index + 1]);

  const marca = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return resolve("..", "acta-pro-respaldos", marca);
}

function supabase(args, options = {}) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", ...options });
  return {
    ok: result.status === 0,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
  };
}

const pasos = [];
const paso = (nombre, ok, detalle = "") => {
  pasos.push({ nombre, ok, detalle });
  console.log(`  ${ok ? "OK   " : "FALLO"}  ${nombre.padEnd(40)}${detalle}`);
};

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

async function main() {
  const env = loadEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Faltan la URL o la clave de servicio en .env.local.");

  const host = new URL(url).hostname;
  const ref = host.split(".")[0];
  if (["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error("La URL apunta a una dirección local. Este guion respalda el proyecto remoto.");
  }

  const salida = salidaElegida();
  const dentroDelRepo = !relative(process.cwd(), salida).startsWith("..");
  mkdirSync(salida, { recursive: true });

  console.log(`Respaldo del proyecto ${ref}`);
  console.log(`Destino: ${salida}\n`);
  if (dentroDelRepo) {
    console.log(
      "  AVISO  El destino está dentro del repositorio. Un respaldo contiene\n" +
        "         datos personales: compruebe que no quede bajo control de versiones.\n",
    );
  }

  // ------------------------------------------------------------------ esquema
  const esquema = supabase(["db", "dump", "--remote", "--keep-comments", "-f", join(salida, "esquema.sql")]);
  paso("Estructura de la base", esquema.ok, esquema.ok ? "" : esquema.stderr.slice(0, 60));

  // -------------------------------------------------------------------- datos
  const datos = supabase([
    "db",
    "dump",
    "--remote",
    "--data-only",
    "--use-copy",
    "-f",
    join(salida, "datos.sql"),
  ]);
  paso("Contenido de las tablas", datos.ok, datos.ok ? "" : datos.stderr.slice(0, 60));

  // -------------------------------------------------------------------- roles
  const roles = supabase(["db", "dump", "--remote", "--role-only", "-f", join(salida, "roles.sql")]);
  paso("Roles del clúster", roles.ok, roles.ok ? "" : roles.stderr.slice(0, 60));

  // --------------------------------------------------------- cuentas de acceso
  // `auth.users` no viaja en el volcado de la aplicación. Se exporta por la API
  // de administración, que es de lectura y no expone las contraseñas: viajan
  // como huella, y una restauración exige que cada persona la restablezca.
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const usuarios = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (usuarios.error) {
    paso("Cuentas de acceso", false, usuarios.error.message.slice(0, 60));
  } else {
    writeFileSync(
      join(salida, "auth-usuarios.json"),
      JSON.stringify(
        usuarios.data.users.map((u) => ({
          id: u.id,
          email: u.email,
          phone: u.phone,
          created_at: u.created_at,
          email_confirmed_at: u.email_confirmed_at,
          last_sign_in_at: u.last_sign_in_at,
          app_metadata: u.app_metadata,
          user_metadata: u.user_metadata,
        })),
        null,
        2,
      ),
    );
    paso("Cuentas de acceso", true, `${usuarios.data.users.length} cuenta(s)`);
  }

  // ------------------------------------------------------- historial migratorio
  const historial = supabase(["migration", "list", "--remote"]);
  // El CLI reparte su salida entre los dos flujos y precede el JSON con un
  // encabezado, así que se mira el conjunto y se guarda el conjunto: perder el
  // historial por no acertar con el flujo sería lo peor de los dos mundos.
  const salidaCompleta = `${historial.stdout}\n${historial.stderr}`.trim();
  const inicio = salidaCompleta.indexOf('{"migrations"');
  const cuerpo = inicio >= 0 ? salidaCompleta.slice(inicio) : salidaCompleta;

  // Un historial útil nombra al menos una migración, y los identificadores son
  // marcas de tiempo de 14 dígitos.
  const identificadores = cuerpo.match(/\d{14}/g) ?? [];
  if (identificadores.length > 0) {
    writeFileSync(
      join(salida, inicio >= 0 ? "historial-migraciones.json" : "historial-migraciones.txt"),
      cuerpo,
    );
    paso(
      "Historial de migraciones",
      true,
      `${new Set(identificadores).size} migración(es) listadas`,
    );
  } else {
    paso("Historial de migraciones", false, salidaCompleta.slice(0, 60) || "sin salida");
  }

  // ---------------------------------------------- los archivos, que no van en SQL
  const archivos = [];
  const recorrer = async (prefijo) => {
    const { data, error } = await admin.storage.from(BUCKET).list(prefijo, { limit: 1000 });
    if (error) throw new Error(`No se pudo listar ${prefijo || "/"}: ${error.message}`);
    for (const entrada of data ?? []) {
      const ruta = prefijo ? `${prefijo}/${entrada.name}` : entrada.name;
      // Una entrada sin metadatos es una carpeta.
      if (entrada.id === null) await recorrer(ruta);
      else archivos.push(ruta);
    }
  };

  let descargados = 0;
  try {
    await recorrer("");
    for (const ruta of archivos) {
      const { data, error } = await admin.storage.from(BUCKET).download(ruta);
      if (error || !data) throw new Error(`No se pudo descargar ${ruta}: ${error?.message}`);
      const destino = join(salida, "almacenamiento", ruta);
      mkdirSync(dirname(destino), { recursive: true });
      writeFileSync(destino, Buffer.from(await data.arrayBuffer()));
      descargados += 1;
    }
    paso("Archivos del almacenamiento", descargados === archivos.length, `${descargados} archivo(s)`);
  } catch (error) {
    paso("Archivos del almacenamiento", false, String(error.message).slice(0, 60));
  }

  // ------------------------------------------- comprobación: metadatos vs bytes
  // La pregunta que un respaldo debe poder responder: ¿tiene cada documento
  // registrado su archivo, y coincide su SHA-256?
  const documentos = await admin.from("documents").select("id,storage_path,sha256");
  if (documentos.error) {
    paso("Cotejo de documentos y archivos", false, documentos.error.message.slice(0, 60));
  } else {
    const problemas = [];
    for (const doc of documentos.data ?? []) {
      const local = join(salida, "almacenamiento", doc.storage_path);
      try {
        statSync(local);
      } catch {
        problemas.push(`${doc.id}: sin archivo`);
        continue;
      }
      if (sha256File(local) !== doc.sha256) problemas.push(`${doc.id}: SHA-256 distinto`);
    }
    paso(
      "Cotejo de documentos y archivos",
      problemas.length === 0,
      problemas.length === 0
        ? `${documentos.data.length} documento(s) verificado(s)`
        : problemas.join("; ").slice(0, 80),
    );
  }

  // El procedimiento de restauración se escribe antes del manifiesto, y no
  // después: también es una pieza del respaldo, y dejarla fuera del manifiesto
  // la convertiría en un archivo ajeno a ojos del verificador.
  writeFileSync(join(salida, "RESTAURACION.md"), RESTAURACION(ref));
  paso("Procedimiento de restauración", true, "RESTAURACION.md");

  // -------------------------------------------------------------- manifiesto
  const piezas = [...walk(salida)]
    .filter((p) => !p.endsWith("MANIFIESTO.json"))
    .map((p) => ({
      archivo: relative(salida, p).split("\\").join("/"),
      bytes: statSync(p).size,
      sha256: sha256File(p),
    }))
    .sort((a, b) => a.archivo.localeCompare(b.archivo));

  writeFileSync(
    join(salida, "MANIFIESTO.json"),
    JSON.stringify(
      {
        proyecto: ref,
        creado: new Date().toISOString(),
        piezas,
        // Lo que este respaldo NO contiene, dicho explícitamente.
        no_incluye: [
          "Contraseñas en claro: auth-usuarios.json no las lleva y no se pueden recuperar.",
          "Secretos de configuración: viven en el entorno de despliegue, no en la base.",
          "Registros del servidor y métricas del panel.",
          "Ajustes del proyecto: proveedores de autenticación, plantillas de correo, claves de API.",
        ],
      },
      null,
      2,
    ),
  );
  paso("Manifiesto con SHA-256", true, `${piezas.length} pieza(s)`);

  const fallos = pasos.filter((p) => !p.ok).length;
  console.log(`\n  ${pasos.length - fallos} / ${pasos.length} pasos completados\n`);
  if (fallos > 0) {
    console.error("El respaldo está incompleto. No lo dé por válido.");
    process.exit(1);
  }
  console.log(`Respaldo completo y verificado en ${salida}`);
}

const RESTAURACION = (ref) => `# Restauración del proyecto ${ref}

Respaldo creado por \`scripts/backup-remote.mjs\`. Antes de usarlo, verifique
que no se ha alterado:

\`\`\`bash
node scripts/verify-backup.mjs <este directorio>
\`\`\`

## Qué hay aquí, y qué no

| Pieza | Contiene |
| --- | --- |
| \`esquema.sql\` | Tablas, índices, políticas, funciones, disparadores y privilegios |
| \`datos.sql\` | Filas de las tablas de la aplicación |
| \`roles.sql\` | Roles del clúster |
| \`auth-usuarios.json\` | Cuentas, **sin contraseñas** |
| \`historial-migraciones.json\` | Qué migraciones constan aplicadas |
| \`almacenamiento/\` | Los PDF, con su ruta original |

**No contiene** contraseñas en claro, secretos de configuración, registros del
servidor ni ajustes del panel (proveedores de autenticación, plantillas de
correo, claves de API). Esos se vuelven a establecer a mano.

## El punto que se pasa por alto

Un volcado SQL **no trae los archivos del almacenamiento**. \`storage.objects\`
guarda la ruta y el tamaño; los bytes están en otro servicio. Restaurar solo el
volcado deja una base que afirma tener documentos cuyos archivos no existen: la
descarga fallaría la verificación de SHA-256, que es exactamente lo que la
aplicación comprueba. El directorio \`almacenamiento/\` existe por eso.

## Orden de restauración

El orden importa: las referencias de la aplicación dependen de que las cuentas
existan antes que los perfiles.

### 1. La base

\`\`\`bash
psql "$CADENA_DE_CONEXION" -v ON_ERROR_STOP=1 -f esquema.sql
\`\`\`

\`\`\`bash
psql "$CADENA_DE_CONEXION" -v ON_ERROR_STOP=1 -f datos.sql
\`\`\`

Si el proyecto destino es nuevo, aplique antes \`roles.sql\`.

### 2. Las cuentas

\`auth.users\` se recrea con la API de administración, una cuenta por entrada de
\`auth-usuarios.json\`, **conservando el \`id\`**: los perfiles apuntan a él. Las
contraseñas no se restauran; cada persona la establece con el flujo de
recuperación. Si \`datos.sql\` se cargó antes de existir las cuentas, las claves
foráneas de \`profiles\` fallarán: en ese caso, restaure las cuentas primero y
vuelva a cargar los datos.

### 3. Los archivos

Suba el contenido de \`almacenamiento/\` al bucket \`acta-documents\`
**conservando las rutas**, que es lo que \`documents.storage_path\` espera. El
bucket debe quedar privado: la aplicación entrega los PDF por una ruta
autenticada y nunca expone el almacenamiento.

### 4. La comprobación que decide si la restauración sirvió

Para cada fila de \`documents\`, el archivo en \`storage_path\` debe existir y su
SHA-256 debe coincidir con la columna \`sha256\`. Es la misma comprobación que
hace la ruta de descarga, y sin ella la restauración no está verificada.

\`\`\`bash
node scripts/verify-backup.mjs <este directorio> --contra-destino
\`\`\`

## Periodicidad

El plan gratuito no incluye respaldos automáticos con retención. Mientras siga
en ese plan, este guion es el respaldo: ejecútelo antes de cada cambio en el
esquema y, en operación normal, con la periodicidad que corresponda al dato que
esté dispuesto a perder.

Un respaldo guardado en la misma máquina que se quiere proteger no es un
respaldo. Copie el directorio a otro soporte.
`;

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
