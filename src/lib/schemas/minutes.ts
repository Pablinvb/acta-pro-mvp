import { z } from "zod";

/**
 * Esquema del borrador de acta.
 *
 * Se usa en dos momentos:
 * 1. Como JSON Schema para Structured Outputs de Anthropic.
 * 2. Como validación local del resultado devuelto por el modelo.
 *
 * No contiene datos personales en nombres de campos, enums ni descripciones:
 * el contenido sensible viaja únicamente en `messages`.
 */

const segmentIds = z
  .array(z.string())
  .describe("Identificadores de los segmentos de transcripción que respaldan esta entrada.");

export const TopicSchema = z.object({
  title: z.string(),
  description: z.string(),
  source_segment_ids: segmentIds,
});

export const FactSchema = z.object({
  statement: z.string(),
  attributed_to: z.string(),
  source_segment_ids: segmentIds,
});

export const AgreementSchema = z.object({
  description: z.string(),
  responsible: z.string().nullable(),
  due_date: z.string().nullable().describe("Fecha en formato YYYY-MM-DD, o null si no consta."),
  source_segment_ids: segmentIds,
});

export const CommitmentSchema = AgreementSchema;

export const FollowUpSchema = z.object({
  action: z.string(),
  date: z.string().nullable().describe("Fecha en formato YYYY-MM-DD, o null si no consta."),
  source_segment_ids: segmentIds,
});

export const LanguageFlagSchema = z.object({
  original_fragment: z.string(),
  reason: z.string(),
  objective_suggestion: z.string(),
  source_segment_ids: segmentIds,
});

export const MinutesSchema = z.object({
  summary: z.string(),
  meeting_reason: z.string().nullable(),
  topics: z.array(TopicSchema),
  facts: z.array(FactSchema),
  agreements: z.array(AgreementSchema),
  commitments: z.array(CommitmentSchema),
  follow_up: z.array(FollowUpSchema),
  pending_items: z.array(z.string()),
  contradictions: z.array(z.string()),
  language_flags: z.array(LanguageFlagSchema),
  review_warnings: z.array(z.string()),
});

export type Minutes = z.infer<typeof MinutesSchema>;
export type Topic = z.infer<typeof TopicSchema>;
export type Fact = z.infer<typeof FactSchema>;
export type Agreement = z.infer<typeof AgreementSchema>;
export type Commitment = z.infer<typeof CommitmentSchema>;
export type FollowUp = z.infer<typeof FollowUpSchema>;
export type LanguageFlag = z.infer<typeof LanguageFlagSchema>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeDate(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!ISO_DATE.test(trimmed)) return null;
  const parsed = new Date(`${trimmed}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : trimmed;
}

function normalizeOptionalText(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  // El modelo a veces devuelve literales en vez de null; se tratan como ausencia.
  if (["null", "n/a", "na", "no consta", "no aplica"].includes(trimmed.toLowerCase())) return null;
  return trimmed;
}

/**
 * Endurece la salida del modelo: descarta fechas mal formadas y convierte
 * marcadores de ausencia en `null`. Nunca inventa ni completa información.
 * Devuelve además las advertencias generadas por la normalización.
 */
export function normalizeMinutes(minutes: Minutes): { minutes: Minutes; warnings: string[] } {
  const warnings: string[] = [];

  const fixDated = <T extends { due_date: string | null; responsible: string | null; description: string }>(
    items: T[],
    kind: string,
  ): T[] =>
    items.map((item) => {
      const due = normalizeDate(item.due_date);
      if (item.due_date && !due) {
        warnings.push(`Se descartó una fecha con formato inválido en ${kind}: "${item.description}".`);
      }
      return { ...item, due_date: due, responsible: normalizeOptionalText(item.responsible) };
    });

  const normalized: Minutes = {
    ...minutes,
    meeting_reason: normalizeOptionalText(minutes.meeting_reason),
    agreements: fixDated(minutes.agreements, "acuerdos"),
    commitments: fixDated(minutes.commitments, "compromisos"),
    follow_up: minutes.follow_up.map((item) => {
      const date = normalizeDate(item.date);
      if (item.date && !date) {
        warnings.push(`Se descartó una fecha con formato inválido en seguimiento: "${item.action}".`);
      }
      return { ...item, date };
    }),
  };

  return { minutes: { ...normalized, review_warnings: [...normalized.review_warnings, ...warnings] }, warnings };
}

/**
 * Comprueba que cada `source_segment_ids` apunte a segmentos que existen.
 * Un identificador inexistente es señal de invención y debe revisarse.
 */
export function findOrphanSourceIds(minutes: Minutes, validIds: Set<string>): string[] {
  const orphans = new Set<string>();
  const check = (ids: string[]) => ids.forEach((id) => (validIds.has(id) ? null : orphans.add(id)));

  minutes.topics.forEach((t) => check(t.source_segment_ids));
  minutes.facts.forEach((f) => check(f.source_segment_ids));
  minutes.agreements.forEach((a) => check(a.source_segment_ids));
  minutes.commitments.forEach((c) => check(c.source_segment_ids));
  minutes.follow_up.forEach((f) => check(f.source_segment_ids));
  minutes.language_flags.forEach((l) => check(l.source_segment_ids));

  return [...orphans];
}

export function emptyMinutes(): Minutes {
  return {
    summary: "",
    meeting_reason: null,
    topics: [],
    facts: [],
    agreements: [],
    commitments: [],
    follow_up: [],
    pending_items: [],
    contradictions: [],
    language_flags: [],
    review_warnings: [],
  };
}
