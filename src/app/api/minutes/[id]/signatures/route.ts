import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiSession, requireMeetingAccess } from "@/lib/session";
import { ApiError, readJson, toErrorResponse } from "@/lib/api/http";
import { verifySigners } from "@/lib/signing-code";
import { ACCEPTANCE_TEXT_VERSION } from "@/lib/consent";

export const runtime = "nodejs";

const MAX_SIGNATURE_BYTES = 400_000;

const bodySchema = z.object({
  password: z.string().max(1024).optional(),
  code: z.string().regex(/^\d{6}$/).optional(),
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
 * Registra las firmas manuscritas digitalizadas y finaliza la reunión.
 *
 * El registro de las firmas, el cambio de estado y la auditoría se ejecutan
 * como **una sola transacción** en `public.sign_minutes`. Antes eran tres
 * operaciones sueltas, de modo que un fallo intermedio podía dejar firmas
 * guardadas en una reunión que nunca llegaba a `signed`.
 *
 * Las comprobaciones que quedan aquí existen para dar un error inmediato y
 * legible; la autoridad es Postgres, donde la escritura directa sobre
 * `signatures` está revocada para que no se pueda eludir esta vía.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiSession();
    const { id } = await context.params;

    const record = await session.repository.getMinutes(id);
    if (!record) throw new ApiError(404, "El acta no existe.");
    await requireMeetingAccess(session, record.meeting_id);

    const { signatures, password, code } = await readJson(request, bodySchema);

    for (const signature of signatures) {
      if (signature.signature_data_url.length > MAX_SIGNATURE_BYTES) {
        throw new ApiError(413, "La imagen de la firma es demasiado grande.");
      }
    }

    const roles = new Set(signatures.map((signature) => signature.signer_role));
    if (!roles.has("teacher") || !roles.has("representative")) {
      throw new ApiError(400, "Se requiere la firma de la persona docente y la del representante.");
    }

    if (session.mode === "supabase" && !(await session.repository.listSignatures(id)).length) {
      if (!password || !code) throw new ApiError(403,"Se requiere la contraseña docente y el código del representante.");
      await verifySigners(session,id,password,code);
    }
    const result = await session.repository.signMinutes({
      minutes_id: id,
      acceptance_text_version: ACCEPTANCE_TEXT_VERSION,
      signatures: signatures.map((signature) => ({
        signer_name: signature.signer_name,
        signer_role: signature.signer_role,
        signature_path: signature.signature_data_url,
      })),
    });

    return NextResponse.json({
      ok: true,
      signatures: result.signatures,
      // El cliente puede distinguir una firma nueva de un reenvío idéntico.
      alreadySigned: result.already_signed,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
