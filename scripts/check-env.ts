#!/usr/bin/env tsx
/**
 * Comprueba presencia y formato básico de las variables de entorno.
 * Nunca imprime valores: solo si están presentes y si el formato es plausible.
 *
 * Uso: npm run check:env
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

type Severity = "required" | "optional" | "group";

interface Check {
  name: string;
  severity: Severity;
  describe: string;
  /** Devuelve un mensaje de error si el formato es implausible. */
  validate?: (value: string) => string | null;
}

const isUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? null : "debe usar http o https";
  } catch {
    return "no es una URL válida";
  }
};

const CHECKS: Check[] = [
  { name: "NEXT_PUBLIC_SUPABASE_URL", severity: "required", describe: "URL del proyecto Supabase", validate: isUrl },
  { name: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", severity: "required", describe: "clave publicable de Supabase" },
  {
    name: "SUPABASE_SERVICE_ROLE_KEY",
    severity: "required",
    describe: "clave de servicio de Supabase (solo servidor)",
  },
  { name: "DEEPGRAM_API_KEY", severity: "required", describe: "clave de Deepgram" },
  { name: "ANTHROPIC_API_KEY", severity: "required", describe: "clave de Anthropic" },

  { name: "ANTHROPIC_MODEL", severity: "optional", describe: "modelo de Anthropic (por defecto claude-sonnet-5)" },
  { name: "NEXT_PUBLIC_DEEPGRAM_MODEL", severity: "optional", describe: "modelo de Deepgram (por defecto nova-3)" },
  { name: "NEXT_PUBLIC_DEEPGRAM_LANGUAGE", severity: "optional", describe: "idioma (por defecto es-419)" },
  {
    name: "DEEPGRAM_DIARIZE_MODEL",
    severity: "optional",
    describe: "modelo de diarización",
    validate: (value) =>
      value === "latest" ? null : "debe ser 'latest'; el parámetro diarize=true está deprecado",
  },
  {
    name: "DEEPGRAM_TOKEN_TTL_SECONDS",
    severity: "optional",
    describe: "vigencia del token temporal",
    validate: (value) =>
      /^\d+$/.test(value) && Number(value) > 0 && Number(value) <= 86400 ? null : "debe ser un entero de 1 a 86400",
  },

  { name: "RESEND_API_KEY", severity: "optional", describe: "clave de Resend para envío real" },
  {
    name: "EMAIL_FROM",
    severity: "optional",
    describe: "remitente verificado",
    validate: (value) => (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value) ? null : "no parece un correo válido"),
  },

  { name: "GOOGLE_CLIENT_ID", severity: "optional", describe: "cliente OAuth de Google" },
  { name: "GOOGLE_CLIENT_SECRET", severity: "optional", describe: "secreto OAuth de Google" },
  {
    name: "GOOGLE_REDIRECT_URI",
    severity: "optional",
    describe: "URI de redirección registrada en Google",
    validate: (value) =>
      isUrl(value) ??
      (value.endsWith("/api/integrations/google/callback")
        ? null
        : "debe terminar en /api/integrations/google/callback"),
  },
  {
    name: "TOKEN_ENCRYPTION_KEY",
    severity: "optional",
    describe: "clave AES-256-GCM de 32 bytes en Base64",
    validate: (value) =>
      Buffer.from(value, "base64").length === 32 ? null : "debe ser de 32 bytes codificados en Base64",
  },

  { name: "RUNACHAY_BASE_URL", severity: "optional", describe: "conector simulado, sin API oficial" },
  { name: "RUNACHAY_API_KEY", severity: "optional", describe: "conector simulado, sin API oficial" },
  { name: "NEXT_PUBLIC_APP_URL", severity: "optional", describe: "URL pública de la aplicación", validate: isUrl },
];

/** Lee .env.local sin depender de dotenv en tiempo de ejecución de la app. */
function loadEnvFile() {
  for (const file of [".env.local", ".env"]) {
    const path = resolve(process.cwd(), file);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key] !== undefined) continue;
      process.env[key] = rawValue.replace(/^["']|["']$/g, "");
    }
  }
}

function truthy(value: string | undefined, fallback: boolean) {
  if (value === undefined || value.trim() === "") return fallback;
  return ["1", "true", "yes", "si", "sí"].includes(value.trim().toLowerCase());
}

function main() {
  loadEnvFile();

  const demoMode = truthy(process.env.DEMO_MODE, true);
  const lines: string[] = [];
  let missingRequired = 0;
  let invalid = 0;

  console.log(`ACTA PRO — comprobación de entorno\nDEMO_MODE=${demoMode ? "true" : "false"}\n`);

  for (const check of CHECKS) {
    const raw = process.env[check.name];
    const present = typeof raw === "string" && raw.trim() !== "";

    if (!present) {
      const required = check.severity === "required" && !demoMode;
      if (required) missingRequired += 1;
      lines.push(
        `${required ? "FALTA   " : "ausente "} ${check.name.padEnd(38)} ${check.describe}`,
      );
      continue;
    }

    const problem = check.validate?.(raw.trim()) ?? null;
    if (problem) {
      invalid += 1;
      lines.push(`INVÁLIDA ${check.name.padEnd(38)} ${problem}`);
      continue;
    }
    lines.push(`ok       ${check.name.padEnd(38)} presente`);
  }

  console.log(lines.join("\n"));

  if (process.env.DEEPGRAM_DIARIZE === "true" || process.env.DEEPGRAM_DIARIZE === "1") {
    invalid += 1;
    console.log(
      "\nINVÁLIDA DEEPGRAM_DIARIZE: el parámetro diarize está deprecado. Use únicamente DEEPGRAM_DIARIZE_MODEL=latest.",
    );
  }

  console.log("");
  if (demoMode) {
    console.log(
      "Modo demostración activo: la aplicación arranca sin claves y rotula toda simulación en la interfaz.",
    );
  }
  if (missingRequired > 0) {
    console.error(
      `Faltan ${missingRequired} variable(s) indispensable(s) y DEMO_MODE=false. La aplicación mostrará la página de configuración.`,
    );
  }
  if (invalid > 0) {
    console.error(`${invalid} variable(s) con formato inválido.`);
  }

  process.exit(missingRequired > 0 || invalid > 0 ? 1 : 0);
}

main();
