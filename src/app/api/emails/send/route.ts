import { NextResponse } from "next/server";
import { Resend } from "resend";
import { z } from "zod";

import { requireApiSession, requireMeetingAccess } from "@/lib/session";
import { ApiError, checkRateLimit, readJson, toErrorResponse } from "@/lib/api/http";
import { getEnv, isResendConfigured } from "@/lib/env";

export const runtime = "nodejs";

const bodySchema = z.object({
  documentId: z.string().min(1),
  recipientEmail: z.email("El correo del destinatario no es válido."),
});

/**
 * Envía el acta al representante.
 * Sin proveedor configurado devuelve una vista previa rotulada como simulación;
 * nunca se afirma que hubo un envío real.
 */
export async function POST(request: Request) {
  try {
    const session = await requireApiSession();
    const { documentId, recipientEmail } = await readJson(request, bodySchema);
    await checkRateLimit(session, "email", 10);

    const document = await session.repository.getDocument(documentId);
    if (!document) throw new ApiError(404, "El documento no existe.");
    const meeting = await requireMeetingAccess(session, document.meeting_id);
    const detail = await session.repository.getMeetingDetail(document.meeting_id);
    if (!detail) throw new ApiError(404, "La reunión no está disponible.");

    if (meeting.status !== "signed" && meeting.status !== "sent") {
      throw new ApiError(409, "El acta debe estar firmada antes de enviarse.");
    }

    const env = getEnv();
    const subject = `Acta de reunión ${document.document_code} — ${detail.student.full_name}`;
    const body = [
      `Estimada persona representante de ${detail.student.full_name}:`,
      "",
      `Adjuntamos el acta de la reunión "${detail.meeting.title}" realizada en ${detail.institution.name}.`,
      "",
      `Código del documento: ${document.document_code}`,
      `Versión: ${document.version}`,
      `Huella SHA-256 del archivo: ${document.sha256}`,
      "",
      "El documento incluye los acuerdos y compromisos registrados durante la reunión, así como las firmas de las personas participantes.",
      "",
      `Atentamente,`,
      `${session.profile.full_name} — ${detail.institution.name}`,
    ].join("\n");

    if (!isResendConfigured(env)) {
      if (!env.DEMO_MODE) {
        throw new ApiError(503, "El proveedor de correo no está configurado.");
      }
      return NextResponse.json({
        simulated: true,
        preview: { to: recipientEmail, subject, body },
      });
    }

    const bytes = await session.repository.getDocumentFile(document.storage_path);
    if (!bytes) throw new ApiError(404, "El archivo del acta no está disponible.");

    const resend = new Resend(env.RESEND_API_KEY);
    const result = await resend.emails.send({
      from: env.EMAIL_FROM!,
      to: recipientEmail,
      subject,
      text: body,
      attachments: [
        {
          filename: `${document.document_code}.pdf`,
          content: Buffer.from(bytes).toString("base64"),
        },
      ],
    });

    if (result.error) {
      throw new ApiError(502, "El proveedor de correo rechazó el envío.");
    }

    const sentAt = new Date().toISOString();
    await session.repository.updateDocument(documentId, {
      sent_at: sentAt,
      provider_message_id: result.data?.id ?? null,
    });
    if (meeting.status === "signed") {
      await session.repository.updateMeeting(document.meeting_id, { status: "sent" });
    }
    await session.repository.appendAudit({
      institution_id: session.institution.id,
      actor_id: session.profile.id,
      meeting_id: document.meeting_id,
      action: "document.sent",
      // Se registran identificadores, nunca el contenido del correo.
      metadata_json: {
        document_code: document.document_code,
        provider_message_id: result.data?.id ?? null,
        sent_at: sentAt,
      },
    });

    return NextResponse.json({
      simulated: false,
      preview: { to: recipientEmail, subject },
      providerMessageId: result.data?.id ?? null,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
