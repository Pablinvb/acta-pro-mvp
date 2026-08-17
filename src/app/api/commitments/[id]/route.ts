import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiSession, requireMeetingAccess } from "@/lib/session";
import { ApiError, readJson, toErrorResponse } from "@/lib/api/http";

export const runtime = "nodejs";

const bodySchema = z.object({ status: z.enum(["pending", "in_progress", "completed"]) });

/**
 * Cambia el estado de avance de un acuerdo o compromiso.
 * El texto del acuerdo no se puede editar desde aquí: proviene del acta
 * aprobada y firmada, que es inmutable.
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiSession();
    const { id } = await context.params;
    const { status } = await readJson(request, bodySchema);

    const all = await session.repository.listCommitments(session.institution.id);
    const found = all.find((item) => item.commitment.id === id);
    if (!found) throw new ApiError(404, "El compromiso no existe.");
    await requireMeetingAccess(session, found.commitment.meeting_id);

    const updated = await session.repository.setCommitmentStatus(id, status);

    await session.repository.appendAudit({
      institution_id: session.institution.id,
      actor_id: session.profile.id,
      meeting_id: found.commitment.meeting_id,
      action: "commitment.status_changed",
      // Se registra el cambio de estado, nunca el texto del acuerdo.
      metadata_json: { kind: updated.kind, item_index: updated.item_index, status },
    });

    return NextResponse.json({ ok: true, status: updated.status });
  } catch (error) {
    return toErrorResponse(error);
  }
}
