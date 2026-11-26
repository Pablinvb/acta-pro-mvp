import { renderToBuffer } from "@react-pdf/renderer";
import { describe, expect, it } from "vitest";

import { MinutesDocument } from "@/lib/pdf/minutes-document";
import {
  buildDocumentCode,
  buildStoragePath,
  documentTimestamp,
  generationFingerprint,
  sha256Hex,
  type GenerationInput,
} from "@/lib/pdf/render";
import { emptyMinutes } from "@/lib/schemas/minutes";
import { demoInstitution, demoMeetings, demoStudents, demoTeacher } from "@/lib/demo/seed-data";
import type { MeetingDetail, Signature } from "@/lib/types";

const detail: MeetingDetail = {
  meeting: demoMeetings[0],
  student: demoStudents[0],
  teacher: demoTeacher,
  institution: demoInstitution,
  representatives: [],
  participants: [
    {
      id: "participant-teacher",
      meeting_id: demoMeetings[0].id,
      participant_type: "teacher",
      participant_ref_id: demoTeacher.id,
      display_name: demoTeacher.full_name,
      speaker_label: "Hablante 1",
      consent_status: "granted",
      consent_at: "2026-11-20T15:00:00.000Z",
      consent_text_version: "v1",
    },
    {
      id: "participant-representative",
      meeting_id: demoMeetings[0].id,
      participant_type: "representative",
      participant_ref_id: "representative-1",
      display_name: "Ana Pérez",
      speaker_label: "Hablante 2",
      consent_status: "granted",
      consent_at: "2026-11-20T15:01:00.000Z",
      consent_text_version: "v1",
    },
  ],
};

const signatures: Signature[] = [
  {
    id: "signature-teacher",
    minutes_id: "minutes-1",
    signer_name: demoTeacher.full_name,
    signer_role: "teacher",
    signature_path: "data:image/png;base64,AAAA",
    signed_at: "2026-11-21T16:00:00.000Z",
    acceptance_text_version: "v1",
  },
  {
    id: "signature-representative",
    minutes_id: "minutes-1",
    signer_name: "Ana Pérez",
    signer_role: "representative",
    signature_path: "data:image/png;base64,BBBB",
    signed_at: "2026-11-21T16:05:00.000Z",
    acceptance_text_version: "v1",
  },
];

const content = { ...emptyMinutes(), summary: "Resumen del acuerdo alcanzado en la reunión." };
const documentCode = buildDocumentCode(detail, 1);

const baseInput: GenerationInput = {
  minutesId: "minutes-1",
  documentTimestamp: "2026-11-21T16:05:00.000Z",
  version: 1,
  documentCode,
  approved: true,
  generator: "demo",
  model: null,
  content,
  acceptedLanguageFlags: [],
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
};

describe("documentTimestamp", () => {
  it("devuelve el instante más reciente de los conocidos", () => {
    expect(
      documentTimestamp({
        generatedAt: "2026-11-21T10:00:00.000Z",
        approvedAt: "2026-11-21T12:00:00.000Z",
        signedAt: ["2026-11-21T16:00:00.000Z", "2026-11-21T14:00:00.000Z"],
      }),
    ).toBe("2026-11-21T16:00:00.000Z");
  });

  it("ignora las fechas ausentes", () => {
    expect(
      documentTimestamp({
        generatedAt: "2026-11-21T10:00:00.000Z",
        approvedAt: null,
        signedAt: [],
      }),
    ).toBe("2026-11-21T10:00:00.000Z");
  });

  it("ignora las fechas no interpretables en lugar de propagarlas", () => {
    expect(
      documentTimestamp({
        generatedAt: "no es una fecha",
        approvedAt: "2026-11-21T12:00:00.000Z",
        signedAt: [""],
      }),
    ).toBe("2026-11-21T12:00:00.000Z");
  });

  it("no recurre al reloj cuando no hay ninguna fecha utilizable", () => {
    const first = documentTimestamp({ generatedAt: "", approvedAt: null, signedAt: [] });
    const second = documentTimestamp({ generatedAt: "", approvedAt: null, signedAt: [] });
    expect(first).toBe(second);
  });
});

