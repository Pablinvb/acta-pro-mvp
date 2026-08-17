import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiSession, requireMeetingAccess } from "@/lib/session";
import { ApiError, readJson, toErrorResponse } from "@/lib/api/http";
import { MinutesSchema } from "@/lib/schemas/minutes";

export const runtime = "nodejs";

const bodySchema = z.object({
  content: MinutesSchema,
  accepted_language_flags: z.array(z.number().int().min(0)).max(100),
});

/**
 * Guarda la capa de edición humana.
 * El borrador original de la IA se conserva intacto en `content`; las
 * correcciones viven en `edited_content` como una versión superpuesta.
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiSession();
    const { id } = await context.params;

    const record = await session.repository.getMinutes(id);
    if (!record) throw new ApiError(404, "El acta no existe.");
    const meeting = await requireMeetingAccess(session, record.meeting_id);

    if (meeting.status === "signed" || meeting.status === "sent") {
      throw new ApiError(409, "El acta ya está firmada y no admite ediciones.");
    }

    const body = await readJson(request, bodySchema);
    const validFlagIndexes = body.accepted_language_flags.filter(
      (index) => index < record.content.language_flags.length,
    );

    const updated = await session.repository.updateMinutes(id, {
      edited_content: body.content,
      accepted_language_flags: validFlagIndexes,
    });

    await session.repository.appendAudit({
      institution_id: session.institution.id,
      actor_id: session.profile.id,
      meeting_id: record.meeting_id,
      action: "minutes.edited",
      metadata_json: {
        version: record.version,
        accepted_language_flags: validFlagIndexes.length,
      },
    });

    return NextResponse.json({ ok: true, version: updated.version });
  } catch (error) {
    return toErrorResponse(error);
  }
}
