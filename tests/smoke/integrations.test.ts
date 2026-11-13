import { config } from "dotenv";
import { describe, expect, it } from "vitest";

/**
 * Pruebas smoke contra los proveedores reales.
 *
 * No se ejecutan con `npm test`. Cada bloque se omite si falta su credencial,
 * así que nunca fallan por ausencia de claves. Ejecutar con:
 *   npm run test:smoke
 *
 * Ninguna prueba envía correos ni escribe datos: solo comprueba que la
 * credencial es válida y que el contrato de la API sigue siendo el esperado.
 */
// El entorno se carga en el ambito del modulo y no en un hook: las
// condiciones de `describe.skipIf` se evaluan al recolectar las pruebas,
// antes de que corra ningun hook, y con la carga diferida se omitian todas.
config({ path: ".env.local", quiet: true });
config({ quiet: true });

const has = (name: string) => Boolean(process.env[name]?.trim());

describe.skipIf(!has("DEEPGRAM_API_KEY"))("Deepgram", () => {
  it("emite un token temporal", async () => {
    const response = await fetch("https://api.deepgram.com/v1/auth/grant", {
      method: "POST",
      headers: {
        authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ ttl_seconds: 60 }),
    });

    expect(response.ok).toBe(true);
    const payload = (await response.json()) as { access_token?: string; expires_in?: number };
    expect(payload.access_token).toBeTruthy();
    expect(payload.expires_in).toBeGreaterThan(0);
  });
});

describe.skipIf(!has("ANTHROPIC_API_KEY"))("Anthropic", () => {
  it("devuelve una salida estructurada válida con el modelo configurado", async () => {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const { zodOutputFormat } = await import("@anthropic-ai/sdk/helpers/zod");
    const { z } = await import("zod");

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 45_000 });
    const message = await client.messages.parse({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
      max_tokens: 256,
      system: "Responde únicamente con la estructura solicitada.",
      messages: [{ role: "user", content: "Devuelve ok=true y una nota breve en español." }],
      output_config: { format: zodOutputFormat(z.object({ ok: z.boolean(), nota: z.string() })) },
    });

    expect(message.parsed_output?.ok).toBe(true);
  });
});

describe.skipIf(!has("RESEND_API_KEY"))("Resend", () => {
  it("acepta la clave y lista los dominios verificados", async () => {
    const response = await fetch("https://api.resend.com/domains", {
      headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    });
    expect(response.status).toBe(200);
  });
});

describe.skipIf(!has("NEXT_PUBLIC_SUPABASE_URL") || !has("SUPABASE_SERVICE_ROLE_KEY"))("Supabase", () => {
  it("puede leer el esquema y encuentra el bucket privado de actas", async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );

    const { error } = await admin.from("institutions").select("id").limit(1);
    expect(error).toBeNull();

    const { data: buckets } = await admin.storage.listBuckets();
    const bucket = buckets?.find((item) => item.id === "acta-documents");
    expect(bucket, "falta el bucket acta-documents: ejecute supabase/migrations/0002_storage.sql").toBeTruthy();
    expect(bucket?.public, "el bucket de actas nunca debe ser público").toBe(false);
  });
});

describe.skipIf(!has("GOOGLE_CLIENT_ID") || !has("TOKEN_ENCRYPTION_KEY"))("Google Calendar", () => {
  it("tiene una clave de cifrado de 32 bytes y un redirect URI coherente", () => {
    expect(Buffer.from(process.env.TOKEN_ENCRYPTION_KEY!, "base64")).toHaveLength(32);
    expect(process.env.GOOGLE_REDIRECT_URI ?? "").toMatch(/\/api\/integrations\/google\/callback$/);
  });
});
