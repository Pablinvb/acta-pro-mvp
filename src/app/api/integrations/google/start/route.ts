import { NextResponse } from "next/server";
import { google } from "googleapis";
import { randomUUID } from "node:crypto";

import { requireApiSession } from "@/lib/session";
import { ApiError, toErrorResponse } from "@/lib/api/http";
import { getEnv, isGoogleConfigured } from "@/lib/env";
import { signState } from "@/lib/crypto/tokens";

export const runtime = "nodejs";

/** Alcance mínimo: solo lectura de eventos del calendario. */
export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events.readonly";

export async function GET() {
  try {
    const session = await requireApiSession();
    const env = getEnv();

    if (!isGoogleConfigured(env)) {
      throw new ApiError(503, "Google Calendar no está configurado.");
    }

    const client = new google.auth.OAuth2(
      env.GOOGLE_CLIENT_ID,
      env.GOOGLE_CLIENT_SECRET,
      env.GOOGLE_REDIRECT_URI,
    );

    // `state` firmado con la clave del servidor: protege contra CSRF y ata el
    // intercambio de código a la sesión que lo inició.
    const state = signState(
      JSON.stringify({ profileId: session.profile.id, nonce: randomUUID(), issuedAt: Date.now() }),
    );

    const url = client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: [CALENDAR_SCOPE],
      include_granted_scopes: false,
      state,
    });

    return NextResponse.redirect(url);
  } catch (error) {
    return toErrorResponse(error);
  }
}