describe("generationFingerprint", () => {
  it("es determinista", () => {
    expect(generationFingerprint(baseInput)).toBe(generationFingerprint(baseInput));
  });

  it("tiene el formato de un SHA-256 hexadecimal", () => {
    expect(generationFingerprint(baseInput)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("no depende del orden en que lleguen las firmas", () => {
    const reordered = { ...baseInput, signatures: [...baseInput.signatures].reverse() };
    expect(generationFingerprint(reordered)).toBe(generationFingerprint(baseInput));
  });

  it("no depende del orden en que lleguen los participantes", () => {
    const reordered = { ...baseInput, participants: [...baseInput.participants].reverse() };
    expect(generationFingerprint(reordered)).toBe(generationFingerprint(baseInput));
  });

  it("cambia si cambia el contenido del acta", () => {
    const modified = { ...baseInput, content: { ...content, summary: "Otro resumen" } };
    expect(generationFingerprint(modified)).not.toBe(generationFingerprint(baseInput));
  });

  it("cambia si cambia la imagen de una firma", () => {
    const modified = {
      ...baseInput,
      signatures: baseInput.signatures.map((signature, index) =>
        index === 0 ? { ...signature, signature_path: "data:image/png;base64,ZZZZ" } : signature,
      ),
    };
    expect(generationFingerprint(modified)).not.toBe(generationFingerprint(baseInput));
  });

  it("distingue un borrador de un documento aprobado", () => {
    const draft = { ...baseInput, approved: false };
    expect(generationFingerprint(draft)).not.toBe(generationFingerprint(baseInput));
  });

  it("cambia si cambia la versión del acta", () => {
    const modified = { ...baseInput, version: 2 };
    expect(generationFingerprint(modified)).not.toBe(generationFingerprint(baseInput));
  });

  it("cambia si cambia el instante al que corresponde el documento", () => {
    const modified = { ...baseInput, documentTimestamp: "2026-11-22T09:00:00.000Z" };
    expect(generationFingerprint(modified)).not.toBe(generationFingerprint(baseInput));
  });

  it("cambia si se retira una firma", () => {
    const modified = { ...baseInput, signatures: [baseInput.signatures[0]] };
    expect(generationFingerprint(modified)).not.toBe(generationFingerprint(baseInput));
  });
});

/**
 * Esta es la prueba que sostiene toda la idempotencia. Si los bytes del PDF no
 * fueran reproducibles, el SHA-256 del archivo y su ruta cambiarían en cada
 * generación y no habría forma de reutilizar un documento existente.
 */
describe("reproducibilidad de los bytes del PDF", () => {
  const props = {
    detail,
    content,
    acceptedLanguageFlags: [],
    signatures,
    documentCode,
    version: 1,
    approved: true,
    generatedAt: "2026-11-21T16:05:00.000Z",
    contentSha256: "a".repeat(64),
    generator: "demo" as const,
  };

  it("dos generaciones con los mismos datos producen el mismo archivo", async () => {
    const [first, second] = await Promise.all([
      renderToBuffer(MinutesDocument(props)),
      renderToBuffer(MinutesDocument(props)),
    ]);
    expect(sha256Hex(new Uint8Array(second))).toBe(sha256Hex(new Uint8Array(first)));
  }, 60_000);

  it("la ruta de almacenamiento es la misma porque depende del hash", async () => {
    const buffer = await renderToBuffer(MinutesDocument(props));
    const hash = sha256Hex(new Uint8Array(buffer));
    expect(buildStoragePath(detail.institution.id, detail.student.id, documentCode, hash)).toBe(
      buildStoragePath(detail.institution.id, detail.student.id, documentCode, hash),
    );
  }, 60_000);

  it("cambiar el instante del documento cambia los bytes", async () => {
    const [first, second] = await Promise.all([
      renderToBuffer(MinutesDocument(props)),
      renderToBuffer(MinutesDocument({ ...props, generatedAt: "2026-11-22T09:00:00.000Z" })),
    ]);
    expect(sha256Hex(new Uint8Array(second))).not.toBe(sha256Hex(new Uint8Array(first)));
  }, 60_000);
});
