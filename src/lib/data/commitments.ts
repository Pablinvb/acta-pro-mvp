import type { MinutesRecord } from "@/lib/types";

export interface DerivedCommitment {
  kind: "agreement" | "commitment";
  item_index: number;
  description: string;
  responsible: string | null;
  due_date: string | null;
}

/**
 * Extrae los acuerdos y compromisos de la versión aprobada de un acta.
 *
 * Se usa la capa editada por la persona docente cuando existe: el tablero de
 * seguimiento debe reflejar lo que se aprobó, no lo que propuso la IA. Las
 * entradas sin texto se descartan, y una fecha ausente se mantiene ausente.
 */
export function deriveCommitments(record: MinutesRecord): DerivedCommitment[] {
  const content = record.edited_content ?? record.content;

  const fromList = (
    items: { description: string; responsible: string | null; due_date: string | null }[],
    kind: DerivedCommitment["kind"],
  ): DerivedCommitment[] =>
    items
      .map((item, index) => ({
        kind,
        item_index: index,
        description: item.description.trim(),
        responsible: item.responsible,
        due_date: item.due_date,
      }))
      .filter((item) => item.description.length > 0);

  return [...fromList(content.agreements, "agreement"), ...fromList(content.commitments, "commitment")];
}

/** Clave estable de una entrada dentro de un acta, para no duplicar al resincronizar. */
export function commitmentKey(minutesId: string, kind: string, index: number) {
  return `${minutesId}:${kind}:${index}`;
}
