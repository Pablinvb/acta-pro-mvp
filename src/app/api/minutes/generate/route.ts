import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiSession, requireMeetingAccess } from "@/lib/session";
import { ApiError, checkRateLimit, readJson, toErrorResponse } from "@/lib/api/http";
import { getEnv, isAnthropicConfigured } from "@/lib/env";
import { generateMinutesWithAnthropic } from "@/lib/anthropic/generate-minutes";
import { enqueue, generationFingerprint } from "@/lib/anthropic/jobs";
import { generateDemoMinutes } from "@/lib/demo/demo-minutes";
import { assertTransition } from "@/lib/meeting-state";
import type { Minutes } from "@/lib/schemas/minutes";

export const runtime = "nodejs";
export const maxDuration = 120;

const bodySchema = z.object({ meetingId: z.string().min(1) });

/**
 * Genera una nueva versión del borrador del acta.
 * El resultado siempre nace como BORRADOR: la aprobación es humana.
 */
export async function POST(request: Request) {
  try {
    const session = await requireApiSession();
    const { meetingId } = await readJson(request, bodySchema);
    const meeting = await requireMeetingAccess(session, meetingId);

    await checkRateLimit(session, "minutes", 8);

    if (!["processing", "draft"].includes(meeting.status)) {
      throw new ApiError(409, "La reunión debe tener una transcripción antes de generar el acta.");
    }

    const detail = await session.repository.getMeetingDetail(meetingId);
    if (!detail) throw new ApiError(404, "La reunión no está disponible.");

    const segments = await session.repository.listSegments(meetingId);
    if (segments.length === 0) {
      throw new ApiError(409, "No hay transcripción para generar el acta.");
    }

    const speakerNames = Object.fromEntries(
      detail.participants
        .filter((participant) => participant.speaker_label)
        .map((participant) => [participant.speaker_label!, participant.display_name]),
    );

    if (session.mode === "supabase" && isAnthropicConfigured()) {
      const job = await enqueue(meetingId, session.institution.id, session.profile.id,
        generationFingerprint(detail, segments, speakerNames));
      return NextResponse.json(job, { status: 202 });
    }
    const env = getEnv();
    let content: Minutes;
    let generator: "anthropic" | "demo";
    let model: string | null;

    if (isAnthropicConfigured(env)) {
      const result = await generateMinutesWithAnthropic(detail, segments, speakerNames);
      content = result.minutes;
      generator = "anthropic";
      model = result.model;
    } else {
      if (!env.DEMO_MODE) {
        throw new ApiError(503, "Anthropic no está configurado y el modo demostración está desactivado.");
      }
      content = generateDemoMinutes(segments, speakerNames);
      generator = "demo";
      model = null;
    }

    const record = await session.repository.createMinutes({
      meeting_id: meetingId,
      content,
      generator,
      model,
    });

    if (meeting.status === "processing") {
      assertTransition(meeting.status, "draft");
      await session.repository.updateMeeting(meetingId, { status: "draft" });
    }

    await session.repository.appendAudit({
      institution_id: session.institution.id,
      actor_id: session.profile.id,
      meeting_id: meetingId,
      action: "minutes.generated",
      // Métricas, no contenido.
      metadata_json: {
        version: record.version,
        generator,
        model,
        segments: segments.length,
        agreements: content.agreements.length,
        language_flags: content.language_flags.length,
      },
    });

    return NextResponse.json({ minutesId: record.id, version: record.version, generator });
  } catch (error) {
    return toErrorResponse(error);
  }
}
