import { requireApiSession, requireMeetingAccess } from "@/lib/session";
import { ApiError, toErrorResponse } from "@/lib/api/http";

export const runtime = "nodejs";

/**
 * Entrega el PDF desde el almacenamiento privado.
 * Comprueba sesión y pertenencia antes de leer el archivo; el bucket nunca es
 * público y la ruta de almacenamiento no se expone al cliente.
 */
export async function GET(_request: Request, context: { params: Promise<{ documentId: string }> }) {
  try {
    const session = await requireApiSession();
    const { documentId } = await context.params;

    const document = await session.repository.getDocument(documentId);
    if (!document) throw new ApiError(404, "El documento no existe.");
    await requireMeetingAccess(session, document.meeting_id);

    const bytes = await session.repository.getDocumentFile(document.storage_path);
    if (!bytes) throw new ApiError(404, "El archivo no está disponible.");

    await session.repository.appendAudit({
      institution_id: session.institution.id,
      actor_id: session.profile.id,
      meeting_id: document.meeting_id,
      action: "document.downloaded",
      metadata_json: { document_code: document.document_code },
    });

    return new Response(bytes as BodyInit, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${document.document_code}.pdf"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
