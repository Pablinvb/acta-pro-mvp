import { createSupabaseAdminClient } from "../../src/lib/supabase/admin";
import { dispatch } from "../../src/lib/anthropic/jobs";

export const config = { schedule: "*/10 * * * *" };

export default async function recover() {
  const db = createSupabaseAdminClient();
  const expired = await db
    .from("recovery_uploads")
    .select("id,object_path")
    .lt("expires_at", new Date().toISOString())
    .limit(100);
  if (expired.error)
    throw new Error("No se pudieron consultar las cargas caducadas.");
  if (expired.data.length) {
    const removed = await db.storage
      .from("acta-audio-recovery")
      .remove(expired.data.map((upload) => upload.object_path));
    if (!removed.error)
      await db
        .from("recovery_uploads")
        .delete()
        .in(
          "id",
          expired.data.map((upload) => upload.id),
        );
  }
  const stale = new Date(Date.now() - 16 * 60_000).toISOString();
  const { error } = await db
    .from("generation_jobs")
    .update({ state: "uncertain" })
    .eq("state", "running")
    .lt("touched_at", stale);
  if (error) throw new Error("No se pudo revisar la cola.");
  const abandoned = await db
    .from("generation_jobs")
    .select("id,attempts")
    .eq("state", "reserved")
    .lt("touched_at", stale)
    .limit(100);
  if (abandoned.error)
    throw new Error("No se pudieron recuperar las reservas.");
  for (const job of abandoned.data) {
    await db
      .from("generation_jobs")
      .update({ state: job.attempts < 3 ? "queued" : "failed" })
      .eq("id", job.id)
      .eq("state", "reserved")
      .eq("attempts", job.attempts);
  }
  const completed = await db
    .from("generation_jobs")
    .select("id")
    .eq("state", "generated")
    .limit(20);
  if (completed.error)
    throw new Error("No se pudieron consultar los borradores guardados.");
  for (const job of completed.data) {
    const finish = await db.rpc("finish_generation", { p_id: job.id });
    if (finish.error)
      throw new Error("No se pudo finalizar un borrador guardado.");
  }
  const pending = await db
    .from("generation_jobs")
    .select("id")
    .eq("state", "queued")
    .lte("available_at", new Date().toISOString())
    .order("available_at")
    .limit(10);
  if (pending.error) throw new Error("No se pudo consultar la cola.");
  await Promise.all(pending.data.map((job) => dispatch(job.id)));
}
