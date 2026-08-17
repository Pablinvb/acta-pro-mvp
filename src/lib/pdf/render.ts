import { createHash } from "node:crypto";

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

export function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

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

export function buildStoragePath(institutionId: string, studentId: string, documentCode: string): string {
  return `${institutionId}/${studentId}/${documentCode}.pdf`;
}
