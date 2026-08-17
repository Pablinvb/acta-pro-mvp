import { notFound, redirect } from "next/navigation";

import { getSession, type Session } from "@/lib/session";
import type { MeetingDetail } from "@/lib/types";
import { hasReached } from "@/lib/meeting-state";
import type { MeetingStatus } from "@/lib/types";

export interface MeetingPageContext {
  session: Session;
  detail: MeetingDetail;
}

/**
 * Carga una reunión comprobando sesión, institución y titularidad.
 * Devuelve 404 —y no 403— cuando la reunión no es accesible, para no revelar
 * la existencia de registros de otras instituciones.
 */
export async function loadMeeting(meetingId: string): Promise<MeetingPageContext> {
  const session = await getSession();
  if (!session) redirect("/login");

  const detail = await session.repository.getMeetingDetail(meetingId);
  if (!detail) notFound();

  const sameInstitution = detail.meeting.institution_id === session.profile.institution_id;
  const isOwner = detail.meeting.teacher_id === session.profile.id;
  if (!sameInstitution || (!isOwner && session.profile.role !== "admin")) notFound();

  return { session, detail };
}

/** Redirige al paso correcto cuando se intenta saltar etapas del flujo. */
export function requireStage(detail: MeetingDetail, required: MeetingStatus) {
  if (!hasReached(detail.meeting.status, required)) {
    redirect(`/meetings/${detail.meeting.id}`);
  }
}
