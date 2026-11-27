import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

import { requireApiSession, requireMeetingAccess } from "@/lib/session";
import { ApiError, checkRateLimit, toErrorResponse } from "@/lib/api/http";
import { getEnv, isDeepgramConfigured } from "@/lib/env";
import { transcribePrerecorded } from "@/lib/deepgram/prerecorded";
import { reconcileSegments, type NormalizedSegment } from "@/lib/deepgram/segments";
import { DEMO_TRANSCRIPT, DEMO_TRANSCRIPT_DURATION_SECONDS } from "@/lib/demo/seed-data";

export const runtime = "nodejs";

const MAX_AUDIO_BYTES = 40 * 1024 * 1024; // ~40 MB, suficiente para reuniones de demostración
const ALLOWED_MIME = ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav"];

function demoSegments(): NormalizedSegment[] {
  return DEMO_TRANSCRIPT.map((segment, index) => ({
    id: `seg-${index + 1}`,
    speaker: segment.speaker_label,
    start: segment.start_seconds,
    end: segment.end_seconds,
    text: segment.text,
    confidence: segment.confidence,
    isFinal: true as const,
  }));
}

/**
 * Ruta de recuperación de la transcripción.
 *
 * Recibe la grabación local y la transcribe completa cuando el streaming falló
 * o dejó segmentos sin confirmar. Sin clave de Deepgram y en modo demostración
 * devuelve la transcripción ficticia, siempre rotulada como tal en la respuesta.
 */
export async function POST(request: Request) {
  try {
    const session = await requireApiSession();
    await checkRateLimit(session, "recover", 10);

    const form = await request.formData();
    const meetingId = String(form.get("meetingId") ?? "");
    if (!meetingId) throw new ApiError(400, "Falta el identificador de la reunión.");
    const meeting = await requireMeetingAccess(session, meetingId);

    if (!["recording", "processing"].includes(meeting.status)) {
      throw new ApiError(409, "La reunión no está en un estado que permita recuperar la transcripción.");
    }

    const participants = await session.repository.listParticipants(meetingId);
    if (participants.length === 0 || !participants.every((p) => p.consent_status === "granted")) {
      throw new ApiError(403, "No se registró el consentimiento de todas las personas participantes.");
    }

    const env = getEnv();
    const existing = await session.repository.listSegments(meetingId);
    const existingNormalized: NormalizedSegment[] = existing.map((segment) => ({
      id: segment.id,
      speaker: segment.speaker_label,
      start: segment.start_seconds,
      end: segment.end_seconds,
      text: segment.text,
      confidence: segment.confidence,
      isFinal: true,
    }));

    let recovered: NormalizedSegment[];
    let duration: number;
    let simulated = false;

    // El plan B de la demostración se pide de forma explícita desde la
    // interfaz. Sin esta marca, tener Deepgram configurado hacía que el botón
    // «Cargar transcripción de demostración» fallara por no enviar audio.
    const wantsDemo = String(form.get("source") ?? "") === "demo";

    if (wantsDemo) {
      if (!env.DEMO_MODE) {
        throw new ApiError(409, "La transcripción de demostración está desactivada (DEMO_MODE=false).");
      }
      recovered = demoSegments();
      duration = DEMO_TRANSCRIPT_DURATION_SECONDS;
      simulated = true;
    } else if (form.has("uploadId") && isDeepgramConfigured(env)) {
      if (session.mode !== "supabase") throw new ApiError(403,"Se requiere sesión docente.");
      const id = z.uuid().parse(form.get("uploadId"));
      const path = [session.institution.id,meetingId,session.profile.id,id].join("/");
      const db = createSupabaseAdminClient();
      const upload = await db.from("recovery_uploads").select("id").eq("id",id)
        .eq("object_path",path).gt("expires_at",new Date().toISOString()).maybeSingle();
      if (!upload.data) throw new ApiError(404,"La carga no está disponible.");
      const bucket = db.storage.from("acta-audio-recovery");
      const signed = await bucket.createSignedUrl(path,300);
      if (signed.error) throw new ApiError(404,"Audio privado no disponible.");
      const result = await transcribePrerecorded({url:signed.data.signedUrl},"application/json");
      recovered = result.segments;
      duration = result.duration;
      await bucket.remove([path]);
    } else if (isDeepgramConfigured(env)) {
      const file = form.get("audio");
      if (!(file instanceof File)) throw new ApiError(400, "Falta el archivo de audio.");
      if (file.size === 0) throw new ApiError(400, "La grabación está vacía.");
      if (file.size > MAX_AUDIO_BYTES) {
        throw new ApiError(413, "La grabación supera el tamaño máximo admitido.");
      }
      const mime = (file.type || "audio/webm").split(";")[0];
      if (!ALLOWED_MIME.includes(mime)) {
        throw new ApiError(415, "Formato de audio no admitido.");
      }

      const result = await transcribePrerecorded(await file.arrayBuffer(), mime);
      recovered = result.segments;
      duration = result.duration;
    } else {
      if (!env.DEMO_MODE) {
        throw new ApiError(503, "Deepgram no está configurado y el modo demostración está desactivado.");
      }
      recovered = demoSegments();
      duration = DEMO_TRANSCRIPT_DURATION_SECONDS;
      simulated = true;
    }

    // Se conservan los segmentos ya confirmados y solo se añaden los que no
    // solapan en tiempo con ninguno previo del mismo hablante.
    const merged = simulated ? recovered : reconcileSegments(existingNormalized, recovered);

    const saved = await session.repository.replaceSegments(
      meetingId,
      merged.map((segment) => ({
        speaker_label: segment.speaker,
        start_seconds: segment.start,
        end_seconds: segment.end,
        text: segment.text,
        confidence: segment.confidence,
        is_final: true,
      })),
    );

    await session.repository.appendAudit({
      institution_id: session.institution.id,
      actor_id: session.profile.id,
      meeting_id: meetingId,
      action: "transcription.recovered",
      metadata_json: { segments: saved.length, simulated },
    });

    // Las cargas privadas pendientes de limpieza caducan mediante recover-jobs.
    return NextResponse.json({
      text: saved.map((segment) => segment.text).join(" "),
      duration,
      simulated,
      audioRetained: false,
      keepLocalAudio: env.KEEP_AUDIO_AFTER_TRANSCRIPTION || env.DEMO_KEEP_AUDIO,
      segments: saved.map((segment) => ({
        id: segment.id,
        speaker: segment.speaker_label,
        start: segment.start_seconds,
        end: segment.end_seconds,
        text: segment.text,
        isFinal: true,
      })),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
