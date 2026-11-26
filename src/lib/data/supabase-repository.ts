import type { SupabaseClient } from "@supabase/supabase-js";
import { sha256Hex } from "@/lib/pdf/render";

import type { Minutes } from "@/lib/schemas/minutes";
import type {
  AuditLog,
  CommitmentStatus,
  CommitmentTracking,
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
  TranscriptSegment,
} from "@/lib/types";
import type {
  AuditInput,
  NewDocumentInput,
  SignMinutesInput,
  SignMinutesResult,
  NewMeetingInput,
  NewSegmentInput,
  NewSignatureInput,
  ParticipantInput,
  Repository,
} from "@/lib/data/repository";
import { SigningError } from "@/lib/data/repository";
import { deriveCommitments } from "@/lib/data/commitments";
import { DOCUMENTS_BUCKET } from "@/lib/supabase/server";

/** Fila de `minutes` tal como está en Postgres. */
interface MinutesRow {
  id: string;
  meeting_id: string;
  version: number;
  status: MinutesRecord["status"];
  summary: string;
  meeting_reason: string | null;
  topics_json: Minutes["topics"];
  facts_json: Minutes["facts"];
  agreements_json: Minutes["agreements"];
  commitments_json: Minutes["commitments"];
  follow_up_json: Minutes["follow_up"];
  pending_items_json: string[];
  contradictions_json: string[];
  language_flags_json: Minutes["language_flags"];
  review_warnings_json: string[];
  edited_content_json: Minutes | null;
  accepted_language_flags: number[] | null;
  generated_at: string;
  approved_at: string | null;
  generator: MinutesRecord["generator"];
  model: string | null;
}

function rowToMinutes(row: MinutesRow): MinutesRecord {
  return {
    id: row.id,
    meeting_id: row.meeting_id,
    version: row.version,
    status: row.status,
    content: {
      summary: row.summary,
      meeting_reason: row.meeting_reason,
      topics: row.topics_json ?? [],
      facts: row.facts_json ?? [],
      agreements: row.agreements_json ?? [],
      commitments: row.commitments_json ?? [],
      follow_up: row.follow_up_json ?? [],
      pending_items: row.pending_items_json ?? [],
      contradictions: row.contradictions_json ?? [],
      language_flags: row.language_flags_json ?? [],
      review_warnings: row.review_warnings_json ?? [],
    },
    edited_content: row.edited_content_json,
    accepted_language_flags: row.accepted_language_flags ?? [],
    generated_at: row.generated_at,
    approved_at: row.approved_at,
    generator: row.generator,
    model: row.model,
  };
}

function minutesToRow(content: Minutes) {
  return {
    summary: content.summary,
    meeting_reason: content.meeting_reason,
    topics_json: content.topics,
    facts_json: content.facts,
    agreements_json: content.agreements,
    commitments_json: content.commitments,
    follow_up_json: content.follow_up,
    pending_items_json: content.pending_items,
    contradictions_json: content.contradictions,
    language_flags_json: content.language_flags,
    review_warnings_json: content.review_warnings,
  };
}

function unwrap<T>(result: { data: T | null; error: { message: string } | null }, context: string): T {
  if (result.error) throw new Error(`${context}: ${result.error.message}`);
  if (result.data === null) throw new Error(`${context}: respuesta vacía.`);
  return result.data;
}

/**
 * Repositorio sobre Postgres. Las consultas usan el cliente ligado a la
 * sesión, de modo que Row Level Security filtra por institución y usuario.
 * El cliente con service role se reserva para el bucket privado de documentos.
 */
export class SupabaseRepository implements Repository {
  readonly kind = "supabase" as const;

  constructor(
    private readonly db: SupabaseClient,
    private readonly admin: SupabaseClient,
  ) {}

  async getInstitution(id: string) {
    const { data } = await this.db.from("institutions").select("*").eq("id", id).maybeSingle();
    return (data as Institution) ?? null;
  }

  async getProfile(id: string) {
    const { data } = await this.db.from("profiles").select("*").eq("id", id).maybeSingle();
    return (data as Profile) ?? null;
  }

