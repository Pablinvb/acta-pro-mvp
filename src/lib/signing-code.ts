import { createHmac, randomInt, randomUUID } from "node:crypto";
import { Resend } from "resend";
import { createClient } from "@supabase/supabase-js";
import { getEnv, isResendConfigured } from "@/lib/env";
import { ApiError, checkRateLimit } from "@/lib/api/http";
import { requireMeetingAccess, type Session } from "@/lib/session";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/lib/supabase/server";

function digest(salt: string, code: string) {
  return createHmac("sha256", getEnv().SUPABASE_SERVICE_ROLE_KEY!)
    .update("acta/otp/" + salt + "/" + code)
    .digest("hex");
}

export async function issueCode(session: Session, id: string) {
  const env = getEnv();
  if (!isResendConfigured(env))
    throw new ApiError(503, "El remitente de Resend requiere configuración.");
  if (session.mode !== "supabase")
    throw new ApiError(403, "Se requiere sesión docente.");
  await checkRateLimit(session, "send-signing-code", 2);
  const record = await session.repository.getMinutes(id);
  if (!record || record.status !== "approved")
    throw new ApiError(409, "Se requiere un acta aprobada.");
  const meeting = await requireMeetingAccess(session, record.meeting_id);
  if (
    meeting.teacher_id !== session.profile.id ||
    meeting.status !== "approved"
  )
    throw new ApiError(403, "Solo puede firmar el docente responsable.");
  const detail = await session.repository.getMeetingDetail(meeting.id);
  const reps = detail?.participants.filter(
    (p) => p.participant_type === "representative",
  );
  const rep =
    reps?.length === 1 &&
    detail?.representatives.find((r) => r.id === reps[0].participant_ref_id);
  if (!rep || !rep.email)
    throw new ApiError(
      409,
      "El acta requiere un representante identificable con correo registrado.",
    );
  const email = rep.email.trim().toLowerCase();
  const code = randomInt(1_000_000).toString().padStart(6, "0");
  const salt = randomUUID();
  const table = createSupabaseAdminClient().from("signing_challenges");
  const { error } = await table.upsert({
    minutes_id: id,
    version: record.version,
    actor_id: session.profile.id,
    representative_id: rep.id,
    email,
    salt,
    code_hash: digest(salt, code),
    verified: false,
    attempts: 0,
    expires_at: new Date(Date.now() + 600_000).toISOString(),
  });
  if (error) throw new ApiError(503, "No se pudo preparar la verificación.");
  const sent = await new Resend(env.RESEND_API_KEY).emails.send({
    from: env.EMAIL_FROM!,
    to: email,
    subject: "Verificación de firma de ACTA PRO",
    text: `Su código para el acta ${id}, versión ${record.version}, es ${code}. Caduca en diez minutos.`,
  });
  if (sent.error) {
    await table.delete().eq("minutes_id", id).eq("salt", salt);
    throw new ApiError(
      502,
      "No se pudo entregar el código al correo registrado.",
    );
  }
}

export async function verifySigners(
  session: Session,
  id: string,
  password: string,
  code: string,
) {
  await checkRateLimit(session, "verify-signing-code", 5);
  const auth = await createSupabaseServerClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user?.email || user.id !== session.profile.id)
    throw new ApiError(403, "Sesión docente no disponible.");
  const env = getEnv();
  const isolated = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL!,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );
  const result = await isolated.auth.signInWithPassword({
    email: user.email,
    password,
  });
  if (result.error || result.data.user?.id !== user.id)
    throw new ApiError(403, "No se pudo reautenticar al docente.");
  await isolated.auth.signOut({ scope: "local" });
  const db = createSupabaseAdminClient();
  const challenge = await db
    .from("signing_challenges")
    .select("salt")
    .eq("minutes_id", id)
    .eq("actor_id", user.id)
    .maybeSingle();
  if (!challenge.data)
    throw new ApiError(403, "Solicite un código para esta versión.");
  const salt = challenge.data.salt;
  const { data, error } = await db.rpc("verify_signing_code", {
    p_minutes: id,
    p_actor: user.id,
    p_salt: salt,
    p_hash: digest(salt, code),
  });
  if (error || !data)
    throw new ApiError(403, "Código incorrecto, vencido o consumido.");
}
