import { NextResponse } from "next/server";
import { google } from "googleapis";

import { requireApiSession } from "@/lib/session";
import { ApiError, toErrorResponse } from "@/lib/api/http";
import { getEnv, isGoogleConfigured } from "@/lib/env";
import { encryptToken, verifyState } from "@/lib/crypto/tokens";
import { saveGoogleCredentials } from "@/lib/google/credentials";

export const runtime = "nodejs";

const STATE_MAX_AGE_MS = 10 * 60 * 1000;

export async function GET(request: Request) {
  try {
    const session = await requireApiSession();
    const env = getEnv();
    if (!isGoogleConfigured(env)) throw new ApiError(503, "Google Calendar no está configurado.");

    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (url.searchParams.get("error")) {
      return NextResponse.redirect(new URL("/settings/integrations?google=cancelado", env.NEXT_PUBLIC_APP_URL));
    }
    if (!code || !state) throw new ApiError(400, "Respuesta de autorización incompleta.");

    let parsed: { profileId: string; issuedAt: number };
    try {
      parsed = JSON.parse(verifyState(state));
    } catch {
      throw new ApiError(400, "El parámetro de estado no es válido.");
    }
    if (parsed.profileId !== session.profile.id) {
      throw new ApiError(403, "El estado de autorización no corresponde a esta sesión.");
    }
    if (Date.now() - parsed.issuedAt > STATE_MAX_AGE_MS) {
      throw new ApiError(400, "La autorización caducó. Vuelva a iniciarla.");
    }

    const client = new google.auth.OAuth2(
      env.GOOGLE_CLIENT_ID,
      env.GOOGLE_CLIENT_SECRET,
      env.GOOGLE_REDIRECT_URI,
    );
    const { tokens } = await client.getToken(code);
    if (!tokens.access_token) throw new ApiError(502, "Google no devolvió un token de acceso.");

    // Los tokens se guardan cifrados; nunca se registran en logs.
    await saveGoogleCredentials({
      profile_id: session.profile.id,
      access_token_encrypted: encryptToken(tokens.access_token),
      refresh_token_encrypted: tokens.refresh_token ? encryptToken(tokens.refresh_token) : null,
      expiry_date: tokens.expiry_date ?? null,
      scope: tokens.scope ?? null,
    });

    return NextResponse.redirect(new URL("/settings/integrations?google=conectado", env.NEXT_PUBLIC_APP_URL));
  } catch (error) {
    return toErrorResponse(error);
  }
}
