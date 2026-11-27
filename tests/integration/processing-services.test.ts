import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  adminClient,
  cleanupFixture,
  createApprovedMeeting,
  fixtureIds,
  localStack,
  signedInClient,
  sqlScalar,
} from "./local-stack";
import { SupabaseRepository } from "@/lib/data/supabase-repository";
import {
  dispatchToken,
  enqueue,
  generationFingerprint,
} from "@/lib/anthropic/jobs";
import { emptyMinutes } from "@/lib/schemas/minutes";
import { generateMinutesWithAnthropic } from "@/lib/anthropic/generate-minutes";
import worker from "../../netlify/functions/minutes-background";

vi.mock("@/lib/anthropic/generate-minutes", () => ({
  generateMinutesWithAnthropic: vi.fn(),
}));

describe("servicios de procesamiento contra Supabase local", () => {
  const ids = fixtureIds();
  let actor: string;
  let repo: SupabaseRepository;
  beforeAll(async () => {
    const stack = localStack();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", stack.apiUrl);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", stack.serviceKey);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", stack.anonKey);
    const auth = await signedInClient(ids.email);
    actor = auth.userId;
    const admin = adminClient();
    repo = new SupabaseRepository(auth.client, admin);
    await createApprovedMeeting(admin, ids, actor);
    await repo.updateMeeting(ids.meeting, { status: "draft" });
  });
  afterAll(() => {
    cleanupFixture(ids);
    vi.unstubAllEnvs();
  });

  it("reserva dos solicitudes entre seis consumidores concurrentes", async () => {
    const consumed = await Promise.all(
      Array.from({ length: 6 }, () => repo.consumeRequest(actor, "test", 2)),
    );
    expect(consumed.filter(Boolean)).toHaveLength(2);
  });

  it("dos despachos simultáneos consumen una generación y guardan un solo borrador", async () => {
    const detail = await repo.getMeetingDetail(ids.meeting);
    const segments = await repo.listSegments(ids.meeting);
    const fingerprint = generationFingerprint(detail!, segments, {});
    const [a, b] = await Promise.all(
      [1, 2].map(() =>
        enqueue(ids.meeting, ids.institution, actor, fingerprint),
      ),
    );
    expect(a.jobId).toBe(b.jobId);
    vi.mocked(generateMinutesWithAnthropic).mockResolvedValue({
      minutes: emptyMinutes(),
      model: "fixture",
    });
    const request = () =>
      new Request("http://localhost/worker", {
        method: "POST",
        body: a.jobId,
        headers: { "X-Acta-Job": dispatchToken(a.jobId) },
      });
    await Promise.all([worker(request()), worker(request())]);
    expect(generateMinutesWithAnthropic).toHaveBeenCalledTimes(1);
    expect(
      sqlScalar(
        `select state from public.generation_jobs where id='${a.jobId}'`,
      ),
    ).toBe("completed");
    expect(
      sqlScalar(
        `select count(*) from public.minutes where meeting_id='${ids.meeting}'`,
      ),
    ).toBe("2");
    await worker(request());
    expect(generateMinutesWithAnthropic).toHaveBeenCalledTimes(1);
  });

  it("la carga y la descarga de audio usan enlaces firmados en un bucket privado", async () => {
    const db = adminClient();
    const bucket = db.storage.from("acta-audio-recovery");
    const path = ids.institution + "/" + ids.meeting + "/fixture";
    const bytes = new Uint8Array(6 * 1024 * 1024);
    try {
      const grant = await bucket.createSignedUploadUrl(path);
      expect(grant.error).toBeNull();
      const uploaded = await bucket.uploadToSignedUrl(
        path,
        grant.data!.token,
        bytes,
        { contentType: "audio/webm" },
      );
      expect(uploaded.error).toBeNull();
      const url = await bucket.createSignedUrl(path, 60);
      const res = await fetch(url.data!.signedUrl);
      expect(res.ok).toBe(true);
      expect((await res.arrayBuffer()).byteLength).toBe(bytes.length);
      expect((await fetch(bucket.getPublicUrl(path).data.publicUrl)).ok).toBe(
        false,
      );
    } finally {
      await bucket.remove([path]);
    }
  });
});
