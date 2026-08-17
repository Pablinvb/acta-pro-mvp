import { beforeEach, describe, expect, it } from "vitest";

import { DemoRepository, resetDemoState } from "@/lib/data/demo-repository";
import { deriveCommitments } from "@/lib/data/commitments";
import { emptyMinutes, type Minutes } from "@/lib/schemas/minutes";
import { startOfWeek, weekRange } from "@/lib/utils";
import { DEMO_INSTITUTION_ID, DEMO_MEETING_ID } from "@/lib/demo/seed-data";
import type { MinutesRecord } from "@/lib/types";

const repository = new DemoRepository();

function minutesContent(overrides: Partial<Minutes> = {}): Minutes {
  return {
    ...emptyMinutes(),
    summary: "Resumen",
    agreements: [
      {
        description: "Entregar las tareas pendientes",
        responsible: "Juan Pérez López",
        due_date: "2026-08-21",
        source_segment_ids: ["seg-1"],
      },
      {
        description: "Revisar la plataforma cada noche",
        responsible: "María López",
        due_date: null,
        source_segment_ids: ["seg-2"],
      },
    ],
    commitments: [
      {
        description: "Confirmar el horario de la tutoría",
        responsible: "Ana Pérez",
        due_date: null,
        source_segment_ids: ["seg-3"],
      },
    ],
    ...overrides,
  };
}

function record(content: Minutes, edited: Minutes | null = null): MinutesRecord {
  return {
    id: "m-1",
    meeting_id: DEMO_MEETING_ID,
    version: 1,
    status: "approved",
    content,
    edited_content: edited,
    accepted_language_flags: [],
    generated_at: "2026-08-18T15:00:00.000Z",
    approved_at: "2026-08-18T15:30:00.000Z",
    generator: "demo",
    model: null,
  };
}

beforeEach(() => {
  resetDemoState();
});

describe("deriveCommitments", () => {
  it("toma acuerdos y compromisos y conserva responsable y fecha", () => {
    const derived = deriveCommitments(record(minutesContent()));

    expect(derived).toHaveLength(3);
    expect(derived.filter((item) => item.kind === "agreement")).toHaveLength(2);
    expect(derived[0]).toMatchObject({ due_date: "2026-08-21", responsible: "Juan Pérez López" });
    // Una fecha ausente sigue ausente: no se inventa.
    expect(derived[1].due_date).toBeNull();
  });

  it("prefiere la versión editada por la persona docente sobre el borrador de la IA", () => {
    const edited = minutesContent({
      agreements: [
        {
          description: "Texto corregido por la docente",
          responsible: "María López",
          due_date: "2026-09-01",
          source_segment_ids: ["seg-1"],
        },
      ],
      commitments: [],
    });

    const derived = deriveCommitments(record(minutesContent(), edited));
    expect(derived).toHaveLength(1);
    expect(derived[0].description).toBe("Texto corregido por la docente");
  });

  it("descarta entradas sin texto", () => {
    const derived = deriveCommitments(
      record(
        minutesContent({
          agreements: [{ description: "   ", responsible: null, due_date: null, source_segment_ids: [] }],
          commitments: [],
        }),
      ),
    );
    expect(derived).toHaveLength(0);
  });
});

describe("seguimiento en el repositorio de demostración", () => {
  async function seedApprovedMinutes(content = minutesContent()) {
    const created = await repository.createMinutes({
      meeting_id: DEMO_MEETING_ID,
      content,
      generator: "demo",
      model: null,
    });
    await repository.updateMinutes(created.id, { status: "approved", approved_at: new Date().toISOString() });
    return created.id;
  }

  it("crea una entrada de seguimiento por acuerdo y compromiso", async () => {
    const minutesId = await seedApprovedMinutes();
    const tracked = await repository.syncCommitmentsFromMinutes(minutesId);

    expect(tracked).toHaveLength(3);
    expect(tracked.every((item) => item.status === "pending")).toBe(true);
    expect(tracked.every((item) => item.institution_id === DEMO_INSTITUTION_ID)).toBe(true);
  });

  it("es idempotente: resincronizar no duplica", async () => {
    const minutesId = await seedApprovedMinutes();
    await repository.syncCommitmentsFromMinutes(minutesId);
    await repository.syncCommitmentsFromMinutes(minutesId);

    expect(await repository.listCommitments(DEMO_INSTITUTION_ID)).toHaveLength(3);
  });

  it("conserva el avance ya registrado al resincronizar", async () => {
    const minutesId = await seedApprovedMinutes();
    const [first] = await repository.syncCommitmentsFromMinutes(minutesId);
    await repository.setCommitmentStatus(first.id, "completed");

    const resynced = await repository.syncCommitmentsFromMinutes(minutesId);
    const same = resynced.find((item) => item.kind === first.kind && item.item_index === first.item_index);

    expect(same?.status).toBe("completed");
    expect(same?.completed_at).not.toBeNull();
  });

  it("registra y limpia la fecha de cumplimiento según el estado", async () => {
    const minutesId = await seedApprovedMinutes();
    const [item] = await repository.syncCommitmentsFromMinutes(minutesId);

    const completed = await repository.setCommitmentStatus(item.id, "completed");
    expect(completed.completed_at).not.toBeNull();

    const reopened = await repository.setCommitmentStatus(item.id, "in_progress");
    expect(reopened.completed_at).toBeNull();
  });

  it("ordena primero lo que tiene fecha", async () => {
    const minutesId = await seedApprovedMinutes();
    await repository.syncCommitmentsFromMinutes(minutesId);

    const listed = await repository.listCommitments(DEMO_INSTITUTION_ID);
    expect(listed[0].commitment.due_date).toBe("2026-08-21");
    expect(listed.at(-1)?.commitment.due_date).toBeNull();
  });

  it("no expone compromisos de otra institución", async () => {
    const minutesId = await seedApprovedMinutes();
    await repository.syncCommitmentsFromMinutes(minutesId);

    expect(await repository.listCommitments("00000000-0000-4000-8000-000000000000")).toHaveLength(0);
  });
});

describe("agrupación semanal del tablero", () => {
  it("lleva cualquier día a su lunes en UTC", () => {
    // 2026-08-21 es viernes; 2026-08-23, domingo.
    expect(startOfWeek("2026-08-21")).toBe("2026-08-17");
    expect(startOfWeek("2026-08-23")).toBe("2026-08-17");
    expect(startOfWeek("2026-08-17")).toBe("2026-08-17");
  });

  it("genera semanas consecutivas", () => {
    expect(weekRange(new Date("2026-08-19T00:00:00Z"), 4)).toEqual([
      "2026-08-17",
      "2026-08-24",
      "2026-08-31",
      "2026-09-07",
    ]);
  });
});
