import { createHash, createHmac } from "node:crypto";
import { buildMinutesUserMessage } from "./prompt";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getEnv } from "@/lib/env";
import type { MeetingDetail, TranscriptSegment } from "@/lib/types";

export function generationFingerprint(
  detail: MeetingDetail,
  segments: TranscriptSegment[],
  speakers: Record<string, string>,
) {
  return createHash("sha256")
    .update(buildMinutesUserMessage(detail, segments, speakers))
    .digest("hex");
}

export function dispatchToken(jobId: string) {
  return createHmac("sha256", getEnv().SUPABASE_SERVICE_ROLE_KEY!)
    .update("acta/generation/" + jobId)
    .digest("hex");
}

export async function dispatch(jobId: string) {
  const origin = process.env.DEPLOY_URL || getEnv().NEXT_PUBLIC_APP_URL;
  const response = await fetch(
    new URL("/.netlify/functions/minutes-background", origin),
    {
      method: "POST",
      headers: { "X-Acta-Job": dispatchToken(jobId) },
      body: jobId,
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    },
  );
  if (response.status !== 202)
    throw new Error("No se pudo iniciar el trabajo.");
}

export async function enqueue(
  meetingId: string,
  institutionId: string,
  actorId: string,
  fingerprint: string,
) {
  const db = createSupabaseAdminClient();
  const table = db.from("generation_jobs");
  const { error } = await table.upsert(
    {
      meeting_id: meetingId,
      institution_id: institutionId,
      actor_id: actorId,
      fingerprint,
    },
    { onConflict: "meeting_id,fingerprint", ignoreDuplicates: true },
  );
  if (error) throw new Error("No se pudo encolar el borrador.");
  const { data, error: lookup } = await table
    .select("id,state")
    .eq("meeting_id", meetingId)
    .eq("institution_id", institutionId)
    .eq("fingerprint", fingerprint)
    .single();
  if (lookup || !data) throw new Error("Trabajo no disponible.");
  return {
    jobId: data.id,
    state: data.state,
    dispatchToken: dispatchToken(data.id),
  };
}
