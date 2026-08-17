import { NextResponse } from "next/server";

import { getSession } from "@/lib/session";
import {
  getEnv,
  isAnthropicConfigured,
  isDeepgramConfigured,
  isGoogleConfigured,
  isResendConfigured,
  isSupabaseConfigured,
} from "@/lib/env";
import { getGoogleCredentials } from "@/lib/google/credentials";

export const runtime = "nodejs";

/**
 * Estado de las integraciones.
 * Devuelve exclusivamente etiquetas de estado: nunca claves, tokens, URLs
 * privadas ni mensajes de error de los proveedores.
 */
export async function GET() {
  const env = getEnv();
  const session = await getSession();

  let googleCalendar: "connected" | "disconnected" = "disconnected";
  if (isGoogleConfigured(env) && session) {
    try {
      googleCalendar = (await getGoogleCredentials(session.profile.id)) ? "connected" : "disconnected";
    } catch {
      googleCalendar = "disconnected";
    }
  }

  return NextResponse.json({
    supabase: isSupabaseConfigured(env) ? "configured" : "missing",
    deepgram: isDeepgramConfigured(env) ? "configured" : "missing",
    anthropic: isAnthropicConfigured(env) ? "configured" : "missing",
    resend: isResendConfigured(env) ? "configured" : "missing",
    googleCalendar,
  });
}
