import { describe, expect, it } from "vitest";

import {
  MinutesSchema,
  emptyMinutes,
  findOrphanSourceIds,
  normalizeMinutes,
  type Minutes,
} from "@/lib/schemas/minutes";

function baseMinutes(overrides: Partial<Minutes> = {}): Minutes {
  return { ...emptyMinutes(), summary: "Resumen de prueba", ...overrides };
}

describe("MinutesSchema", () => {
  it("acepta un acta mínima válida", () => {
    expect(MinutesSchema.safeParse(baseMinutes()).success).toBe(true);
  });

  it("rechaza un acuerdo sin source_segment_ids", () => {
    const invalid = {
      ...baseMinutes(),
      agreements: [{ description: "Entregar tareas", responsible: null, due_date: null }],
    };
    expect(MinutesSchema.safeParse(invalid).success).toBe(false);
  });

  it("rechaza un resumen ausente", () => {
    const { summary: _omitted, ...rest } = baseMinutes();
    void _omitted;
    expect(MinutesSchema.safeParse(rest).success).toBe(false);
  });
});

describe("normalizeMinutes", () => {
  it("descarta fechas con formato inválido y deja constancia", () => {
    const { minutes, warnings } = normalizeMinutes(
      baseMinutes({
        agreements: [
          {
            description: "Entregar tareas",
            responsible: "María López",
            due_date: "21 de agosto",
            source_segment_ids: ["seg-1"],
          },
        ],
      }),
    );

    expect(minutes.agreements[0].due_date).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(minutes.review_warnings.join(" ")).toContain("formato inválido");
  });

  it("conserva fechas ISO válidas", () => {
    const { minutes } = normalizeMinutes(
      baseMinutes({
        commitments: [
          {
            description: "Confirmar horario",
            responsible: null,
            due_date: "2026-08-21",
            source_segment_ids: ["seg-1"],
          },
        ],
      }),
    );
    expect(minutes.commitments[0].due_date).toBe("2026-08-21");
  });

  it("convierte marcadores de ausencia en null en vez de inventarlos", () => {
    const { minutes } = normalizeMinutes(
      baseMinutes({
        meeting_reason: "No consta",
        agreements: [
          {
            description: "Tutoría de refuerzo",
            responsible: "  N/A ",
            due_date: null,
            source_segment_ids: ["seg-1"],
          },
        ],
      }),
    );

    expect(minutes.meeting_reason).toBeNull();
    expect(minutes.agreements[0].responsible).toBeNull();
  });
});

describe("findOrphanSourceIds", () => {
  it("detecta referencias a segmentos inexistentes", () => {
    const minutes = baseMinutes({
      topics: [{ title: "Tema", description: "Descripción", source_segment_ids: ["seg-1", "seg-99"] }],
      facts: [{ statement: "Hecho", attributed_to: "Docente", source_segment_ids: ["seg-2"] }],
    });

    expect(findOrphanSourceIds(minutes, new Set(["seg-1", "seg-2"]))).toEqual(["seg-99"]);
  });

  it("no reporta nada cuando todas las referencias existen", () => {
    const minutes = baseMinutes({
      agreements: [
        { description: "Acuerdo", responsible: null, due_date: null, source_segment_ids: ["seg-1"] },
      ],
    });
    expect(findOrphanSourceIds(minutes, new Set(["seg-1"]))).toEqual([]);
  });
});
