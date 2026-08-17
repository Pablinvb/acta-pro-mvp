"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireMeetingAccess, requireSession } from "@/lib/session";
import { assertTransition } from "@/lib/meeting-state";
import { CONSENT_TEXT_VERSION } from "@/lib/consent";
import type { ConsentStatus, ParticipantType } from "@/lib/types";

export interface ActionState {
  error?: string;
  ok?: boolean;
}

const createMeetingSchema = z.object({
  student_id: z.string().min(1, "Seleccione un estudiante."),
  title: z.string().trim().min(4, "El título debe tener al menos 4 caracteres.").max(160),
  reason: z.string().trim().max(600).optional(),
  scheduled_at: z.string().trim().min(1, "Indique fecha y hora."),
});

export async function createMeetingAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  const parsed = createMeetingSchema.safeParse({
    student_id: formData.get("student_id"),
    title: formData.get("title"),
    reason: formData.get("reason") ?? undefined,
    scheduled_at: formData.get("scheduled_at"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revise los datos del formulario." };
  }

  const student = await session.repository.getStudent(parsed.data.student_id);
  if (!student || student.institution_id !== session.institution.id) {
    return { error: "El estudiante no pertenece a su institución." };
  }

  // `datetime-local` llega sin zona; se interpreta como hora local del servidor.
  const scheduled = new Date(parsed.data.scheduled_at);
  if (Number.isNaN(scheduled.getTime())) {
    return { error: "La fecha indicada no es válida." };
  }

  const meeting = await session.repository.createMeeting({
    institution_id: session.institution.id,
    teacher_id: session.profile.id,
    student_id: student.id,
    title: parsed.data.title,
    reason: parsed.data.reason?.trim() || null,
    scheduled_at: scheduled.toISOString(),
    source: "manual",
  });

  await session.repository.appendAudit({
    institution_id: session.institution.id,
    actor_id: session.profile.id,
    meeting_id: meeting.id,
    action: "meeting.created",
    metadata_json: { source: "manual" },
  });

  revalidatePath("/meetings");
  revalidatePath("/dashboard");
  redirect(`/meetings/${meeting.id}/participants`);
}

const participantSchema = z.object({
  participant_type: z.enum(["teacher", "representative", "student", "other"]),
  participant_ref_id: z.string().nullable(),
  display_name: z.string().trim().min(2).max(160),
});

export async function confirmParticipantsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSession();
  const meetingId = String(formData.get("meeting_id") ?? "");
  const meeting = await requireMeetingAccess(session, meetingId);

  const raw = formData.getAll("participant").map((value) => {
    const [participant_type, refId, display_name] = String(value).split("|");
    return {
      participant_type: participant_type as ParticipantType,
      participant_ref_id: refId === "" ? null : refId,
      display_name,
    };
  });

  const parsed = z.array(participantSchema).min(2).safeParse(raw);
  if (!parsed.success) {
    return { error: "Seleccione al menos dos personas participantes." };
  }
  if (!parsed.data.some((p) => p.participant_type === "teacher")) {
    return { error: "La reunión debe incluir a la persona docente responsable." };
  }

  await session.repository.replaceParticipants(meetingId, parsed.data);

  if (meeting.status === "scheduled") {
    assertTransition(meeting.status, "ready");
    await session.repository.updateMeeting(meetingId, { status: "ready" });
  }

  await session.repository.appendAudit({
    institution_id: session.institution.id,
    actor_id: session.profile.id,
    meeting_id: meetingId,
    action: "meeting.participants_confirmed",
    metadata_json: { count: parsed.data.length },
  });

  revalidatePath(`/meetings/${meetingId}`, "layout");
  redirect(`/meetings/${meetingId}/record`);
}

export async function recordConsentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  const meetingId = String(formData.get("meeting_id") ?? "");
  await requireMeetingAccess(session, meetingId);

  const participants = await session.repository.listParticipants(meetingId);
  if (participants.length === 0) {
    return { error: "Confirme primero las personas participantes." };
  }

  const decisions = participants.map((participant) => ({
    participant_id: participant.id,
    consent_status: (formData.get(`consent_${participant.id}`) === "granted"
      ? "granted"
      : "declined") as ConsentStatus,
  }));

  if (!decisions.every((decision) => decision.consent_status === "granted")) {
    return {
      error:
        "No se puede grabar: todas las personas presentes deben registrar su consentimiento. Puede realizar la reunión sin grabación.",
    };
  }

  await session.repository.setConsent(meetingId, decisions, CONSENT_TEXT_VERSION);
  await session.repository.appendAudit({
    institution_id: session.institution.id,
    actor_id: session.profile.id,
    meeting_id: meetingId,
    action: "consent.recorded",
    metadata_json: { consent_text_version: CONSENT_TEXT_VERSION, participants: decisions.length },
  });

  revalidatePath(`/meetings/${meetingId}`, "layout");
  return { ok: true };
}

export async function mapSpeakersAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  const meetingId = String(formData.get("meeting_id") ?? "");
  const meeting = await requireMeetingAccess(session, meetingId);

  const segments = await session.repository.listSegments(meetingId);
  const labels = [...new Set(segments.map((segment) => segment.speaker_label))];

  const mapping: Record<string, string | null> = {};
  const used = new Set<string>();
  for (const label of labels) {
    const value = String(formData.get(`speaker_${label}`) ?? "");
    if (!value) return { error: `Asigne un rol al hablante ${label}.` };
    if (used.has(value)) {
      return { error: "Cada persona participante puede corresponder a un solo hablante." };
    }
    used.add(value);
    mapping[label] = value;
  }

  await session.repository.setSpeakerMapping(meetingId, mapping);
  await session.repository.appendAudit({
    institution_id: session.institution.id,
    actor_id: session.profile.id,
    meeting_id: meetingId,
    action: "speakers.mapped",
    metadata_json: { speakers: labels.length },
  });

  revalidatePath(`/meetings/${meetingId}`, "layout");
  if (meeting.status === "processing") {
    return { ok: true };
  }
  return { ok: true };
}
