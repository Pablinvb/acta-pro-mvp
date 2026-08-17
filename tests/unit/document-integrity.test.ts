import { describe, expect, it } from "vitest";

import { buildDocumentCode, buildStoragePath, canonicalize, contentFingerprint, sha256Hex } from "@/lib/pdf/render";
import { emptyMinutes } from "@/lib/schemas/minutes";
import type { MeetingDetail } from "@/lib/types";
import { demoInstitution, demoMeetings, demoStudents, demoTeacher } from "@/lib/demo/seed-data";

const detail: MeetingDetail = {
  meeting: demoMeetings[0],
  student: demoStudents[0],
  teacher: demoTeacher,
  institution: demoInstitution,
  representatives: [],
  participants: [],
};

describe("canonicalize", () => {
  it("produce la misma cadena independientemente del orden de las claves", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
  });

  it("conserva el orden de los arreglos", () => {
    expect(canonicalize([1, 2])).not.toBe(canonicalize([2, 1]));
  });

  it("omite valores undefined", () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});

describe("contentFingerprint", () => {
  const input = {
    documentCode: "ACTA-2026-ABCD1234-v1",
    version: 1,
    meetingId: "meeting-1",
    content: { ...emptyMinutes(), summary: "Resumen" },
    signerNames: ["Ana Pérez", "María López"],
  };

  it("es determinístico", () => {
    expect(contentFingerprint(input)).toBe(contentFingerprint(input));
  });

  it("cambia si cambia el contenido del acta", () => {
    const modified = { ...input, content: { ...input.content, summary: "Otro resumen" } };
    expect(contentFingerprint(modified)).not.toBe(contentFingerprint(input));
  });

  it("cambia si cambian las firmas", () => {
    expect(contentFingerprint({ ...input, signerNames: ["Ana Pérez"] })).not.toBe(contentFingerprint(input));
  });
});

describe("sha256Hex", () => {
  it("coincide con el vector conocido de la cadena vacía", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});

describe("código y ruta del documento", () => {
  it("incluye año, referencia de la reunión y versión", () => {
    expect(buildDocumentCode(detail, 2)).toMatch(/^ACTA-2026-[0-9A-F]{8}-v2$/);
  });

  it("organiza el almacenamiento por institución y estudiante", () => {
    const path = buildStoragePath(demoInstitution.id, demoStudents[0].id, "ACTA-2026-AAAAAAAA-v1");
    expect(path).toBe(`${demoInstitution.id}/${demoStudents[0].id}/ACTA-2026-AAAAAAAA-v1.pdf`);
  });
});
