import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";

import { requireApiSession, requireMeetingAccess } from "@/lib/session";
import { ApiError, checkRateLimit, toErrorResponse } from "@/lib/api/http";
import { MinutesDocument } from "@/lib/pdf/minutes-document";
import { buildDocumentCode, buildStoragePath, contentFingerprint, sha256Hex } from "@/lib/pdf/render";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Genera el PDF en el servidor, calcula su huella, lo guarda en el bucket
 * privado y registra el documento. Nunca expone la ruta de almacenamiento ni
 * hace público el bucket: la descarga pasa por una ruta autenticada.
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
    const approved = record.status === "approved";
    const content = record.edited_content ?? record.content;
    const acceptedFlags = record.accepted_language_flags
      .map((index) => record.content.language_flags[index])
      .filter(Boolean);

    const documentCode = buildDocumentCode(detail, record.version);
    const generatedAt = new Date().toISOString();
    const fingerprint = contentFingerprint({
      documentCode,
      version: record.version,
      meetingId: record.meeting_id,
      content,
      signerNames: signatures.map((signature) => signature.signer_name),
    });

    const buffer = await renderToBuffer(
      MinutesDocument({
        detail,
        content,
        acceptedLanguageFlags: acceptedFlags,
        signatures,
        documentCode,
        version: record.version,
        approved,
        generatedAt,
        contentSha256: fingerprint,
        generator: record.generator,
      }),
    );

    const bytes = new Uint8Array(buffer);
    const fileHash = sha256Hex(bytes);
    const storagePath = buildStoragePath(
      detail.institution.id,
      detail.student.id,
      documentCode,
      fileHash
    );

    await session.repository.putDocumentFile(storagePath, bytes);
    const document = await session.repository.createDocument({
      minutes_id: minutesId,
      meeting_id: record.meeting_id,
      storage_path: storagePath,
      sha256: fileHash,
      document_code: documentCode,
      version: record.version,
    });

    await session.repository.appendAudit({
      institution_id: session.institution.id,
      actor_id: session.profile.id,
      meeting_id: record.meeting_id,
      action: "document.generated",
      metadata_json: {
        document_code: documentCode,
        version: record.version,
        sha256: fileHash,
        bytes: bytes.byteLength,
      },
    });

    return NextResponse.json({
      documentId: document.id,
      documentCode,
      sha256: fileHash,
      contentSha256: fingerprint,
      // Ruta interna autenticada: comprueba sesión e institución en cada descarga.
      downloadUrl: `/api/documents/download/${document.id}`,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
