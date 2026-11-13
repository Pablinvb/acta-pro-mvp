import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiSession, requireMeetingAccess } from "@/lib/session";
import { ApiError, checkRateLimit, readJson, toErrorResponse } from "@/lib/api/http";
import { getEnv, isDeepgramConfigured } from "@/lib/env";

export const runtime = "nodejs";

const bodySchema = z.object({ meetingId: z.string().min(1) });

/**
 * Entrega un token temporal de Deepgram al navegador.
 * DEEPGRAM_API_KEY nunca sale del servidor y el token no se registra en ningún log.
 */
export async function POST(request: Request) {
  try {
    const session = await requireApiSession();
    const { meetingId } = await readJson(request, bodySchema);
    const meeting = await requireMeetingAccess(session, meetingId);

    checkRateLimit(`dg-token:${session.profile.id}`, 20, 60_000);

    const env = getEnv();
    if (!isDeepgramConfigured(env)) {
      throw new ApiError(503, "Deepgram no está configurado. Use la transcripción de demostración.");
    }

    // Solo se puede transcribir con consentimiento registrado.
    const participants = await session.repository.listParticipants(meetingId);
    if (participants.length === 0 || !participants.every((p) => p.consent_status === "granted")) {
      throw new ApiError(403, "No se registró el consentimiento de todas las personas participantes.");
    }
    if (meeting.status !== "ready" && meeting.status !== "recording") {
      throw new ApiError(409, "La reunión no está en un estado que permita grabar.");
    }

    const response = await fetch("https://api.deepgram.com/v1/auth/grant", {
      method: "POST",
      headers: {
        authorization: `Token ${env.DEEPGRAM_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ ttl_seconds: env.DEEPGRAM_TOKEN_TTL_SECONDS }),
    });

    if (!response.ok) {
      // Un 401/403 aquí casi siempre significa que la clave es válida pero no
      // tiene permiso para emitir tokens temporales. Decirlo evita horas de
      // búsqueda: la transcripción pregrabada seguirá funcionando igual.
      if (response.status === 401 || response.status === 403) {
        throw new ApiError(
          502,
          "La clave de Deepgram no tiene permiso para emitir tokens temporales. La transcripción en vivo queda deshabilitada; al finalizar se transcribirá el audio completo.",
        );
      }
      throw new ApiError(502, "El proveedor de transcripción rechazó la solicitud de token.");
    }

    const granted = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!granted.access_token) {
      throw new ApiError(502, "El proveedor de transcripción no devolvió un token válido.");
    }

    // Auditoría sin token ni contenido.
    console.info(
      `[acta-pro] token de transcripción emitido meeting=${meetingId} user=${session.profile.id} at=${new Date().toISOString()}`,
    );

    return NextResponse.json({
      access_token: granted.access_token,
      expires_in: granted.expires_in ?? env.DEEPGRAM_TOKEN_TTL_SECONDS,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
