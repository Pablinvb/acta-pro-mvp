import { randomUUID } from "node:crypto";

import type { Minutes } from "@/lib/schemas/minutes";
import type {
  AuditLog,
  CommitmentStatus,
  CommitmentTracking,
  CommitmentWithContext,
  ConsentStatus,
  DocumentRecord,
  Institution,
  Meeting,
  MeetingDetail,
  MeetingParticipant,
  MinutesRecord,
  Profile,
  Representative,
  Signature,
  Student,
  StudentRepresentative,
  TranscriptSegment,
} from "@/lib/types";
import {
  demoInstitution,
  demoMeetings,
  demoRepresentatives,
  demoStudentRepresentatives,
  demoStudents,
  demoTeacher,
} from "@/lib/demo/seed-data";
import type {
  AuditInput,
  DocumentListItem,
  NewDocumentInput,
  NewMeetingInput,
  NewSegmentInput,
  NewSignatureInput,
  ParticipantInput,
  Repository,
} from "@/lib/data/repository";
import { NotFoundError } from "@/lib/data/repository";
import { deriveCommitments } from "@/lib/data/commitments";

/**
 * Repositorio en memoria para el modo demostración.
 *
 * Permite ejecutar el flujo completo sin Supabase ni ninguna otra clave.
 * Limitación conocida y documentada: el estado vive en el proceso, por lo que
 * un reinicio del servidor devuelve el escenario a los datos semilla y un
 * despliegue con varias instancias no comparte estado. Es adecuado para la
 * demostración, no para uso institucional.
 */
interface DemoState {
  institutions: Institution[];
  profiles: Profile[];
  students: Student[];
  representatives: Representative[];
  studentRepresentatives: StudentRepresentative[];
  meetings: Meeting[];
  participants: MeetingParticipant[];
  segments: TranscriptSegment[];
  minutes: MinutesRecord[];
  signatures: Signature[];
  documents: DocumentRecord[];
  commitments: CommitmentTracking[];
  audit: AuditLog[];
  files: Map<string, Uint8Array>;
}

function seedState(): DemoState {
  return {
    institutions: [structuredClone(demoInstitution)],
    profiles: [structuredClone(demoTeacher)],
    students: structuredClone(demoStudents),
    representatives: structuredClone(demoRepresentatives),
    studentRepresentatives: structuredClone(demoStudentRepresentatives),
    meetings: structuredClone(demoMeetings),
    participants: [],
    segments: [],
    minutes: [],
    signatures: [],
    documents: [],
    commitments: [],
    audit: [],
    files: new Map(),
  };
}

// El estado se cuelga de globalThis para sobrevivir al hot reload de Next.
const globalRef = globalThis as unknown as { __actaProDemoState?: DemoState };

function state(): DemoState {
  if (!globalRef.__actaProDemoState) globalRef.__actaProDemoState = seedState();
  return globalRef.__actaProDemoState;
}

/** Solo para pruebas: reinicia el escenario a los datos semilla. */
export function resetDemoState() {
  globalRef.__actaProDemoState = seedState();
}

const now = () => new Date().toISOString();

export class DemoRepository implements Repository {
  readonly kind = "demo" as const;

  async getInstitution(id: string) {
    return state().institutions.find((i) => i.id === id) ?? null;
  }

  async getProfile(id: string) {
    return state().profiles.find((p) => p.id === id) ?? null;
  }

  async listStudents(institutionId: string) {
    return state()
      .students.filter((s) => s.institution_id === institutionId && s.active)
      .sort((a, b) => a.full_name.localeCompare(b.full_name, "es"));
  }

  async getStudent(id: string) {
    return state().students.find((s) => s.id === id) ?? null;
  }

  async getRepresentativesForStudent(studentId: string) {
    const links = state().studentRepresentatives.filter((l) => l.student_id === studentId);
    return links
      .map((link) => state().representatives.find((r) => r.id === link.representative_id))
      .filter((r): r is Representative => Boolean(r));
  }

