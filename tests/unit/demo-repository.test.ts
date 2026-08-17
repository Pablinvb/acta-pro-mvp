import { beforeEach, describe, expect, it } from "vitest";

import { DemoRepository, resetDemoState } from "@/lib/data/demo-repository";
import { generateDemoMinutes, isDemoTranscript } from "@/lib/demo/demo-minutes";
import {
  DEMO_MEETING_ID,
  DEMO_REPRESENTATIVE_ID,
  DEMO_STUDENT_ID,
  DEMO_TEACHER_ID,
  DEMO_TRANSCRIPT,
  DEMO_INSTITUTION_ID,
} from "@/lib/demo/seed-data";
import { CONSENT_TEXT_VERSION } from "@/lib/consent";

const repository = new DemoRepository();

beforeEach(() => {
  resetDemoState();
});

async function confirmParticipants() {
  return repository.replaceParticipants(DEMO_MEETING_ID, [
    { participant_type: "teacher", participant_ref_id: DEMO_TEACHER_ID, display_name: "Ana Pérez" },
    { participant_type: "representative", participant_ref_id: DEMO_REPRESENTATIVE_ID, display_name: "María López" },
    { participant_type: "student", participant_ref_id: DEMO_STUDENT_ID, display_name: "Juan Pérez López" },
  ]);
}

describe("DemoRepository", () => {
  it("parte del escenario semilla", async () => {
    const meetings = await repository.listMeetings(DEMO_TEACHER_ID);
    expect(meetings).toHaveLength(3);
    expect(await repository.listDocuments(DEMO_INSTITUTION_ID)).toHaveLength(0);
  });

  it("conserva el consentimiento al reconfirmar participantes", async () => {
    const participants = await confirmParticipants();
    await repository.setConsent(
      DEMO_MEETING_ID,
      participants.map((participant) => ({ participant_id: participant.id, consent_status: "granted" as const })),
      CONSENT_TEXT_VERSION,
    );

    const again = await confirmParticipants();
    expect(again.every((participant) => participant.consent_status === "granted")).toBe(true);
    expect(again[0].consent_text_version).toBe(CONSENT_TEXT_VERSION);
  });

  it("asigna identificadores estables y ordenados a los segmentos", async () => {
    const segments = await repository.replaceSegments(
      DEMO_MEETING_ID,
      DEMO_TRANSCRIPT.map((segment) => ({
        speaker_label: segment.speaker_label,
        start_seconds: segment.start_seconds,
        end_seconds: segment.end_seconds,
        text: segment.text,
        confidence: segment.confidence,
        is_final: true,
      })),
    );

    expect(segments[0].id).toBe(`${DEMO_MEETING_ID}-seg-01`);
    expect(segments).toHaveLength(DEMO_TRANSCRIPT.length);
    const stored = await repository.listSegments(DEMO_MEETING_ID);
    expect(stored.map((segment) => segment.start_seconds)).toEqual(
      [...stored.map((segment) => segment.start_seconds)].sort((a, b) => a - b),
    );
  });

  it("reemplaza la transcripción por completo en lugar de acumularla", async () => {
    const input = [
      { speaker_label: "speaker_0", start_seconds: 0, end_seconds: 1, text: "Hola", confidence: 0.9, is_final: true },
    ];
    await repository.replaceSegments(DEMO_MEETING_ID, input);
    await repository.replaceSegments(DEMO_MEETING_ID, input);
    expect(await repository.listSegments(DEMO_MEETING_ID)).toHaveLength(1);
  });

  it("incrementa la versión de cada acta generada", async () => {
    const first = await repository.createMinutes({
      meeting_id: DEMO_MEETING_ID,
      content: generateDemoMinutes([]),
      generator: "demo",
      model: null,
    });
    const second = await repository.createMinutes({
      meeting_id: DEMO_MEETING_ID,
      content: generateDemoMinutes([]),
      generator: "demo",
      model: null,
    });

    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
    expect((await repository.getLatestMinutes(DEMO_MEETING_ID))?.id).toBe(second.id);
  });

  it("reemplaza la firma anterior del mismo rol", async () => {
    const minutes = await repository.createMinutes({
      meeting_id: DEMO_MEETING_ID,
      content: generateDemoMinutes([]),
      generator: "demo",
      model: null,
    });

    await repository.addSignature({
      minutes_id: minutes.id,
      signer_name: "Ana Pérez",
      signer_role: "teacher",
      signature_path: "data:image/png;base64,AAA",
      acceptance_text_version: "v1",
    });
    await repository.addSignature({
      minutes_id: minutes.id,
      signer_name: "Ana Pérez",
      signer_role: "teacher",
      signature_path: "data:image/png;base64,BBB",
      acceptance_text_version: "v1",
    });

    const signatures = await repository.listSignatures(minutes.id);
    expect(signatures).toHaveLength(1);
    expect(signatures[0].signature_path).toContain("BBB");
  });

  it("guarda y recupera el archivo del documento", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    await repository.putDocumentFile("ruta/archivo.pdf", bytes);
    expect(await repository.getDocumentFile("ruta/archivo.pdf")).toEqual(bytes);
    expect(await repository.getDocumentFile("ruta/inexistente.pdf")).toBeNull();
  });

  it("aísla el mapeo de hablantes por reunión", async () => {
    const participants = await confirmParticipants();
    const mapped = await repository.setSpeakerMapping(DEMO_MEETING_ID, {
      speaker_0: participants[0].id,
      speaker_1: participants[1].id,
    });

    expect(mapped.find((p) => p.id === participants[0].id)?.speaker_label).toBe("speaker_0");
    expect(mapped.find((p) => p.id === participants[2].id)?.speaker_label).toBeNull();
  });
});

describe("generador de actas de demostración", () => {
  it("reconoce la transcripción de demostración", async () => {
    const segments = await repository.replaceSegments(
      DEMO_MEETING_ID,
      DEMO_TRANSCRIPT.map((segment) => ({
        speaker_label: segment.speaker_label,
        start_seconds: segment.start_seconds,
        end_seconds: segment.end_seconds,
        text: segment.text,
        confidence: segment.confidence,
        is_final: true,
      })),
    );

    expect(isDemoTranscript(segments)).toBe(true);

    const minutes = generateDemoMinutes(segments, {
      speaker_0: "Ana Pérez",
      speaker_1: "María López",
      speaker_2: "Juan Pérez López",
    });

    expect(minutes.agreements.some((agreement) => agreement.due_date === "2026-08-21")).toBe(true);
    expect(minutes.agreements.some((agreement) => agreement.due_date === null)).toBe(true);
    expect(minutes.language_flags).toHaveLength(1);
    expect(minutes.pending_items.join(" ")).toContain("no consta");
    expect(
      minutes.agreements.every((agreement) => agreement.source_segment_ids.length > 0),
    ).toBe(true);
  });

  it("no inventa contenido con una transcripción distinta", () => {
    const minutes = generateDemoMinutes([
      {
        id: "x-1",
        meeting_id: "x",
        speaker_label: "speaker_0",
        start_seconds: 0,
        end_seconds: 1,
        text: "Una conversación cualquiera",
        confidence: 0.9,
        is_final: true,
        created_at: new Date().toISOString(),
      },
    ]);

    expect(minutes.summary).toBe("");
    expect(minutes.agreements).toHaveLength(0);
    expect(minutes.review_warnings.join(" ")).toContain("no se generó un análisis");
  });
});
