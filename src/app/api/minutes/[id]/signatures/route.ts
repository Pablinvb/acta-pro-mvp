import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiSession, requireMeetingAccess } from "@/lib/session";
import { ApiError, readJson, toErrorResponse } from "@/lib/api/http";
import { ACCEPTANCE_TEXT_VERSION } from "@/lib/consent";
import { assertTransition } from "@/lib/meeting-state";

export const runtime = "nodejs";

const MAX_SIGNATURE_BYTES = 400_000;

const bodySchema = z.object({
  signatures: z
    .array(
      z.object({
        signer_name: z.string().trim().min(2).max(160),
        signer_role: z.enum(["teacher", "representative", "student", "other"]),
        signature_data_url: z
          .string()
          .startsWith("data:image/png;base64,", "La firma debe ser una imagen PNG."),
        accepted: z.literal(true),
      }),
    )
    .min(1)
    .max(6),
});

/**
 * Registra las firmas manuscritas digitalizadas.
 * Exige al menos la firma docente y una firma de representante, y guarda la
 * versión del texto de aceptación que cada persona leyó.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiSession();
    const { id } = await context.params;

    const record = await session.repository.getMinutes(id);
    if (!record) throw new ApiError(404, "El acta no existe.");
    const meeting = await requireMeetingAccess(session, record.meeting_id);

    if (record.status !== "approved") {
      throw new ApiError(409, "El acta debe aprobarse antes de firmarse.");
    }

    const { signatures } = await readJson(request, bodySchema);

    for (const signature of signatures) {
      if (signature.signature_data_url.length > MAX_SIGNATURE_BYTES) {
        throw new ApiError(413, "La imagen de la firma es demasiado grande.");
      }
    }

    const roles = new Set(signatures.map((signature) => signature.signer_role));
    if (!roles.has("teacher") || !roles.has("representative")) {
      throw new ApiError(400, "Se requiere la firma de la persona docente y la del representante.");
    }

    for (const signature of signatures) {
      await session.repository.addSignature({
        minutes_id: id,
        signer_name: signature.signer_name,
        signer_role: signature.signer_role,
        signature_path: signature.signature_data_url,
        acceptance_text_version: ACCEPTANCE_TEXT_VERSION,
      });
    }

    assertTransition(meeting.status, "signed");
    await session.repository.updateMeeting(record.meeting_id, { status: "signed" });
    await session.repository.appendAudit({
      institution_id: session.institution.id,
      actor_id: session.profile.id,
      meeting_id: record.meeting_id,
      action: "minutes.signed",
      // Se registra el rol y la versión del texto; nunca la imagen de la firma.
      metadata_json: {
        version: record.version,
        roles: [...roles],
        acceptance_text_version: ACCEPTANCE_TEXT_VERSION,
      },
    });

    return NextResponse.json({ ok: true, signatures: signatures.length });
  } catch (error) {
    return toErrorResponse(error);
  }
}
