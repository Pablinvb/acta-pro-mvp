import { timingSafeEqual } from "node:crypto";
import { createSupabaseAdminClient } from "../../src/lib/supabase/admin";
import { SupabaseRepository } from "../../src/lib/data/supabase-repository";
import {
  dispatchToken,
  generationFingerprint,
} from "../../src/lib/anthropic/jobs";
import { generateMinutesWithAnthropic } from "../../src/lib/anthropic/generate-minutes";
import { ApiError } from "../../src/lib/api/error";

export default async function handler(request: Request) {
  const id = await request.text();
  if (request.method !== "POST" || !/^[0-9a-f-]{36}$/.test(id)) return;
  const expected = Buffer.from(dispatchToken(id));
  const supplied = Buffer.from(request.headers.get("X-Acta-Job") ?? "");
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  )
    return;
  const db = createSupabaseAdminClient();
  const checkpoint = await db
    .from("generation_jobs")
    .select("state")
    .eq("id", id)
    .maybeSingle();
  if (checkpoint.error) throw new Error("Cola no disponible.");
  if (checkpoint.data?.state === "generated") {
    const finalized = await db.rpc("finish_generation", { p_id: id });
    if (finalized.error)
      throw new Error("No se pudo finalizar el borrador guardado.");
    return;
  }
  const { data, error } = await db.rpc("claim_generation", { p_id: id });
  if (error) throw new Error("Error al reservar el trabajo.");
  const job = data?.[0];
  if (!job) return;
  let submitted = false;
  try {
    const repo = new SupabaseRepository(db, db);
    const detail = await repo.getMeetingDetail(job.meeting_id);
    if (!detail || detail.institution.id !== job.institution_id)
      throw new Error("Reunión no disponible.");
    const segments = await repo.listSegments(job.meeting_id);
    const speakers = Object.fromEntries(
      detail.participants
        .filter((p) => p.speaker_label)
        .map((p) => [p.speaker_label!, p.display_name]),
    );
    if (generationFingerprint(detail, segments, speakers) !== job.fingerprint)
      throw new Error("La transcripción cambió.");
    const reservation = await db
      .from("generation_jobs")
      .update({ state: "running", touched_at: new Date().toISOString() })
      .eq("id", id)
      .eq("attempts", job.attempts)
      .eq("state", "reserved")
      .select("id")
      .maybeSingle();
    if (reservation.error || !reservation.data) return;
    submitted = true;
    const result = await generateMinutesWithAnthropic(
      detail,
      segments,
      speakers,
      600_000,
    );
    const saved = await db
      .from("generation_jobs")
      .update({
        state: "generated",
        result: result.minutes,
        model: result.model,
        touched_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("state", "running")
      .eq("attempts", job.attempts)
      .select("id")
      .single();
    if (saved.error) throw new Error("No se pudo guardar el resultado.");
    const { error: saveError } = await db.rpc("finish_generation", {
      p_id: id,
    });
    if (saveError) throw new Error("No se pudo guardar el borrador.");
  } catch (cause) {
    const retry =
      cause instanceof ApiError && cause.status === 429 && job.attempts < 3;
    const state = retry ? "queued" : submitted ? "uncertain" : "failed";
    const { error } = await db
      .from("generation_jobs")
      .update({
        state,
        available_at: new Date(
          Date.now() + job.attempts * 60_000,
        ).toISOString(),
        touched_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("attempts", job.attempts)
      .eq("state", submitted ? "running" : "reserved");
    if (error) throw new Error("No se pudo actualizar el trabajo.");
    if (retry) throw new Error("Reintento pendiente por límite del proveedor.");
  }
}