  async listStudents(institutionId: string) {
    const { data, error } = await this.db
      .from("students")
      .select("*")
      .eq("institution_id", institutionId)
      .eq("active", true)
      .order("full_name");
    if (error) throw new Error(`No se pudieron listar estudiantes: ${error.message}`);
    return (data ?? []) as Student[];
  }

  async getStudent(id: string) {
    const { data } = await this.db.from("students").select("*").eq("id", id).maybeSingle();
    return (data as Student) ?? null;
  }

  async getRepresentativesForStudent(studentId: string) {
    const { data, error } = await this.db
      .from("student_representatives")
      .select("relationship, representatives(*)")
      .eq("student_id", studentId);
    if (error) throw new Error(`No se pudieron listar representantes: ${error.message}`);
    // PostgREST devuelve la relación anidada; el tipo inferido no distingue
    // entre uno y varios, así que se normaliza a lista antes de aplanar.
    return ((data ?? []) as unknown as { representatives: Representative | Representative[] | null }[])
      .flatMap((row) =>
        row.representatives === null
          ? []
          : Array.isArray(row.representatives)
            ? row.representatives
            : [row.representatives],
      )
      .filter((representative): representative is Representative => Boolean(representative));
  }

  async listMeetings(teacherId: string) {
    const { data, error } = await this.db
      .from("meetings")
      .select("*")
      .eq("teacher_id", teacherId)
      .order("scheduled_at", { ascending: false, nullsFirst: false });
    if (error) throw new Error(`No se pudieron listar reuniones: ${error.message}`);
    return (data ?? []) as Meeting[];
  }

  async getMeeting(id: string) {
    const { data } = await this.db.from("meetings").select("*").eq("id", id).maybeSingle();
    return (data as Meeting) ?? null;
  }

  async getMeetingDetail(id: string): Promise<MeetingDetail | null> {
    const meeting = await this.getMeeting(id);
    if (!meeting) return null;
    const [student, teacher, institution, representatives, participants] = await Promise.all([
      this.getStudent(meeting.student_id),
      this.getProfile(meeting.teacher_id),
      this.getInstitution(meeting.institution_id),
      this.getRepresentativesForStudent(meeting.student_id),
      this.listParticipants(id),
    ]);
    if (!student || !teacher || !institution) return null;
    return { meeting, student, teacher, institution, representatives, participants };
  }

  async createMeeting(input: NewMeetingInput) {
    const result = await this.db
      .from("meetings")
      .insert({ ...input, status: "scheduled" })
      .select("*")
      .single();
    return unwrap(result, "No se pudo crear la reunión") as Meeting;
  }

  async updateMeeting(id: string, patch: Partial<Meeting>) {
    const result = await this.db.from("meetings").update(patch).eq("id", id).select("*").single();
    return unwrap(result, "No se pudo actualizar la reunión") as Meeting;
  }

  async findMeetingByGoogleEventId(institutionId: string, googleEventId: string) {
    const { data } = await this.db
      .from("meetings")
      .select("*")
      .eq("institution_id", institutionId)
      .eq("google_event_id", googleEventId)
      .maybeSingle();
    return (data as Meeting) ?? null;
  }

  async listParticipants(meetingId: string) {
    const { data, error } = await this.db
      .from("meeting_participants")
      .select("*")
      .eq("meeting_id", meetingId)
      .order("participant_type");
    if (error) throw new Error(`No se pudieron listar participantes: ${error.message}`);
    return (data ?? []) as MeetingParticipant[];
  }

  async replaceParticipants(meetingId: string, participants: ParticipantInput[]) {
    const previous = await this.listParticipants(meetingId);
    const keepIds: string[] = [];

    for (const participant of participants) {
      const existing = previous.find(
        (p) =>
          p.participant_type === participant.participant_type &&
          p.participant_ref_id === participant.participant_ref_id,
      );
      if (existing) {
        keepIds.push(existing.id);
        await this.db
          .from("meeting_participants")
          .update({ display_name: participant.display_name })
          .eq("id", existing.id);
      } else {
        const result = await this.db
          .from("meeting_participants")
          .insert({ meeting_id: meetingId, ...participant, consent_status: "pending" })
          .select("id")
          .single();
        keepIds.push((unwrap(result, "No se pudo agregar el participante") as { id: string }).id);
      }
    }

    const removable = previous.filter((p) => !keepIds.includes(p.id)).map((p) => p.id);
    if (removable.length > 0) {
      await this.db.from("meeting_participants").delete().in("id", removable);
    }
    return this.listParticipants(meetingId);
  }

