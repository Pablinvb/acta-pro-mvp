import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";

import { requireApiSession, requireMeetingAccess } from "@/lib/session";
import { ApiError, checkRateLimit, toErrorResponse } from "@/lib/api/http";
import { MinutesDocument } from "@/lib/pdf/minutes-document";
import {
  buildDocumentCode,
  buildStoragePath,
  contentFingerprint,
  documentTimestamp,
  generationFingerprint,
  sha256Hex,
} from "@/lib/pdf/render";
import type { DocumentKind, DocumentRecord } from "@/lib/types";

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
 * Ahora la fecha se deriva del propio contenido y una huella determinista de
 * los datos de entrada identifica la generación, de modo que repetir la
 * solicitud devuelve el documento que ya existe.
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
    // Una vista previa de un borrador no es evidencia institucional y lleva la
    // banda BORRADOR. Se distingue en el registro para no confundirla con el
    // acta definitiva.
    const kind: DocumentKind = approved ? "final" : "preview";
    const content = record.edited_content ?? record.content;
    const acceptedFlags = record.accepted_language_flags
      .map((index) => record.content.language_flags[index])
      .filter(Boolean);

    const documentCode = buildDocumentCode(detail, record.version);
    const contentSha256 = contentFingerprint({
      documentCode,
      version: record.version,
      meetingId: record.meeting_id,
      content,
      signerNames: signatures.map((signature) => signature.signer_name),
    });

    // Fecha determinista: el momento al que corresponde el contenido, no el del
    // clic. Es lo que permite que dos generaciones con los mismos datos
    // produzcan bytes idénticos y, por tanto, el mismo SHA-256.
    const generatedAt = documentTimestamp({
      generatedAt: record.generated_at,
      approvedAt: record.approved_at,
      signedAt: signatures.map((signature) => signature.signed_at),
    });

    const fingerprint = generationFingerprint({
      minutesId,
      version: record.version,
      documentCode,
      approved,
      generator: record.generator,
      model: record.model,
      content,
      acceptedLanguageFlags: acceptedFlags,
      documentTimestamp: generatedAt,
      institution: {
        id: detail.institution.id,
        name: detail.institution.name,
        address: detail.institution.address,
      },
      meeting: {
        id: detail.meeting.id,
        title: detail.meeting.title,
        reason: detail.meeting.reason,
        scheduled_at: detail.meeting.scheduled_at,
        started_at: detail.meeting.started_at,
      },
      student: {
        id: detail.student.id,
        full_name: detail.student.full_name,
        grade: detail.student.grade,
        section: detail.student.section,
        external_id: detail.student.external_id,
      },
      participants: detail.participants.map((participant) => ({
        display_name: participant.display_name,
        participant_type: participant.participant_type,
        consent_status: participant.consent_status,
        consent_at: participant.consent_at,
        consent_text_version: participant.consent_text_version,
      })),
      signatures: signatures.map((signature) => ({
        signer_name: signature.signer_name,
        signer_role: signature.signer_role,
        signed_at: signature.signed_at,
        signature_path: signature.signature_path,
        acceptance_text_version: signature.acceptance_text_version,
      })),
    });

    // 1. Reutilización. Si ya hay un documento para exactamente estos datos, se
    //    devuelve ese en lugar de fabricar un duplicado — pero solo después de
    //    comprobar que el archivo sigue ahí y que sus bytes son los registrados.
    const existing = await session.repository.findDocumentByFingerprint(minutesId, fingerprint);
    if (existing) {
      await assertStoredFileMatches(session.repository, existing);
      return documentResponse(existing, contentSha256, true);
    }

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
        contentSha256,
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

    // 2. El registro va antes que el archivo, y no al contrario: el índice
    //    único sobre (minutes_id, generation_fingerprint) es lo que resuelve la
    //    carrera entre dos solicitudes simultáneas. Quien pierde no sube nada.
    let document: DocumentRecord;
    try {
      document = await session.repository.createDocument({
        minutes_id: minutesId,
        meeting_id: record.meeting_id,
        storage_path: storagePath,
        sha256: fileHash,
        document_code: documentCode,
        version: record.version,
        generation_fingerprint: fingerprint,
        kind,
      });
    } catch (error) {
      const winner = await session.repository.findDocumentByFingerprint(minutesId, fingerprint);
      if (!winner) throw error;
      await assertStoredFileMatches(session.repository, winner);
      return documentResponse(winner, contentSha256, true);
    }

    // 3. El archivo. Si no se puede guardar, se deshace el registro: una fila
    //    sin PDF detrás sería una referencia a evidencia que no existe.
    try {
      await session.repository.putDocumentFile(storagePath, bytes);
    } catch (error) {
      await session.repository
        .deleteOrphanDocument(document.id, fingerprint)
        .catch(() => undefined);
      throw error;
    }

    await session.repository.appendAudit({
      institution_id: session.institution.id,
      actor_id: session.profile.id,
      meeting_id: record.meeting_id,
      action: "document.generated",
      metadata_json: {
        document_code: documentCode,
        version: record.version,
        sha256: fileHash,
        kind,
        generation_fingerprint: fingerprint,
        bytes: bytes.byteLength,
      },
    });

    return documentResponse(document, contentSha256, false);
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * Reutilizar un registro sin comprobar su archivo sería afirmar que existe una
 * evidencia que quizá ya no está. Si falta o no coincide, se dice, en lugar de
 * devolver un enlace roto con apariencia de éxito.
 */
async function assertStoredFileMatches(
  repository: Awaited<ReturnType<typeof requireApiSession>>["repository"],
  document: DocumentRecord,
) {
  const stored = await repository.getDocumentFile(document.storage_path);
  if (!stored) {
    throw new ApiError(
      409,
      "El documento está registrado pero su archivo no se encuentra en el almacenamiento. No se reutiliza un registro cuya evidencia falta.",
    );
  }
  if (sha256Hex(stored) !== document.sha256) {
    throw new ApiError(
      409,
      "El archivo almacenado no coincide con el SHA-256 registrado. El documento no se reutiliza.",
    );
  }
}

function documentResponse(document: DocumentRecord, contentSha256: string, reused: boolean) {
  return NextResponse.json({
    documentId: document.id,
    documentCode: document.document_code,
    sha256: document.sha256,
    contentSha256,
    kind: document.kind,
    /** `true` cuando se devolvió un documento que ya existía. */
    reused,
    // Ruta interna autenticada: comprueba sesión e institución en cada descarga.
    downloadUrl: `/api/documents/download/${document.id}`,
  });
}
