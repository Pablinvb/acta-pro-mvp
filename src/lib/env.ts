import { z } from "zod";

/**
 * Lectura y validación de variables de entorno del servidor.
 *
 * Reglas del proyecto:
 * - Con DEMO_MODE=true la aplicación arranca sin ninguna clave y usa datos
 *   determinísticos claramente rotulados.
 * - Con DEMO_MODE=false las variables indispensables se validan y, si faltan,
 *   la aplicación redirige a /settings/integrations en vez de simular en silencio.
 * - Este módulo nunca devuelve valores de claves hacia el cliente.
 */

const booleanFromEnv = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined || value.trim() === "") return fallback;
      return ["1", "true", "yes", "si", "sí"].includes(value.trim().toLowerCase());
    });

const nonEmpty = z
  .string()
  .transform((value) => value.trim())
  .refine((value) => value.length > 0, "vacío")
  .optional()
  .catch(undefined);

const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: nonEmpty,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: nonEmpty,
  SUPABASE_SERVICE_ROLE_KEY: nonEmpty,

  DEEPGRAM_API_KEY: nonEmpty,
  NEXT_PUBLIC_DEEPGRAM_MODEL: z.string().optional().default("nova-3"),
  NEXT_PUBLIC_DEEPGRAM_LANGUAGE: z.string().optional().default("es-419"),
  DEEPGRAM_DIARIZE_MODEL: z.string().optional().default("latest"),
  DEEPGRAM_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().max(86400).optional().default(3600),
  DEEPGRAM_MIP_OPT_OUT: booleanFromEnv(true),

  ANTHROPIC_API_KEY: nonEmpty,
  ANTHROPIC_MODEL: z.string().optional().default("claude-sonnet-5"),
  /**
   * Cuánto se le concede a Anthropic antes de rendirse, en milisegundos.
   *
   * Existe por una razón concreta: el servidor donde se despliega mata la
   * función antes de que el SDK se rinda si su plazo es más largo que el de la
   * plataforma, y entonces quien usa la aplicación recibe un error de pasarela
   * en lugar del mensaje que la aplicación sí sabe dar. En Netlify el límite de
   * una función sincrónica es de 60 segundos y **no es configurable**, así que
   * el valor por defecto deja margen dentro de esa ventana.
   */
  ANTHROPIC_TIMEOUT_MS: z.coerce.number().int().positive().max(600_000).optional().default(45_000),

  RESEND_API_KEY: nonEmpty,
  EMAIL_FROM: nonEmpty,

  GOOGLE_CLIENT_ID: nonEmpty,
  GOOGLE_CLIENT_SECRET: nonEmpty,
  GOOGLE_REDIRECT_URI: z
    .string()
    .optional()
    .default("http://localhost:3000/api/integrations/google/callback"),
  GOOGLE_CALENDAR_ID: z.string().optional().default("primary"),
  TOKEN_ENCRYPTION_KEY: nonEmpty,

  RUNACHAY_BASE_URL: nonEmpty,
  RUNACHAY_API_KEY: nonEmpty,

  DEMO_MODE: booleanFromEnv(true),
  DEMO_KEEP_AUDIO: booleanFromEnv(false),
  KEEP_AUDIO_AFTER_TRANSCRIPTION: booleanFromEnv(false),
  NEXT_PUBLIC_APP_URL: z.string().optional().default("http://localhost:3000"),
});

export type ServerEnv = z.infer<typeof envSchema>;

let cached: ServerEnv | null = null;

export function getEnv(): ServerEnv {
  if (typeof window !== "undefined") {
    throw new Error("getEnv() es exclusivo del servidor: las claves no deben llegar al navegador.");
  }
  if (cached) return cached;
  // `safeParse` no puede fallar con este esquema (todo es opcional o tiene
  // valor por defecto); usamos parse para conservar los defaults tipados.
  cached = envSchema.parse(process.env);
  return cached;
}

/** Solo para pruebas: obliga a releer process.env. */
export function resetEnvCache() {
  cached = null;
}

export type IntegrationKey =
  | "supabase"
  | "deepgram"
  | "anthropic"
  | "resend"
  | "googleCalendar"
  | "runachay";

export function isSupabaseConfigured(env = getEnv()) {
  return Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}

export function isDeepgramConfigured(env = getEnv()) {
  return Boolean(env.DEEPGRAM_API_KEY);
}

export function isAnthropicConfigured(env = getEnv()) {
  return Boolean(env.ANTHROPIC_API_KEY);
}

export function isResendConfigured(env = getEnv()) {
  return Boolean(env.RESEND_API_KEY && env.EMAIL_FROM);
}

export function isGoogleConfigured(env = getEnv()) {
  return Boolean(
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REDIRECT_URI && env.TOKEN_ENCRYPTION_KEY,
  );
}

export function isDemoMode(env = getEnv()) {
  return env.DEMO_MODE;
}

/**
 * Variables indispensables cuando DEMO_MODE=false.
 * Runachay, Resend y Google Calendar son opcionales por diseño.
 */
export const REQUIRED_IN_PRODUCTION = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "DEEPGRAM_API_KEY",
  "ANTHROPIC_API_KEY",
] as const;

export function missingRequiredVariables(env = getEnv()): string[] {
  if (env.DEMO_MODE) return [];
  return REQUIRED_IN_PRODUCTION.filter((key) => !env[key]);
}
