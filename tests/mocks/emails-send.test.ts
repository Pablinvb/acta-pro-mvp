import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DemoRepository, resetDemoState } from "@/lib/data/demo-repository";
import { emptyMinutes } from "@/lib/schemas/minutes";
import {
  DEMO_INSTITUTION_ID,
  DEMO_MEETING_ID,
  DEMO_REPRESENTATIVE_ID,
  DEMO_TEACHER_ID,
  demoInstitution,
  demoTeacher,
} from "@/lib/demo/seed-data";

const send = vi.fn();
vi.mock("resend", () => ({
  Resend: class {
    readonly emails = { send };
  },
}));

const repository = new DemoRepository();

vi.mock("@/lib/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/session")>();
  return {
    ...actual,
    requireApiSession: vi.fn(async () => ({
      profile: demoTeacher,
      institution: demoInstitution,
      mode: "demo" as const,
      repository,
    })),
    requireMeetingAccess: vi.fn(async (_session: unknown, meetingId: string) => {
      const meeting = await repository.getMeeting(meetingId);
      if (!meeting) throw new actual.UnauthorizedError();
      return meeting;
    }),
  };
});

const { POST } = await import("@/app/api/emails/send/route");
const { resetEnvCache } = await import("@/lib/env");
const { resetRateLimits } = await import("@/lib/api/http");

async function seedSignedDocument() {
  resetDemoState();
  await repository.replaceParticipants(DEMO_MEETING_ID, [
    { participant_type: "teacher", participant_ref_id: DEMO_TEACHER_ID, display_name: "Ana Pérez" },
    { participant_type: "representative", participant_ref_id: DEMO_REPRESENTATIVE_ID, display_name: "María López" },
  ]);
  await repository.updateMeeting(DEMO_MEETING_ID, { status: "signed" });

  const minutes = await repository.createMinutes({
    meeting_id: DEMO_MEETING_ID,
    content: { ...emptyMinutes(), summary: "Resumen" },
    generator: "demo",
    model: null,
  });
  await repository.updateMinutes(minutes.id, { status: "approved", approved_at: new Date().toISOString() });
  await repository.putDocumentFile("ruta/acta.pdf", new Uint8Array([37, 80, 68, 70]));

  return repository.createDocument({
    minutes_id: minutes.id,
    meeting_id: DEMO_MEETING_ID,
    storage_path: "ruta/acta.pdf",
    sha256: "a".repeat(64),
    document_code: "ACTA-2026-TEST0001-v1",
    version: 1,
    generation_fingerprint: "b".repeat(64),
    kind: "final",
  });
}

function request(body: unknown) {
  return new Request("http://localhost:3000/api/emails/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  send.mockReset();
  resetRateLimits();
  process.env.DEMO_MODE = "true";
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
  resetEnvCache();
});

afterEach(() => {
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
  resetEnvCache();
});

describe("POST /api/emails/send", () => {
  it("devuelve una simulación rotulada cuando no hay proveedor configurado", async () => {
    const document = await seedSignedDocument();

    const response = await POST(
      request({ documentId: document.id, recipientEmail: "maria.lopez@demo.actapro.ec" }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.simulated).toBe(true);
    expect(payload.preview.to).toBe("maria.lopez@demo.actapro.ec");
    expect(send).not.toHaveBeenCalled();

    // Una simulación no debe marcar el acta como enviada.
    const stored = await repository.getDocument(document.id);
    expect(stored?.sent_at).toBeNull();
    expect((await repository.getMeeting(DEMO_MEETING_ID))?.status).toBe("signed");
  });

  it("envía el PDF adjunto y registra el envío cuando Resend está configurado", async () => {
    const document = await seedSignedDocument();
    process.env.RESEND_API_KEY = "re_test";
    process.env.EMAIL_FROM = "actas@demo.actapro.ec";
    resetEnvCache();
    send.mockResolvedValue({ data: { id: "msg_123" }, error: null });

    const response = await POST(
      request({ documentId: document.id, recipientEmail: "maria.lopez@demo.actapro.ec" }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.simulated).toBe(false);
    expect(payload.providerMessageId).toBe("msg_123");

    const call = send.mock.calls[0][0];
    expect(call.from).toBe("actas@demo.actapro.ec");
    expect(call.attachments[0].filename).toBe("ACTA-2026-TEST0001-v1.pdf");

    const stored = await repository.getDocument(document.id);
    expect(stored?.provider_message_id).toBe("msg_123");
    expect(stored?.sent_at).not.toBeNull();
    expect((await repository.getMeeting(DEMO_MEETING_ID))?.status).toBe("sent");

    const audit = await repository.listAudit(DEMO_MEETING_ID);
    const sent = audit.find((entry) => entry.action === "document.sent");
    expect(sent?.institution_id).toBe(DEMO_INSTITUTION_ID);
    // La auditoría guarda identificadores, nunca el cuerpo del correo.
    expect(JSON.stringify(sent?.metadata_json)).not.toContain("Estimada");
  });

  it("rechaza el envío si el acta todavía no está firmada", async () => {
    const document = await seedSignedDocument();
    await repository.updateMeeting(DEMO_MEETING_ID, { status: "approved" });

    const response = await POST(
      request({ documentId: document.id, recipientEmail: "maria.lopez@demo.actapro.ec" }),
    );

    expect(response.status).toBe(409);
  });

  it("rechaza un correo con formato inválido", async () => {
    const document = await seedSignedDocument();
    const response = await POST(request({ documentId: document.id, recipientEmail: "no-es-un-correo" }));
    expect(response.status).toBe(400);
  });

  it("propaga un fallo del proveedor sin exponer su mensaje", async () => {
    const document = await seedSignedDocument();
    process.env.RESEND_API_KEY = "re_test";
    process.env.EMAIL_FROM = "actas@demo.actapro.ec";
    resetEnvCache();
    send.mockResolvedValue({ data: null, error: { message: "domain not verified" } });

    const response = await POST(
      request({ documentId: document.id, recipientEmail: "maria.lopez@demo.actapro.ec" }),
    );
    const payload = await response.json();

    expect(response.status).toBe(502);
    expect(payload.error).not.toContain("domain not verified");
  });
});
