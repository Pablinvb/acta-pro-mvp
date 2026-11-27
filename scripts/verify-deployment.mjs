#!/usr/bin/env node
/**
 * Comprobación de un despliegue de ACTA PRO, por HTTP y sin sesión.
 *
 * Lo que se comprueba aquí es lo que depende del servidor donde se publica, no
 * de la aplicación: que las funciones responden, que las rutas privadas
 * rechazan a quien no ha entrado, que las cabeceras de seguridad llegan al
 * navegador y —la que importa— que **ninguna clave privada viaja en el paquete
 * de JavaScript** que se descarga el navegador.
 *
 * Los valores de las claves se leen de `.env.local` para buscarlos en lo
 * publicado. No se imprime ninguno: solo el nombre de la variable si apareciera
 * donde no debe.
 *
 *   node scripts/verify-deployment.mjs https://acta-pro.netlify.app
 */
import { readFileSync } from "node:fs";

const base = (process.argv[2] ?? "").replace(/\/$/, "");
if (!base.startsWith("http")) {
  console.error("Uso: node scripts/verify-deployment.mjs <url-del-despliegue>");
  process.exit(2);
}

const pasos = [];
const anotar = (nombre, ok, detalle = "") => {
  pasos.push({ nombre, ok });
  console.log(`  ${ok ? "OK   " : "FALLA"}  ${nombre.padEnd(52)}${detalle}`);
};

function variables() {
  try {
    const texto = readFileSync(".env.local", "utf8");
    return Object.fromEntries(
      texto
        .split(/\r?\n/)
        .filter((linea) => linea.includes("=") && !linea.trimStart().startsWith("#"))
        .map((linea) => [linea.slice(0, linea.indexOf("=")).trim(), linea.slice(linea.indexOf("=") + 1).trim()]),
    );
  } catch {
    return {};
  }
}

const PRIVADAS_CRITICAS = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "ANTHROPIC_API_KEY",
  "DEEPGRAM_API_KEY",
  "RESEND_API_KEY",
  "GOOGLE_CLIENT_SECRET",
  "TOKEN_ENCRYPTION_KEY",
  "RUNACHAY_API_KEY",
];

console.log(`\nComprobación del despliegue en ${base}\n`);

const inicio = await fetch(`${base}/`, { redirect: "manual" });

// Un proyecto privado de Netlify responde 401 a todo, incluida la página de
// acceso. Sin detectarlo, este guion informaría de diez fallos de la aplicación
// cuando lo que hay es una puerta antes de la aplicación. Se dice y se para: no
// se desactiva una protección para poder comprobar lo que hay detrás.
if (inicio.status === 401 && inicio.headers.get("x-nf-request-id")) {
  console.log("  El proyecto está protegido por el acceso de equipo de Netlify: responde 401 a todo.\n");
  console.log("  Eso es lo que se pretende en la validación restringida, pero impide comprobarlo desde aquí.");
  console.log("  Para comprobarlo hay que abrirlo en un navegador con sesión de Netlify, o hacer el");
  console.log("  proyecto público un momento, lo que es una decisión de quien lo administra.\n");
  process.exit(3);
}

anotar(
  "La aplicación responde",
  inicio.status < 400,
  `HTTP ${inicio.status}${inicio.headers.get("location") ? ` → ${inicio.headers.get("location")}` : ""}`,
);

const login = await fetch(`${base}/login`);
const loginHtml = await login.text();
anotar("La página de acceso se sirve", login.ok && loginHtml.includes("form"), `HTTP ${login.status}`);

// Cabeceras de seguridad, las que declara netlify.toml.
const esperadas = {
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
};
for (const [cabecera, valor] of Object.entries(esperadas)) {
  const recibido = login.headers.get(cabecera);
  anotar(`Cabecera ${cabecera}`, recibido === valor, recibido ?? "ausente");
}
anotar(
  "Cabecera permissions-policy restringe cámara y ubicación",
  (login.headers.get("permissions-policy") ?? "").includes("camera=()"),
  login.headers.get("permissions-policy") ?? "ausente",
);