  async listMeetings(teacherId: string) {
    return state()
      .meetings.filter((m) => m.teacher_id === teacherId)
      .sort((a, b) => (b.scheduled_at ?? b.created_at).localeCompare(a.scheduled_at ?? a.created_at));
  }

  async getMeeting(id: string) {
    return state().meetings.find((m) => m.id === id) ?? null;
  }

  async getMeetingDetail(id: string): Promise<MeetingDetail | null> {
    const meeting = await this.getMeeting(id);
    if (!meeting) return null;
    const [student, teacher, institution] = await Promise.all([
      this.getStudent(meeting.student_id),
      this.getProfile(meeting.teacher_id),
      this.getInstitution(meeting.institution_id),
    ]);
    if (!student || !teacher || !institution) return null;
    return {
      meeting,
      student,
      teacher,
      institution,
      representatives: await this.getRepresentativesForStudent(student.id),
      participants: await this.listParticipants(id),
    };
  }

  async createMeeting(input: NewMeetingInput) {
    const meeting: Meeting = {
      id: randomUUID(),
      institution_id: input.institution_id,
      teacher_id: input.teacher_id,
      student_id: input.student_id,
      title: input.title,
      reason: input.reason,
      scheduled_at: input.scheduled_at,
      started_at: null,
      ended_at: null,
      status: "scheduled",
      source: input.source,
      google_event_id: input.google_event_id ?? null,
      created_at: now(),
    };
    state().meetings.push(meeting);
    return meeting;
  }

  async updateMeeting(id: string, patch: Partial<Meeting>) {
    const meeting = state().meetings.find((m) => m.id === id);
    if (!meeting) throw new NotFoundError("la reunión", id);
    Object.assign(meeting, patch, { id: meeting.id });
    return meeting;
  }

  async findMeetingByGoogleEventId(institutionId: string, googleEventId: string) {
    return (
      state().meetings.find((m) => m.institution_id === institutionId && m.google_event_id === googleEventId) ??
      null
    );
  }

  async listParticipants(meetingId: string) {
    return state().participants.filter((p) => p.meeting_id === meetingId);
  }

  async replaceParticipants(meetingId: string, participants: ParticipantInput[]) {
    const store = state();
    const previous = store.participants.filter((p) => p.meeting_id === meetingId);
    store.participants = store.participants.filter((p) => p.meeting_id !== meetingId);

    const next = participants.map((participant) => {
      // Conserva consentimiento y mapeo si la persona ya estaba en la reunión.
      const existing = previous.find(
        (p) =>
          p.participant_type === participant.participant_type &&
          p.participant_ref_id === participant.participant_ref_id,
      );
      const record: MeetingParticipant = {
        id: existing?.id ?? randomUUID(),
        meeting_id: meetingId,
        participant_type: participant.participant_type,
        participant_ref_id: participant.participant_ref_id,
        display_name: participant.display_name,
        speaker_label: existing?.speaker_label ?? null,
        consent_status: existing?.consent_status ?? "pending",
        consent_at: existing?.consent_at ?? null,
        consent_text_version: existing?.consent_text_version ?? null,
      };
      return record;
    });

    store.participants.push(...next);
    return next;
  }

  async setConsent(
    meetingId: string,
    decisions: { participant_id: string; consent_status: ConsentStatus }[],
    consentTextVersion: string,
  ) {
    const timestamp = now();
    for (const decision of decisions) {
      const participant = state().participants.find(
        (p) => p.id === decision.participant_id && p.meeting_id === meetingId,
      );
      if (!participant) throw new NotFoundError("el participante", decision.participant_id);
      participant.consent_status = decision.consent_status;
      participant.consent_at = timestamp;
      participant.consent_text_version = consentTextVersion;
    }
    return this.listParticipants(meetingId);
  }

