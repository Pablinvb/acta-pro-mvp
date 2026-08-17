import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiSession, requireMeetingAccess } from "@/lib/session";
import { ApiError, readJson, toErrorResponse } from "@/lib/api/http";
import { assertTransition } from "@/lib/meeting-state";

export const runtime = "nodejs";

const bodySchema = z.object({ action: z.enum(["start", "stop", "cancel"]) });

/** Controla el ciclo de vida de la grabación y deja rastro en auditoría. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiSession();
    const { id } = await context.params;
    const meeting = await requireMeetingAccess(session, id);
    const { action } = await readJson(request, bodySchema);

    if (action === "start") {
      const participants = await session.repository.listParticipants(id);
      if (participants.length === 0 || !participants.every((p) => p.consent_status === "granted")) {
        throw new ApiError(403, "No se puede grabar sin el consentimiento de todas las personas participantes.");
      }
      assertTransition(meeting.status, "recording");
      const updated = await session.repository.updateMeeting(id, {
        status: "recording",
        started_at: new Date().toISOString(),
      });
      await session.repository.appendAudit({
        institution_id: session.institution.id,
        actor_id: session.profile.id,
        meeting_id: id,
        action: "recording.started",
        metadata_json: { participants: participants.length },
      });
      return NextResponse.json({ status: updated.status });
    }

    if (action === "cancel") {
      assertTransition(meeting.status, "ready");
      const updated = await session.repository.updateMeeting(id, { status: "ready", started_at: null });
      return NextResponse.json({ status: updated.status });
    }

    assertTransition(meeting.status, "processing");
    const updated = await session.repository.updateMeeting(id, {
      status: "processing",
      ended_at: new Date().toISOString(),
    });
    await session.repository.appendAudit({
      institution_id: session.institution.id,
      actor_id: session.profile.id,
      meeting_id: id,
      action: "recording.stopped",
      metadata_json: {},
    });
    return NextResponse.json({ status: updated.status });
  } catch (error) {
    return toErrorResponse(error);
  }
}
