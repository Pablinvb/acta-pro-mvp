import { NextResponse } from "next/server";

import { requireApiSession, requireMeetingAccess } from "@/lib/session";
import { ApiError, checkRateLimit, toErrorResponse } from "@/lib/api/http";
import { generateMinutesDocument } from "@/lib/documents/generate";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Genera el PDF en el servidor, calcula su huella, lo guarda en el bucket
 * privado y registra el documento. Nunca expone la ruta de almacenamiento ni
 * hace público el bucket: la descarga pasa por una ruta autenticada.
 *
 * La operación es idempotente. Antes, cada solicitud creaba un registro y un
 * archivo nuevos aunque nada hubiera cambiado: el PDF incrustaba la fecha del
 * reloj, así que los bytes —y con ellos el hash y la ruta— diferían siempre.
 * La orquestación vive en `@/lib/documents/generate`, donde puede ejercitarse
 * contra una base de datos real; aquí se resuelven la sesión y la respuesta.
 */
export async function POST(_request: Request, context: { params: Promise<{ minutesId: string }> }) {
  try {
    const session = await requireApiSession();
    const { minutesId } = await context.params;
    checkRateLimit(`pdf:${session.profile.id}`, 15, 60_000);

    const record = await session.repository.getMinutes(minutesId);
    if (!record) throw new ApiError(404, "El acta no existe.");
    await requireMeetingAccess(session, record.meeting_id);

    const detail = await session.repository.getMeetingDetail(record.meeting_id);
    if (!detail) throw new ApiError(404, "La reunión no está disponible.");

    const signatures = await session.repository.listSignatures(minutesId);

    const { document, contentSha256, reused } = await generateMinutesDocument({
      repository: session.repository,
      institutionId: session.institution.id,
      actorId: session.profile.id,
      record,
      detail,
      signatures,
    });

    return NextResponse.json({
      documentId: document.id,
      documentCode: document.document_code,
      sha256: document.sha256,
      contentSha256,
      kind: document.kind,
      reused,
      // Ruta interna autenticada: comprueba sesión e institución en cada descarga.
      downloadUrl: `/api/documents/download/${document.id}`,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
