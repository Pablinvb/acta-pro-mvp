import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  adminClient,
  cleanupFixture,
  createApprovedMeeting,
  fixtureIds,
  localStack,
  signedInClient,
} from "./local-stack";
import { SupabaseRepository } from "@/lib/data/supabase-repository";
import type { Session } from "@/lib/session";
import { issueCode, verifySigners } from "@/lib/signing-code";

const mail = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("resend", () => ({
  Resend: class {
    emails = mail;
  },
}));
let client: SupabaseClient;
vi.mock("@/lib/supabase/server", async (original) => ({
  ...(await original<typeof import("@/lib/supabase/server")>()),
  createSupabaseServerClient: async () => client,
}));
const ids = fixtureIds();
let session: Session;
let password: string;
let code: string;
beforeAll(async () => {
  const stack = localStack();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", stack.apiUrl);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", stack.anonKey);
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", stack.serviceKey);
  vi.stubEnv("RESEND_API_KEY", "test-key");
  vi.stubEnv("EMAIL_FROM", "acta@example.invalid");
  const auth = await signedInClient(ids.email);
  client = auth.client;
  password = auth.password;
  const db = adminClient();
  await createApprovedMeeting(db, ids, auth.userId);
  const repo = new SupabaseRepository(client, db);
  const profile = await repo.getProfile(auth.userId);
  const institution = await repo.getInstitution(ids.institution);
  session = {
    profile: profile!,
    institution: institution!,
    repository: repo,
    mode: "supabase",
  };
  for (const query of [
    db
      .from("representatives")
      .insert({
        id: ids.minutes,
        full_name: "Representante",
        email: "rep@example.invalid",
      }),
    db
      .from("student_representatives")
      .insert({ student_id: ids.student, representative_id: ids.minutes }),
    db
      .from("meeting_participants")
      .insert({
        meeting_id: ids.meeting,
        participant_type: "representative",
        participant_ref_id: ids.minutes,
        display_name: "Representante",
      }),
  ]) {
    const { error } = await query;
    if (error) throw error;
  }
  mail.send.mockImplementation(
    async (message: { text: string; to: string }) => {
      expect(message.to).toBe("rep@example.invalid");
      code = message.text.match(/es (\d{6})\./)![1];
      return { error: null };
    },
  );
});
afterAll(() => {
  cleanupFixture(ids);
  vi.unstubAllEnvs();
});

it("exige contraseña y OTP del acta, conserva la sesión y registra ambos métodos", async () => {
  const original = (await client.auth.getSession()).data.session!.access_token;
  const premature = await client.rpc("sign_minutes_verified", {
    p_minutes_id: ids.minutes,
    p_signatures: [
      {signer_name:"Docente",signer_role:"teacher",signature_path:"AAA"},
      {signer_name:"Representante",signer_role:"representative",signature_path:"BBB"},
    ],
    p_acceptance_text_version: "v1",
  });
  expect(premature.error?.code).toBe("42501");
  await issueCode(session, ids.minutes);
  await expect(
    verifySigners(session, ids.minutes, "incorrecta", code),
  ).rejects.toThrow("reautenticar");
  const wrong = code === "000000" ? "111111" : "000000";
  await expect(
    verifySigners(session, ids.minutes, password, wrong),
  ).rejects.toThrow("Código incorrecto");
  await verifySigners(session, ids.minutes, password, code);
  await expect(
    verifySigners(session, ids.minutes, password, code),
  ).rejects.toThrow("Código incorrecto");
  await session.repository.signMinutes({
    minutes_id: ids.minutes,
    acceptance_text_version: "v1",
    signatures: [
      {
        signer_name: "Docente de integración",
        signer_role: "teacher",
        signature_path: "AAA",
      },
      {
        signer_name: "Representante",
        signer_role: "representative",
        signature_path: "BBB",
      },
    ],
  });
  const signatures = await session.repository.listSignatures(ids.minutes);
  expect(signatures.map((s) => s.verification_method).sort()).toEqual([
    "codigo_correo",
    "docente_reautenticado",
  ]);
  expect((await client.auth.getSession()).data.session!.access_token).toBe(
    original,
  );
  expect((await client.auth.getUser()).data.user?.id).toBe(session.profile.id);
});