  async setSpeakerMapping(meetingId: string, mapping: Record<string, string | null>) {
    for (const participant of state().participants.filter((p) => p.meeting_id === meetingId)) {
      participant.speaker_label = null;
    }
    for (const [speakerLabel, participantId] of Object.entries(mapping)) {
      if (!participantId) continue;
      const participant = state().participants.find(
        (p) => p.id === participantId && p.meeting_id === meetingId,
      );
      if (!participant) throw new NotFoundError("el participante", participantId);
      participant.speaker_label = speakerLabel;
    }
    return this.listParticipants(meetingId);
  }

  async listSegments(meetingId: string) {
    return state()
      .segments.filter((s) => s.meeting_id === meetingId)
      .sort((a, b) => a.start_seconds - b.start_seconds);
  }

  async replaceSegments(meetingId: string, segments: NewSegmentInput[]) {
    const store = state();
    store.segments = store.segments.filter((s) => s.meeting_id !== meetingId);
    const created = segments.map((segment, index) => ({
      id: `${meetingId}-seg-${String(index + 1).padStart(2, "0")}`,
      meeting_id: meetingId,
      speaker_label: segment.speaker_label,
      start_seconds: segment.start_seconds,
      end_seconds: segment.end_seconds,
      text: segment.text,
      confidence: segment.confidence,
      is_final: segment.is_final,
      created_at: now(),
    }));
    store.segments.push(...created);
    return created;
  }

  async getLatestMinutes(meetingId: string) {
    const list = state()
      .minutes.filter((m) => m.meeting_id === meetingId)
      .sort((a, b) => b.version - a.version);
    return list[0] ?? null;
  }

  async getMinutes(id: string) {
    return state().minutes.find((m) => m.id === id) ?? null;
  }

  async createMinutes(input: {
    meeting_id: string;
    content: Minutes;
    generator: MinutesRecord["generator"];
    model: string | null;
  }) {
    const previous = await this.getLatestMinutes(input.meeting_id);
    const record: MinutesRecord = {
      id: randomUUID(),
      meeting_id: input.meeting_id,
      version: (previous?.version ?? 0) + 1,
      status: "draft",
      content: input.content,
      edited_content: null,
      accepted_language_flags: [],
      generated_at: now(),
      approved_at: null,
      generator: input.generator,
      model: input.model,
    };
    state().minutes.push(record);
    return record;
  }

  async updateMinutes(id: string, patch: Partial<MinutesRecord>) {
    const record = state().minutes.find((m) => m.id === id);
    if (!record) throw new NotFoundError("el acta", id);
    Object.assign(record, patch, { id: record.id, meeting_id: record.meeting_id });
    return record;
  }

  async listSignatures(minutesId: string) {
    return state().signatures.filter((s) => s.minutes_id === minutesId);
  }

  async addSignature(input: NewSignatureInput) {
    const store = state();
    // Una firma por rol: volver a firmar reemplaza la anterior.
    store.signatures = store.signatures.filter(
      (s) => !(s.minutes_id === input.minutes_id && s.signer_role === input.signer_role),
    );
    const signature: Signature = {
      id: randomUUID(),
      minutes_id: input.minutes_id,
      signer_name: input.signer_name,
      signer_role: input.signer_role,
      signature_path: input.signature_path,
      signed_at: now(),
      acceptance_text_version: input.acceptance_text_version,
    };
    store.signatures.push(signature);
    return signature;
  }

  async createDocument(input: NewDocumentInput) {
    const document: DocumentRecord = {
      id: randomUUID(),
      minutes_id: input.minutes_id,
      meeting_id: input.meeting_id,
      storage_path: input.storage_path,
      sha256: input.sha256,
      document_code: input.document_code,
      version: input.version,
      sent_at: null,
      provider_message_id: null,
      created_at: now(),
    };
    state().documents.push(document);
    return document;
  }

  async getDocument(id: string) {
    return state().documents.find((d) => d.id === id) ?? null;
  }

  async updateDocument(id: string, patch: Partial<DocumentRecord>) {
    const document = state().documents.find((d) => d.id === id);
    if (!document) throw new NotFoundError("el documento", id);
    Object.assign(document, patch, { id: document.id });
    return document;
  }

