import { sha256Hex } from "@/lib/crypto/hash";

import type { Minutes } from "@/lib/schemas/minutes";
import type { MeetingDetail } from "@/lib/types";

/**
 * Serialización canónica: mismas claves, mismo orden, mismo resultado.
 * Permite recalcular la huella del contenido y comprobar que el acta impresa
 * corresponde a la versión almacenada.
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`).join(",")}}`;
}

export { sha256Hex };

/** Huella del contenido del acta, independiente del archivo PDF. */
export function contentFingerprint(input: {
  documentCode: string;
  version: number;
  meetingId: string;
  content: Minutes;
  signerNames: string[];
}): string {
  return sha256Hex(canonicalize(input));
}

/**
 * Código único del documento.
 * Formato: ACTA-<año>-<8 caracteres del identificador de reunión>-v<versión>.
 */
export function buildDocumentCode(detail: MeetingDetail, version: number): string {
  const reference = detail.meeting.scheduled_at ?? detail.meeting.created_at;
  const year = new Date(reference).getUTCFullYear();
  const slug = detail.meeting.id.replace(/-/g, "").slice(0, 8).toUpperCase();
  return `ACTA-${year}-${slug}-v${version}`;
}

export function buildStoragePath(
  institutionId: string,
  studentId: string,
  documentCode: string,
  fileHash?: string
): string {
  if (fileHash && !/^[a-f0-9]{64}$/.test(fileHash)) {
    throw new Error("Hash SHA-256 inválido.");
  }

  const filename = fileHash
    ? `${documentCode}-${fileHash}.pdf`
    : `${documentCode}.pdf`;

  return `${institutionId}/${studentId}/${filename}`;
}
/**
 * Instante al que corresponde el documento, no el del clic.
 *
 * Tomar la fecha del reloj hacía imposible la idempotencia: los bytes del PDF
 * cambiaban en cada generación y con ellos el hash y la ruta. Derivarla del
 * propio contenido —el acta se generó, se aprobó, se firmó— hace que dos
 * generaciones con los mismos datos produzcan el mismo archivo.
 *
 * Se devuelve el más reciente de los instantes conocidos, que es el momento en
 * que el acta quedó como está.
 */
export function documentTimestamp(input: {
  generatedAt: string;
  approvedAt: string | null;
  signedAt: string[];
}): string {
  const candidates = [input.generatedAt, input.approvedAt, ...input.signedAt]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .map((value) => ({ value, time: Date.parse(value) }))
    .filter((entry) => Number.isFinite(entry.time));

  if (candidates.length === 0) {
    // Sin ninguna fecha utilizable no hay nada que derivar. Es preferible un
    // instante fijo y reconocible a uno del reloj, que romperia la huella.
    return new Date(0).toISOString();
  }

  return candidates.reduce((latest, entry) => (entry.time > latest.time ? entry : latest)).value;
}

/**
 * Versión del generador de PDF.
 *
 * Forma parte de la huella de generación: si cambia la plantilla, la huella
 * cambia y el documento se vuelve a generar en lugar de reutilizar uno hecho
 * con el formato anterior. Súbala al modificar `minutes-document.tsx`.
 */
export const PDF_GENERATOR_VERSION = "2026-11-27.1";

export interface GenerationInput {
  minutesId: string;
  /** Instante al que corresponde el documento. Ver `documentTimestamp`. */
  documentTimestamp: string;
  version: number;
  documentCode: string;
  approved: boolean;
  generator: string;
  model: string | null;
  content: Minutes;
  acceptedLanguageFlags: Minutes["language_flags"];
  institution: { id: string; name: string; address: string | null };
  meeting: {
    id: string;
    title: string;
    reason: string | null;
    scheduled_at: string | null;
    started_at: string | null;
  };
  student: {
    id: string;
    full_name: string;
    grade: string | null;
    section: string | null;
    external_id: string | null;
  };
  participants: {
    display_name: string;
    participant_type: string;
    consent_status: string;
    consent_at: string | null;
    consent_text_version: string | null;
  }[];
  signatures: {
    signer_name: string;
    signer_role: string;
    signed_at: string;
    signature_path: string;
    verification_method?: string;
    acceptance_text_version: string;
  }[];
}

/**
 * Huella determinista de los datos de entrada de la generación.
 *
 * No es el hash de los bytes del PDF: esos cambian en cada llamada porque el
 * documento incrusta la fecha de generación. Esta huella responde a otra
 * pregunta —si los datos que producen el PDF son los mismos— y es la que
 * permite reutilizar un documento en vez de fabricar otro idéntico.
 *
 * De la imagen de cada firma se guarda su hash, no la imagen: basta para
 * detectar un cambio y evita arrastrar datos personales a la huella.
 */
export function generationFingerprint(input: GenerationInput): string {
  return sha256Hex(
    canonicalize({
      generatorVersion: PDF_GENERATOR_VERSION,
      minutesId: input.minutesId,
      documentTimestamp: input.documentTimestamp,
      version: input.version,
      documentCode: input.documentCode,
      approved: input.approved,
      generator: input.generator,
      model: input.model,
      content: input.content,
      acceptedLanguageFlags: input.acceptedLanguageFlags,
      institution: input.institution,
      meeting: input.meeting,
      student: input.student,
      // El orden en que lleguen participantes o firmas no debe cambiar la
      // huella: lo que importa es el conjunto.
      participants: [...input.participants]
        .map((p) => ({
          display_name: p.display_name,
          participant_type: p.participant_type,
          consent_status: p.consent_status,
          consent_at: p.consent_at,
          consent_text_version: p.consent_text_version,
        }))
        .sort((a, b) => canonicalize(a).localeCompare(canonicalize(b))),
      signatures: [...input.signatures]
        .map((s) => ({
          signer_name: s.signer_name,
          signer_role: s.signer_role,
          signed_at: s.signed_at,
          acceptance_text_version: s.acceptance_text_version,
          verification_method: s.verification_method ?? "no_registrado",
          signature_sha256: sha256Hex(s.signature_path),
        }))
        .sort((a, b) => a.signer_role.localeCompare(b.signer_role)),
    }),
  );
}
