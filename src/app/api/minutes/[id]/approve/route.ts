import { NextResponse } from "next/server";

import { requireApiSession, requireMeetingAccess } from "@/lib/session";
import { ApiError, toErrorResponse } from "@/lib/api/http";
import { assertTransition } from "@/lib/meeting-state";

export const runtime = "nodejs";

/** Aprobación humana: es el único punto donde el acta deja de ser BORRADOR. */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiSession();
    const { id } = await context.params;

    const record = await session.repository.getMinutes(id);
    if (!record) throw new ApiError(404, "El acta no existe.");
    const meeting = await requireMeetingAccess(session, record.meeting_id);

    const latest = await session.repository.getLatestMinutes(record.meeting_id);
    if (latest && latest.id !== record.id) {
      throw new ApiError(409, "Existe una versión más reciente del acta. Actualice la página.");
    }

    assertTransition(meeting.status, "approved");

    await session.repository.updateMinutes(id, {
      status: "approved",
      approved_at: new Date().toISOString(),
    });
    await session.repository.updateMeeting(record.meeting_id, { status: "approved" });
    await session.repository.appendAudit({
      institution_id: session.institution.id,
      actor_id: session.profile.id,
      meeting_id: record.meeting_id,
      action: "minutes.approved",
      metadata_json: { version: record.version },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