  async listDocuments(institutionId: string, filters?: { studentId?: string }) {
    const store = state();
    const items: DocumentListItem[] = [];
    for (const document of store.documents) {
      const meeting = store.meetings.find((m) => m.id === document.meeting_id);
      if (!meeting || meeting.institution_id !== institutionId) continue;
      if (filters?.studentId && meeting.student_id !== filters.studentId) continue;
      const student = store.students.find((s) => s.id === meeting.student_id);
      if (!student) continue;
      items.push({ document, meeting, student });
    }
    return items.sort((a, b) => b.document.created_at.localeCompare(a.document.created_at));
  }

  async syncCommitmentsFromMinutes(minutesId: string) {
    const store = state();
    const record = store.minutes.find((item) => item.id === minutesId);
    if (!record) throw new NotFoundError("el acta", minutesId);
    const meeting = store.meetings.find((item) => item.id === record.meeting_id);
    if (!meeting) throw new NotFoundError("la reunión", record.meeting_id);

    const previous = store.commitments.filter((item) => item.minutes_id === minutesId);
    store.commitments = store.commitments.filter((item) => item.minutes_id !== minutesId);

    const timestamp = now();
    const created = deriveCommitments(record).map((item) => {
      // Al regenerar el acta se conserva el avance ya registrado para la misma entrada.
      const existing = previous.find(
        (candidate) => candidate.kind === item.kind && candidate.item_index === item.item_index,
      );
      const tracking: CommitmentTracking = {
        id: existing?.id ?? randomUUID(),
        institution_id: meeting.institution_id,
        meeting_id: meeting.id,
        minutes_id: minutesId,
        kind: item.kind,
        item_index: item.item_index,
        description: item.description,
        responsible: item.responsible,
        due_date: item.due_date,
        status: existing?.status ?? "pending",
        completed_at: existing?.completed_at ?? null,
        updated_at: timestamp,
        created_at: existing?.created_at ?? timestamp,
      };
      return tracking;
    });

    store.commitments.push(...created);
    return created;
  }

  async listCommitments(institutionId: string, filters?: { studentId?: string }) {
    const store = state();
    const items: CommitmentWithContext[] = [];

    for (const commitment of store.commitments) {
      if (commitment.institution_id !== institutionId) continue;
      const meeting = store.meetings.find((item) => item.id === commitment.meeting_id);
      if (!meeting) continue;
      if (filters?.studentId && meeting.student_id !== filters.studentId) continue;
      const student = store.students.find((item) => item.id === meeting.student_id);
      if (!student) continue;
      items.push({ commitment, meeting, student });
    }

    return items.sort((a, b) => {
      // Primero lo que tiene fecha, en orden cronológico; lo demás al final.
      const left = a.commitment.due_date ?? "9999-12-31";
      const right = b.commitment.due_date ?? "9999-12-31";
      return left.localeCompare(right);
    });
  }

  async setCommitmentStatus(id: string, status: CommitmentStatus) {
    const commitment = state().commitments.find((item) => item.id === id);
    if (!commitment) throw new NotFoundError("el compromiso", id);
    commitment.status = status;
    commitment.completed_at = status === "completed" ? now() : null;
    commitment.updated_at = now();
    return commitment;
  }

  async appendAudit(input: AuditInput) {
    const entry: AuditLog = {
      id: randomUUID(),
      institution_id: input.institution_id,
      actor_id: input.actor_id,
      meeting_id: input.meeting_id,
      action: input.action,
      metadata_json: input.metadata_json ?? {},
      created_at: now(),
    };
    state().audit.push(entry);
    return entry;
  }

  async listAudit(meetingId: string) {
    return state()
      .audit.filter((a) => a.meeting_id === meetingId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  async putDocumentFile(path: string, bytes: Uint8Array) {
    state().files.set(path, bytes);
    return path;
  }

  async getDocumentFile(path: string) {
    return state().files.get(path) ?? null;
  }
}
