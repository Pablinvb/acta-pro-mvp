import { beforeEach, describe, expect, it } from "vitest";

import { DemoRepository, resetDemoState } from "@/lib/data/demo-repository";
import { SigningError, type SignMinutesInput } from "@/lib/data/repository";
import { emptyMinutes } from "@/lib/schemas/minutes";
import { DEMO_MEETING_ID } from "@/lib/demo/seed-data";

/**
 * El repositorio demo es el espejo en memoria de `public.sign_minutes`.
 * Si se vuelve más permisivo que Postgres, el modo demostración deja de
 * representar al producto, así que aquí se comprueban las mismas reglas.
 */

const repository = new DemoRepository();

const TEACHER = {
  signer_name: "Ana Pérez",
  signer_role: "teacher" as const,
  signature_path: "data:image/png;base64,AAA",
};
const REPRESENTATIVE = {
  signer_name: "María López",
  signer_role: "representative" as const,
  signature_path: "data:image/png;base64,BBB",
};

async function approvedMinutes() {
  const record = await repository.createMinutes({
    meeting_id: DEMO_MEETING_ID,
    content: { ...emptyMinutes(), summary: "Resumen" },
    generator: "demo",
    model: null,
  });
  await repository.updateMinutes(record.id, {
    status: "approved",
    approved_at: new Date().toISOString(),
  });
  await repository.updateMeeting(DEMO_MEETING_ID, { status: "approved" });
  return record;
}

const sign = (minutesId: string, signatures: SignMinutesInput["signatures"]) =>
  repository.signMinutes({
    minutes_id: minutesId,
    acceptance_text_version: "v1",
    signatures,
  });

beforeEach(() => {
  resetDemoState();
});

describe("signMinutes", () => {
  it("firma y finaliza la reunión en una sola operación", async () => {
    const record = await approvedMinutes();

    const result = await sign(record.id, [TEACHER, REPRESENTATIVE]);

    expect(result).toMatchObject({ already_signed: false, signatures: 2 });
    expect((await repository.getMeeting(DEMO_MEETING_ID))?.status).toBe("signed");
    expect(await repository.listSignatures(record.id)).toHaveLength(2);
  });

  it("deja constancia en auditoría sin guardar la imagen de la firma", async () => {
    const record = await approvedMinutes();
    await sign(record.id, [TEACHER, REPRESENTATIVE]);

    const entry = (await repository.listAudit(DEMO_MEETING_ID)).find(
      (item) => item.action === "minutes.signed",
    );

    expect(entry).toBeDefined();
    expect(JSON.stringify(entry?.metadata_json)).not.toContain("base64");
  });

  it("exige las dos firmas obligatorias", async () => {
    const record = await approvedMinutes();

    await expect(sign(record.id, [TEACHER])).rejects.toThrow(SigningError);
    // Un rechazo no puede dejar firmas sueltas ni mover el estado.
    expect(await repository.listSignatures(record.id)).toHaveLength(0);
    expect((await repository.getMeeting(DEMO_MEETING_ID))?.status).toBe("approved");
  });

  it("no firma un acta que no está aprobada", async () => {
    const record = await repository.createMinutes({
      meeting_id: DEMO_MEETING_ID,
      content: { ...emptyMinutes(), summary: "Borrador" },
      generator: "demo",
      model: null,
    });
    await repository.updateMeeting(DEMO_MEETING_ID, { status: "approved" });

    await expect(sign(record.id, [TEACHER, REPRESENTATIVE])).rejects.toThrow(/aprobarse/);
  });

  it("no firma una versión que ya no es la vigente", async () => {
    const old = await approvedMinutes();
    await repository.createMinutes({
      meeting_id: DEMO_MEETING_ID,
      content: { ...emptyMinutes(), summary: "Versión nueva" },
      generator: "demo",
      model: null,
    });

    await expect(sign(old.id, [TEACHER, REPRESENTATIVE])).rejects.toThrow(/más reciente/);
  });

  it("repetir la misma firma es idempotente", async () => {
    const record = await approvedMinutes();
    await sign(record.id, [TEACHER, REPRESENTATIVE]);

    const again = await sign(record.id, [TEACHER, REPRESENTATIVE]);

    expect(again.already_signed).toBe(true);
    expect(await repository.listSignatures(record.id)).toHaveLength(2);
  });

  it("repetir con contenido distinto se rechaza en vez de fingir éxito", async () => {
    const record = await approvedMinutes();
    await sign(record.id, [TEACHER, REPRESENTATIVE]);

    const otra = { ...REPRESENTATIVE, signature_path: "data:image/png;base64,ZZZ" };

    await expect(sign(record.id, [TEACHER, otra])).rejects.toThrow(/contenido distinto/);
    // La firma almacenada no se toca.
    const stored = await repository.listSignatures(record.id);
    expect(stored.find((s) => s.signer_role === "representative")?.signature_path).toBe(
      REPRESENTATIVE.signature_path,
    );
  });

  it("el orden de las firmas no afecta a la idempotencia", async () => {
    const record = await approvedMinutes();
    await sign(record.id, [TEACHER, REPRESENTATIVE]);

    const again = await sign(record.id, [REPRESENTATIVE, TEACHER]);

    expect(again.already_signed).toBe(true);
  });
});