  async setConsent(
    meetingId: string,
    decisions: { participant_id: string; consent_status: ConsentStatus }[],
    consentTextVersion: string,
  ) {
    const timestamp = new Date().toISOString();
    for (const decision of decisions) {
      const { error } = await this.db
        .from("meeting_participants")
        .update({
          consent_status: decision.consent_status,
          consent_at: timestamp,
          consent_text_version: consentTextVersion,
        })
        .eq("id", decision.participant_id)
        .eq("meeting_id", meetingId);
      if (error) throw new Error(`No se pudo registrar el consentimiento: ${error.message}`);
    }
    return this.listParticipants(meetingId);
  }

  async setSpeakerMapping(meetingId: string, mapping: Record<string, string | null>) {
    await this.db.from("meeting_participants").update({ speaker_label: null }).eq("meeting_id", meetingId);
    for (const [speakerLabel, participantId] of Object.entries(mapping)) {
      if (!participantId) continue;
      const { error } = await this.db
        .from("meeting_participants")
        .update({ speaker_label: speakerLabel })
        .eq("id", participantId)
        .eq("meeting_id", meetingId);
      if (error) throw new Error(`No se pudo asignar el hablante: ${error.message}`);
    }
    return this.listParticipants(meetingId);
  }

  async listSegments(meetingId: string) {
    const { data, error } = await this.db
      .from("transcript_segments")
      .select("*")
      .eq("meeting_id", meetingId)
      .order("start_seconds");
    if (error) throw new Error(`No se pudo leer la transcripción: ${error.message}`);
    return (data ?? []) as TranscriptSegment[];
  }

  async replaceSegments(meetingId: string, segments: NewSegmentInput[]) {
    const { error: deleteError } = await this.db
      .from("transcript_segments")
      .delete()
      .eq("meeting_id", meetingId);
    if (deleteError) throw new Error(`No se pudo limpiar la transcripción: ${deleteError.message}`);

    if (segments.length === 0) return [];

    const rows = segments.map((segment, index) => ({
      id: `${meetingId}-seg-${String(index + 1).padStart(2, "0")}`,
      meeting_id: meetingId,
      ...segment,
    }));
    const { data, error } = await this.db.from("transcript_segments").insert(rows).select("*");
    if (error) throw new Error(`No se pudo guardar la transcripción: ${error.message}`);
    return (data ?? []) as TranscriptSegment[];
  }

  async getLatestMinutes(meetingId: string) {
    const { data } = await this.db
      .from("minutes")
      .select("*")
      .eq("meeting_id", meetingId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data ? rowToMinutes(data as MinutesRow) : null;
  }

  async getMinutes(id: string) {
    const { data } = await this.db.from("minutes").select("*").eq("id", id).maybeSingle();
    return data ? rowToMinutes(data as MinutesRow) : null;
  }

  async createMinutes(input: {
    meeting_id: string;
    content: Minutes;
    generator: MinutesRecord["generator"];
    model: string | null;
  }) {
    const previous = await this.getLatestMinutes(input.meeting_id);
    const result = await this.db
      .from("minutes")
      .insert({
        meeting_id: input.meeting_id,
        version: (previous?.version ?? 0) + 1,
        status: "draft",
        generator: input.generator,
        model: input.model,
        accepted_language_flags: [],
        ...minutesToRow(input.content),
      })
      .select("*")
      .single();
    return rowToMinutes(unwrap(result, "No se pudo guardar el acta") as MinutesRow);
  }

  async updateMinutes(id: string, patch: Partial<MinutesRecord>) {
    const row: Record<string, unknown> = {};
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.approved_at !== undefined) row.approved_at = patch.approved_at;
    if (patch.accepted_language_flags !== undefined) {
      row.accepted_language_flags = patch.accepted_language_flags;
    }
    if (patch.edited_content !== undefined) row.edited_content_json = patch.edited_content;
    if (patch.content !== undefined) Object.assign(row, minutesToRow(patch.content));

    const result = await this.db.from("minutes").update(row).eq("id", id).select("*").single();
    return rowToMinutes(unwrap(result, "No se pudo actualizar el acta") as MinutesRow);
  }