// Estado de las integraciones. No devuelve claves, solo si están presentes.
const salud = await fetch(`${base}/api/health/integrations`);
let integraciones = {};
try {
  integraciones = await salud.json();
} catch {
  integraciones = {};
}
anotar(
  "Las funciones de servidor se ejecutan",
  salud.ok && typeof integraciones === "object" && Object.keys(integraciones).length > 0,
  `HTTP ${salud.status}`,
);
anotar(
  "Supabase configurado en el despliegue",
  integraciones.supabase === "configured",
  String(integraciones.supabase ?? "sin dato"),
);
anotar(
  "Deepgram configurado",
  integraciones.deepgram === "configured",
  String(integraciones.deepgram ?? "sin dato"),
);
anotar(
  "Anthropic configurado",
  integraciones.anthropic === "configured",
  String(integraciones.anthropic ?? "sin dato"),
);

// Rutas privadas sin sesión. Deben rechazar, no responder a medias.
const privadas = [
  ["POST", "/api/minutes/generate", JSON.stringify({ meetingId: "00000000-0000-4000-8000-000000000000" })],
  ["POST", "/api/documents/00000000-0000-4000-8000-000000000000/pdf", null],
  ["GET", "/api/documents/download/00000000-0000-4000-8000-000000000000", null],
  ["POST", "/api/integrations/deepgram/token", null],
];
for (const [metodo, ruta, cuerpo] of privadas) {
  const respuesta = await fetch(`${base}${ruta}`, {
    method: metodo,
    headers: cuerpo ? { "content-type": "application/json" } : undefined,
    body: cuerpo ?? undefined,
  });
  anotar(
    `Sin sesión, ${metodo} ${ruta.replace(/[0-9a-f-]{36}/, "<id>")} rechaza`,
    respuesta.status === 401 || respuesta.status === 403,
    `HTTP ${respuesta.status}`,
  );
}

// El paquete de cliente: se descarga lo que el navegador descargaría y se busca
// dentro cada clave privada.
const env = variables();
const guiones = [...loginHtml.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+\.js)"/g)].map((m) => m[1]);
const unicos = [...new Set(guiones)];
let texto = loginHtml;
let descargados = 0;
for (const ruta of unicos) {
  const respuesta = await fetch(`${base}${ruta}`);
  if (respuesta.ok) {
    texto += await respuesta.text();
    descargados += 1;
  }
}
anotar("Paquete de cliente descargado para inspección", descargados > 0, `${descargados} archivo(s) de ${unicos.length}`);

const comprobables = PRIVADAS_CRITICAS.filter((nombre) => env[nombre] && env[nombre].length >= 12);
const filtradas = comprobables.filter((nombre) => texto.includes(env[nombre]));

// Sin paquete descargado esta comprobación no dice nada, y dar por buena una
// búsqueda sobre cero archivos es peor que no hacerla: afirma lo que no ha
// mirado. Si no hay nada que inspeccionar, falla y dice por qué.
if (descargados === 0) {
  anotar("Ninguna clave privada en el paquete de cliente", false, "no se descargó nada que inspeccionar");
} else if (comprobables.length === 0) {
  anotar("Ninguna clave privada en el paquete de cliente", false, "no se leyó ninguna clave de .env.local");
} else {
  anotar(
    "Ninguna clave privada en el paquete de cliente",
    filtradas.length === 0,
    filtradas.length === 0
      ? `${comprobables.length} clave(s) buscada(s) en ${descargados} archivo(s)`
      : `FUGA: ${filtradas.join(", ")}`,
  );
}

const fallos = pasos.filter((paso) => !paso.ok);
console.log(`\n  ${pasos.length - fallos.length} / ${pasos.length} comprobaciones superadas`);
if (fallos.length > 0) {
  console.log(`\n  Pendiente: ${fallos.map((f) => f.nombre).join(" · ")}`);
  process.exit(1);
}
console.log("\n  Despliegue comprobado.");
