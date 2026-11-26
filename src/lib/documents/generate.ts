import { renderToBuffer } from "@react-pdf/renderer";

import { MinutesDocument } from "@/lib/pdf/minutes-document";
import {
  buildDocumentCode,
  buildStoragePath,
  contentFingerprint,
  documentTimestamp,
  generationFingerprint,
  sha256Hex,
} from "@/lib/pdf/render";
import type { Repository } from "@/lib/data/repository";
import type {
  DocumentKind,
  DocumentRecord,
  MeetingDetail,
  MinutesRecord,
  Signature,
} from "@/lib/types";

/**
 * El documento registrado no se corresponde con el archivo almacenado.
 *
 * Se trata como un error propio, y no como un fallo genérico, porque significa
 * algo concreto: hay una evidencia que no se puede sostener. Devolver el enlace
 * de todas formas haría pasar por válido un documento que no lo es.
 */
export class DocumentIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentIntegrityError";
  }
}

export interface GenerateDocumentInput {
  repository: Repository;
  /** Institución del actor, para la anotación de auditoría. */
  institutionId: string;
  actorId: string;
  record: MinutesRecord;
  detail: MeetingDetail;
  signatures: Signature[];
}

export interface GeneratedDocument {
  document: DocumentRecord;
  /** Huella del contenido del acta, que se imprime en el propio PDF. */
  contentSha256: string;
  /** `true` cuando se devolvió un documento que ya existía. */
  reused: boolean;
}

/**
 * Genera -o recupera- el PDF del acta y lo deja registrado.
 *
 * Vive fuera de la ruta HTTP a propósito: la idempotencia es la parte delicada
 * y conviene poder ejercitarla contra una base de datos real, no solo a través
 * de una petición. La ruta se queda con lo suyo: sesión, límite de tasa y
 * códigos de respuesta.
 *
 * El orden de los pasos no es casual y se explica en cada uno.
 */
export async function generateMinutesDocument(
  input: GenerateDocumentInput,
): Promise<GeneratedDocument> {
  const { repository, record, detail, signatures } = input;

  const approved = record.status === "approved";
  // Una vista previa de un borrador no es evidencia institucional y lleva la
  // banda BORRADOR. Se distingue en el registro para no confundirla con el
  // acta definitiva.
  const kind: DocumentKind = approved ? "final" : "preview";
  const content = record.edited_content ?? record.content;
  const acceptedLanguageFlags = record.accepted_language_flags
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
    minutesId: record.id,
    documentTimestamp: generatedAt,
    version: record.version,
    documentCode,
    approved,
    generator: record.generator,
    model: record.model,
    content,
    acceptedLanguageFlags,
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

  // 1. Reutilización. Si ya hay un documento para exactamente estos datos se
  //    devuelve ese en lugar de fabricar un duplicado, pero solo después de
  //    comprobar que el archivo sigue ahí y que sus bytes son los registrados.
  const existing = await repository.findDocumentByFingerprint(record.id, fingerprint);
  if (existing) {
    await assertStoredFileMatches(repository, existing);
    return { document: existing, contentSha256, reused: true };
  }

  const buffer = await renderToBuffer(
    MinutesDocument({
      detail,
      content,
      acceptedLanguageFlags,
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
    fileHash,
  );

  // 2. El registro va antes que el archivo, y no al contrario: el índice único
  //    sobre (minutes_id, generation_fingerprint) es lo que resuelve la carrera
  //    entre dos solicitudes simultáneas. Quien la pierde no sube nada.
  let document: DocumentRecord;
  try {
    document = await repository.createDocument({
      minutes_id: record.id,
      meeting_id: record.meeting_id,
      storage_path: storagePath,
      sha256: fileHash,
      document_code: documentCode,
      version: record.version,
      generation_fingerprint: fingerprint,
      kind,
    });
  } catch (error) {
    const winner = await repository.findDocumentByFingerprint(record.id, fingerprint);
    if (!winner) throw error;
    await assertStoredFileMatches(repository, winner);
    return { document: winner, contentSha256, reused: true };
  }

  // 3. El archivo. Si no se puede guardar se deshace el registro: una fila sin
  //    PDF detrás sería una referencia a una evidencia que no existe.
  try {
    await repository.putDocumentFile(storagePath, bytes);
  } catch (error) {
    await repository.deleteOrphanDocument(document.id, fingerprint).catch(() => undefined);
    throw error;
  }

  await repository.appendAudit({
    institution_id: input.institutionId,
    actor_id: input.actorId,
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

  return { document, contentSha256, reused: false };
}

/**
 * Reutilizar un registro sin comprobar su archivo sería afirmar que existe una
 * evidencia que quizá ya no está.
 */
async function assertStoredFileMatches(repository: Repository, document: DocumentRecord) {
  const stored = await repository.getDocumentFile(document.storage_path);
  if (!stored) {
    throw new DocumentIntegrityError(
      "El documento está registrado pero su archivo no se encuentra en el almacenamiento. No se reutiliza un registro cuya evidencia falta.",
    );
  }
  if (sha256Hex(stored) !== document.sha256) {
    throw new DocumentIntegrityError(
      "El archivo almacenado no coincide con el SHA-256 registrado. El documento no se reutiliza.",
    );
  }
}