  async listSignatures(minutesId: string) {
    const { data, error } = await this.db
      .from("signatures")
      .select("*")
      .eq("minutes_id", minutesId)
      .order("signed_at");
    if (error) throw new Error(`No se pudieron leer las firmas: ${error.message}`);
    return (data ?? []) as Signature[];
  }

  async addSignature(input: NewSignatureInput) {
    await this.db
      .from("signatures")
      .delete()
      .eq("minutes_id", input.minutes_id)
      .eq("signer_role", input.signer_role);
    const result = await this.db.from("signatures").insert(input).select("*").single();
    return unwrap(result, "No se pudo registrar la firma") as Signature;
  }

  async signMinutes(input: SignMinutesInput): Promise<SignMinutesResult> {
    // Toda la validación vive en la función de Postgres, que además bloquea la
    // reunión. Replicarla aquí abriría la puerta a que ambas se desincronicen.
    const { data, error } = await this.db.rpc("sign_minutes", {
      p_minutes_id: input.minutes_id,
      p_signatures: input.signatures,
      p_acceptance_text_version: input.acceptance_text_version,
    });

    if (error) {
      // 23514 es la violación de regla de negocio que levanta la función,
      // 42501 la falta de autorización y 22023 una entrada inválida: las tres
      // son del usuario, no del sistema.
      if (["23514", "42501", "22023"].includes(error.code ?? "")) {
        throw new SigningError(error.message);
      }
      throw new Error(`No se pudo firmar el acta: ${error.message}`);
    }

    return data as SignMinutesResult;
  }

  async createDocument(input: NewDocumentInput) {
    const result = await this.db.from("documents").insert(input).select("*").single();
    return unwrap(result, "No se pudo registrar el documento") as DocumentRecord;
  }

  async findDocumentByFingerprint(minutesId: string, fingerprint: string) {
    const { data } = await this.db
      .from("documents")
      .select("*")
      .eq("minutes_id", minutesId)
      .eq("generation_fingerprint", fingerprint)
      .maybeSingle();
    return (data as DocumentRecord) ?? null;
  }

  async deleteOrphanDocument(id: string, fingerprint: string) {
    // Con el cliente de usuario esto no borraría nada: `documents` no tiene
    // política de DELETE, a propósito. La reparación la hace el servidor, y se
    // acota por huella y por "sin enviar" para que no pueda ir más lejos.
    const { error } = await this.admin
      .from("documents")
      .delete()
      .eq("id", id)
      .eq("generation_fingerprint", fingerprint)
      .is("sent_at", null);
    if (error) throw new Error(`No se pudo deshacer el documento: ${error.message}`);
  }

  async getDocument(id: string) {
    const { data } = await this.db.from("documents").select("*").eq("id", id).maybeSingle();
    return (data as DocumentRecord) ?? null;
  }

  async updateDocument(id: string, patch: Partial<DocumentRecord>) {
    const result = await this.db.from("documents").update(patch).eq("id", id).select("*").single();
    return unwrap(result, "No se pudo actualizar el documento") as DocumentRecord;
  }

  async listDocuments(institutionId: string, filters?: { studentId?: string }) {
    let query = this.db
      .from("documents")
      .select("*, meetings!inner(*, students!inner(*))")
      .eq("meetings.institution_id", institutionId)
      .order("created_at", { ascending: false });
    if (filters?.studentId) query = query.eq("meetings.student_id", filters.studentId);

    const { data, error } = await query;
    if (error) throw new Error(`No se pudo leer el repositorio: ${error.message}`);

    type Row = DocumentRecord & { meetings: Meeting & { students: Student } };
    return ((data ?? []) as Row[]).map((row) => {
      const { meetings, ...document } = row;
      const { students, ...meeting } = meetings;
      return { document: document as DocumentRecord, meeting: meeting as Meeting, student: students };
    });
  }

