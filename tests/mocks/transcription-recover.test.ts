import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DemoRepository, resetDemoState } from "@/lib/data/demo-repository";
import {
  DEMO_MEETING_ID,
  DEMO_REPRESENTATIVE_ID,
  DEMO_TEACHER_ID,
  DEMO_TRANSCRIPT,
  demoInstitution,
  demoTeacher,
} from "@/lib/demo/seed-data";
import { CONSENT_TEXT_VERSION } from "@/lib/consent";

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

const { POST } = await import("@/app/api/transcriptions/recover/route");
const { resetEnvCache } = await import("@/lib/env");
const { resetRateLimits } = await import("@/lib/api/http");

async function seedConsentedRecording() {
  resetDemoState();
  const participants = await repository.replaceParticipants(DEMO_MEETING_ID, [
    { participant_type: "teacher", participant_ref_id: DEMO_TEACHER_ID, display_name: "Ana Pérez" },
    { participant_type: "representative", participant_ref_id: DEMO_REPRESENTATIVE_ID, display_name: "María López" },
  ]);
  await repository.setConsent(
    DEMO_MEETING_ID,
    participants.map((p) => ({ participant_id: p.id, consent_status: "granted" as const })),
    CONSENT_TEXT_VERSION,
  );
  await repository.updateMeeting(DEMO_MEETING_ID, { status: "recording" });
}

function request(fields: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return new Request("http://localhost:3000/api/transcriptions/recover", { method: "POST", body: form });
}

beforeEach(async () => {
  resetRateLimits();
  await seedConsentedRecording();
  process.env.DEMO_MODE = "true";
  delete process.env.DEEPGRAM_API_KEY;
  resetEnvCache();
});

afterEach(() => {
  delete process.env.DEEPGRAM_API_KEY;
  delete process.env.DEMO_MODE;
  resetEnvCache();
  vi.unstubAllGlobals();
});

describe("POST /api/transcriptions/recover", () => {
  it("entrega la transcripción de demostración rotulada cuando no hay Deepgram", async () => {
    const response = await POST(request({ meetingId: DEMO_MEETING_ID }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.simulated).toBe(true);
    expect(payload.segments).toHaveLength(DEMO_TRANSCRIPT.length);
    // El audio nunca se conserva en el servidor.
    expect(payload.audioRetained).toBe(false);
  });

  it("honra el plan B explícito aunque Deepgram esté configurado", async () => {
    process.env.DEEPGRAM_API_KEY = "clave-presente";
    resetEnvCache();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request({ meetingId: DEMO_MEETING_ID, source: "demo" }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.simulated).toBe(true);
    // No se llamó al proveedor: la transcripción ficticia no finge ser real.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("exige audio cuando Deepgram está configurado y no se pidió el plan B", async () => {
    process.env.DEEPGRAM_API_KEY = "clave-presente";
    resetEnvCache();

    const response = await POST(request({ meetingId: DEMO_MEETING_ID }));
    expect(response.status).toBe(400);
  });

  it("rechaza el plan B si el modo demostración está desactivado", async () => {
    process.env.DEMO_MODE = "false";
    process.env.DEEPGRAM_API_KEY = "clave-presente";
    resetEnvCache();

    const response = await POST(request({ meetingId: DEMO_MEETING_ID, source: "demo" }));
    expect(response.status).toBe(409);
  });

  it("no transcribe sin consentimiento de todas las personas", async () => {
    const participants = await repository.listParticipants(DEMO_MEETING_ID);
    await repository.setConsent(
      DEMO_MEETING_ID,
      [{ participant_id: participants[0].id, consent_status: "declined" }],
      CONSENT_TEXT_VERSION,
    );

    const response = await POST(request({ meetingId: DEMO_MEETING_ID, source: "demo" }));
    expect(response.status).toBe(403);
  });

  it("rechaza una reunión que no está grabando ni procesando", async () => {
    await repository.updateMeeting(DEMO_MEETING_ID, { status: "scheduled" });

    const response = await POST(request({ meetingId: DEMO_MEETING_ID, source: "demo" }));
    expect(response.status).toBe(409);
  });
});
