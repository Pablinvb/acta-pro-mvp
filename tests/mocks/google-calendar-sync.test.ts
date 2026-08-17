import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DemoRepository, resetDemoState } from "@/lib/data/demo-repository";
import { demoInstitution, demoTeacher, DEMO_TEACHER_ID } from "@/lib/demo/seed-data";

const list = vi.fn();
const setCredentials = vi.fn();

vi.mock("googleapis", () => ({
  google: {
    auth: {
      OAuth2: class {
        readonly setCredentials = setCredentials;
      },
    },
    calendar: () => ({ events: { list } }),
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
  };
});

const { POST } = await import("@/app/api/integrations/google/sync/route");
const { resetEnvCache } = await import("@/lib/env");
const { resetRateLimits } = await import("@/lib/api/http");
const { encryptToken } = await import("@/lib/crypto/tokens");
const { saveGoogleCredentials } = await import("@/lib/google/credentials");

const KEY = randomBytes(32).toString("base64");

function event(id: string, summary: string, start: string, actaPro?: string) {
  return {
    id,
    summary,
    start: { dateTime: start },
    extendedProperties: actaPro ? { private: { actaPro } } : undefined,
  };
}

beforeEach(async () => {
  resetDemoState();
  resetRateLimits();
  list.mockReset();
  setCredentials.mockReset();

  process.env.GOOGLE_CLIENT_ID = "client-id";
  process.env.GOOGLE_CLIENT_SECRET = "client-secret";
  process.env.GOOGLE_REDIRECT_URI = "http://localhost:3000/api/integrations/google/callback";
  process.env.GOOGLE_CALENDAR_ID = "primary";
  process.env.TOKEN_ENCRYPTION_KEY = KEY;
  resetEnvCache();

  await saveGoogleCredentials({
    profile_id: DEMO_TEACHER_ID,
    access_token_encrypted: encryptToken("access-token"),
    refresh_token_encrypted: encryptToken("refresh-token"),
    expiry_date: Date.now() + 3_600_000,
    scope: "https://www.googleapis.com/auth/calendar.events.readonly",
  });
});

afterEach(() => {
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.TOKEN_ENCRYPTION_KEY;
  resetEnvCache();
});

describe("POST /api/integrations/google/sync", () => {
  it("importa solo eventos marcados para ACTA PRO", async () => {
    list.mockResolvedValue({
      data: {
        items: [
          event("evt-1", "ACTA PRO: Seguimiento — Juan Pérez López", "2026-09-01T15:00:00Z"),
          event("evt-2", "Cumpleaños de mi hermana", "2026-09-02T15:00:00Z"),
          event("evt-3", "Reunión con Sofía Andrade Vera", "2026-09-03T15:00:00Z", "true"),
        ],
      },
    });

    const response = await POST();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ imported: 2, updated: 0, skipped: 1 });

    const meetings = await repository.listMeetings(DEMO_TEACHER_ID);
    const imported = meetings.filter((meeting) => meeting.source === "google_calendar");
    expect(imported).toHaveLength(2);
    // El prefijo se elimina del título almacenado.
    expect(imported.some((meeting) => meeting.title.startsWith("ACTA PRO:"))).toBe(false);
    expect(meetings.some((meeting) => meeting.title.includes("Cumpleaños"))).toBe(false);
  });

  it("pide alcance de solo lectura y usa los tokens descifrados", async () => {
    list.mockResolvedValue({ data: { items: [] } });
    await POST();

    expect(setCredentials).toHaveBeenCalledWith(
      expect.objectContaining({ access_token: "access-token", refresh_token: "refresh-token" }),
    );
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ calendarId: "primary", singleEvents: true, orderBy: "startTime" }),
    );
  });

  it("no duplica una reunión ya importada", async () => {
    const items = [event("evt-1", "ACTA PRO: Seguimiento — Juan Pérez López", "2026-09-01T15:00:00Z")];
    list.mockResolvedValue({ data: { items } });

    await POST();
    const second = await (await POST()).json();

    expect(second).toMatchObject({ imported: 0, updated: 1 });
    const meetings = await repository.listMeetings(DEMO_TEACHER_ID);
    expect(meetings.filter((meeting) => meeting.google_event_id === "evt-1")).toHaveLength(1);
  });

  it("omite eventos marcados cuyo estudiante no existe en la institución", async () => {
    list.mockResolvedValue({
      data: { items: [event("evt-9", "ACTA PRO: Reunión con Persona Desconocida", "2026-09-05T15:00:00Z")] },
    });

    const payload = await (await POST()).json();
    expect(payload).toMatchObject({ imported: 0, skipped: 1 });
  });

  it("registra en auditoría solo el recuento, sin datos del calendario", async () => {
    list.mockResolvedValue({
      data: { items: [event("evt-7", "ACTA PRO: Seguimiento — Juan Pérez López", "2026-09-07T15:00:00Z")] },
    });
    const audit = vi.spyOn(repository, "appendAudit");

    await POST();

    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "google.synced",
        meeting_id: null,
        metadata_json: { imported: 1, updated: 0, skipped: 0 },
      }),
    );
    audit.mockRestore();
  });

  it("exige conectar la cuenta antes de sincronizar", async () => {
    const { deleteGoogleCredentials } = await import("@/lib/google/credentials");
    await deleteGoogleCredentials(DEMO_TEACHER_ID);

    const response = await POST();
    expect(response.status).toBe(409);
  });
});
