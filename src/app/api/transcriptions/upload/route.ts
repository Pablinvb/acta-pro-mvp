import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ApiError,
  checkRateLimit,
  readJson,
  toErrorResponse,
} from "@/lib/api/http";
import { requireApiSession, requireMeetingAccess } from "@/lib/session";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const session = await requireApiSession();
    if (session.mode !== "supabase")
      throw new ApiError(403, "Se requiere una sesión docente.");
    const { meetingId } = await readJson(
      request,
      z.object({ meetingId: z.uuid() }),
    );
    const meeting = await requireMeetingAccess(session, meetingId);
    await checkRateLimit(session, "recovery-upload", 4);
    const participants = await session.repository.listParticipants(meetingId);
    if (
      !["recording", "processing"].includes(meeting.status) ||
      !participants.length ||
      participants.some((p) => p.consent_status !== "granted")
    )
      throw new ApiError(
        403,
        "Se requiere consentimiento vigente para la grabación.",
      );
    const id = randomUUID();
    const path = [
      session.institution.id,
      meetingId,
      session.profile.id,
      id,
    ].join("/");
    const db = createSupabaseAdminClient();
    const registration = await db
      .from("recovery_uploads")
      .insert({ id, object_path: path });
    if (registration.error)
      throw new ApiError(503, "No se pudo registrar la carga.");
    const { data, error } = await db.storage
      .from("acta-audio-recovery")
      .createSignedUploadUrl(path);
    if (error) throw new ApiError(503, "No se pudo preparar la carga privada.");
    return NextResponse.json(
      { id, path, token: data.token },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
