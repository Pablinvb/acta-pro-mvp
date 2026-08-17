import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiSession, requireMeetingAccess } from "@/lib/session";
import { ApiError, readJson, toErrorResponse } from "@/lib/api/http";

export const runtime = "nodejs";

const segmentSchema = z.object({
  speaker: z.string().min(1).max(40),
  start: z.number().min(0),
  end: z.number().min(0),
  text: z.string().min(1).max(5000),
  confidence: z.number().min(0).max(1).nullable().optional(),
});

const bodySchema = z.object({
  segments: z.array(segmentSchema).max(2000),
  source: z.enum(["live", "demo"]),
});

/**
 * Persiste los segmentos finales de la transcripción en vivo.
 * Solo se guardan resultados definitivos; el texto provisional nunca llega aquí.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiSession();
    const { id } = await context.params;
    const meeting = await requireMeetingAccess(session, id);
    const { segments, source } = await readJson(request, bodySchema);

    if (!["recording", "processing", "draft"].includes(meeting.status)) {
      throw new ApiError(409, "La reunión no está en un estado que permita guardar la transcripción.");
    }

    const invalid = segments.find((segment) => segment.end < segment.start);
    if (invalid) throw new ApiError(400, "Un segmento tiene un rango temporal inválido.");

    const saved = await session.repository.replaceSegments(
      id,
      segments.map((segment) => ({
        speaker_label: segment.speaker,
        start_seconds: segment.start,
        end_seconds: segment.end,
        text: segment.text,
        confidence: segment.confidence ?? null,
        is_final: true,
      })),
    );

    await session.repository.appendAudit({
      institution_id: session.institution.id,
      actor_id: session.profile.id,
      meeting_id: id,
      action: "transcription.saved",
      // Se registra el volumen, nunca el contenido.
      metadata_json: { segments: saved.length, source },
    });

    return NextResponse.json({ segments: saved.length });
  } catch (error) {
    return toErrorResponse(error);
  }
}