  async syncCommitmentsFromMinutes(minutesId: string) {
    const record = await this.getMinutes(minutesId);
    if (!record) throw new Error("El acta no existe.");
    const meeting = await this.getMeeting(record.meeting_id);
    if (!meeting) throw new Error("La reunión no existe.");

    const { data: previousRows } = await this.db
      .from("commitment_tracking")
      .select("*")
      .eq("minutes_id", minutesId);
    const previous = (previousRows ?? []) as CommitmentTracking[];

    const derived = deriveCommitments(record);
    const rows = derived.map((item) => {
      // Al regenerar el acta se conserva el avance ya registrado.
      const existing = previous.find(
        (candidate) => candidate.kind === item.kind && candidate.item_index === item.item_index,
      );
      return {
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
        updated_at: new Date().toISOString(),
      };
    });

    const { error: deleteError } = await this.db
      .from("commitment_tracking")
      .delete()
      .eq("minutes_id", minutesId);
    if (deleteError) throw new Error(`No se pudo actualizar el seguimiento: ${deleteError.message}`);

    if (rows.length === 0) return [];

    const { data, error } = await this.db.from("commitment_tracking").insert(rows).select("*");
    if (error) throw new Error(`No se pudo actualizar el seguimiento: ${error.message}`);
    return (data ?? []) as CommitmentTracking[];
  }

  async listCommitments(institutionId: string, filters?: { studentId?: string }) {
    let query = this.db
      .from("commitment_tracking")
      .select("*, meetings!inner(*, students!inner(*))")
      .eq("institution_id", institutionId)
      .order("due_date", { ascending: true, nullsFirst: false });
    if (filters?.studentId) query = query.eq("meetings.student_id", filters.studentId);

    const { data, error } = await query;
    if (error) throw new Error(`No se pudo leer el seguimiento: ${error.message}`);

    type Row = CommitmentTracking & { meetings: Meeting & { students: Student } };
    return ((data ?? []) as Row[]).map((row) => {
      const { meetings, ...commitment } = row;
      const { students, ...meeting } = meetings;
      return { commitment: commitment as CommitmentTracking, meeting: meeting as Meeting, student: students };
    });
  }

  async setCommitmentStatus(id: string, status: CommitmentStatus) {
    const result = await this.db
      .from("commitment_tracking")
      .update({
        status,
        completed_at: status === "completed" ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("*")
      .single();
    return unwrap(result, "No se pudo actualizar el compromiso") as CommitmentTracking;
  }

  async appendAudit(input: AuditInput) {
    const result = await this.db
      .from("audit_logs")
      .insert({ ...input, metadata_json: input.metadata_json ?? {} })
      .select("*")
      .single();
    return unwrap(result, "No se pudo registrar la auditoría") as AuditLog;
  }

  async listAudit(meetingId: string) {
    const { data, error } = await this.db
      .from("audit_logs")
      .select("*")
      .eq("meeting_id", meetingId)
      .order("created_at");
    if (error) throw new Error(`No se pudo leer la auditoría: ${error.message}`);
    return (data ?? []) as AuditLog[];
  }

  async putDocumentFile(path: string, bytes: Uint8Array) {
  const expectedHash = sha256Hex(bytes);

  const { error } = await this.admin.storage
    .from(DOCUMENTS_BUCKET)
    .upload(path, bytes, {
      contentType: "application/pdf",
      upsert: false,
    });

  if (!error) {
    return path;
  }

  // Recuperar el archivo existente sin modificarlo.
  const existing = await this.getDocumentFile(path);

  if (existing) {
    const existingHash = sha256Hex(existing);

    if (existingHash === expectedHash) {
      return path;
    }

    throw new Error(
      "Conflicto de integridad: existe un PDF diferente en esta ruta."
    );
  }

  throw new Error(
    `No se pudo guardar el PDF: ${error.message}`
  );
}

  async getDocumentFile(path: string) {
    const { data, error } = await this.admin.storage.from(DOCUMENTS_BUCKET).download(path);
    if (error || !data) return null;
    return new Uint8Array(await data.arrayBuffer());
  }
}
