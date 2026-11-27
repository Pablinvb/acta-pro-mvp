import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, toErrorResponse } from "@/lib/api/http";
import { requireApiSession, requireMeetingAccess } from "@/lib/session";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  try {
    const session = await requireApiSession();
    const query = new URL(request.url).searchParams;
    const meetingId = z.uuid().parse(query.get("meetingId"));
    await requireMeetingAccess(session, meetingId);
    const jobId = z.uuid().parse(query.get("jobId"));
    const result = await createSupabaseAdminClient()
      .from("generation_jobs")
      .select("state")
      .eq("id", jobId)
      .eq("meeting_id", meetingId)
      .eq("institution_id", session.institution.id)
      .maybeSingle();
    if (result.error)
      throw new ApiError(503, "Estado del trabajo no disponible.");
    if (!result.data) throw new ApiError(404, "Trabajo no disponible.");
    return NextResponse.json(result.data, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
