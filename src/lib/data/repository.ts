import type { Minutes } from "@/lib/schemas/minutes";
import type {
  AuditAction,
  AuditLog,
  DocumentKind,
  CommitmentStatus,
  CommitmentTracking,
  CommitmentWithContext,
  ConsentStatus,
  DocumentRecord,
  Institution,
  Meeting,
  MeetingDetail,
  MeetingParticipant,
  MeetingStatus,
  MinutesRecord,
  ParticipantType,
  Profile,
  Representative,
  Signature,
  Student,
  TranscriptSegment,
} from "@/lib/types";

export interface NewMeetingInput {
  institution_id: string;
  teacher_id: string;
  student_id: string;
  title: string;
  reason: string | null;
  scheduled_at: string | null;
  source: Meeting["source"];
  google_event_id?: string | null;
}

export interface ParticipantInput {
  participant_type: ParticipantType;
  participant_ref_id: string | null;
  display_name: string;
}

export interface NewSegmentInput {
  speaker_label: string;
  start_seconds: number;
  end_seconds: number;
  text: string;
  confidence: number | null;
  is_final: boolean;
}

export interface NewSignatureInput {
  minutes_id: string;
  signer_name: string;
  signer_role: ParticipantType;
  signature_path: string;
  acceptance_text_version: string;
}

/**
 * Firma completa de un acta. El registro de las firmas y la finalización de
 * la reunión forman una sola operación: o se aplican ambas, o ninguna.
 */
export interface SignMinutesInput {
  minutes_id: string;
  acceptance_text_version: string;
  signatures: {
    signer_name: string;
    signer_role: ParticipantType;
    signature_path: string;
  }[];
}

export interface SignMinutesResult {
  /** La reunión ya estaba firmada con exactamente este contenido. */
  already_signed: boolean;
  meeting_id: string;
  signatures: number;
}

/**
 * Rechazo controlado de una firma: el estado no permite firmar, falta una
 * firma obligatoria, o se repite la operación con contenido distinto.
 */
export class SigningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SigningError";
  }
}

export interface NewDocumentInput {
  minutes_id: string;
  meeting_id: string;
  storage_path: string;
  sha256: string;
  document_code: string;
  version: number;
  generation_fingerprint: string;
  kind: DocumentKind;
}

export interface AuditInput {
  institution_id: string;
  actor_id: string | null;
  meeting_id: string | null;
  action: AuditAction;
  metadata_json?: Record<string, unknown>;
}

export interface DocumentListItem {
  document: DocumentRecord;
  meeting: Meeting;
  student: Student;
}

/**
 * Contrato único de acceso a datos.
 * Existen dos implementaciones: `DemoRepository` (memoria, sin claves) y
 * `SupabaseRepository` (Postgres con RLS). El resto de la aplicación no debe
 * saber cuál está activa.
 */
export interface Repository {
  readonly kind: "demo" | "supabase";

  getInstitution(id: string): Promise<Institution | null>;
  getProfile(id: string): Promise<Profile | null>;

  listStudents(institutionId: string): Promise<Student[]>;
  getStudent(id: string): Promise<Student | null>;
  getRepresentativesForStudent(studentId: string): Promise<Representative[]>;

  listMeetings(teacherId: string): Promise<Meeting[]>;
  getMeeting(id: string): Promise<Meeting | null>;
  getMeetingDetail(id: string): Promise<MeetingDetail | null>;
  createMeeting(input: NewMeetingInput): Promise<Meeting>;
  updateMeeting(id: string, patch: Partial<Meeting>): Promise<Meeting>;
  findMeetingByGoogleEventId(institutionId: string, googleEventId: string): Promise<Meeting | null>;

  listParticipants(meetingId: string): Promise<MeetingParticipant[]>;
  replaceParticipants(meetingId: string, participants: ParticipantInput[]): Promise<MeetingParticipant[]>;
  setConsent(
    meetingId: string,
    decisions: { participant_id: string; consent_status: ConsentStatus }[],
    consentTextVersion: string,
  ): Promise<MeetingParticipant[]>;
  setSpeakerMapping(meetingId: string, mapping: Record<string, string | null>): Promise<MeetingParticipant[]>;

  listSegments(meetingId: string): Promise<TranscriptSegment[]>;
  replaceSegments(meetingId: string, segments: NewSegmentInput[]): Promise<TranscriptSegment[]>;

  getLatestMinutes(meetingId: string): Promise<MinutesRecord | null>;
  getMinutes(id: string): Promise<MinutesRecord | null>;
  createMinutes(input: {
    meeting_id: string;
    content: Minutes;
    generator: MinutesRecord["generator"];
    model: string | null;
  }): Promise<MinutesRecord>;
  updateMinutes(id: string, patch: Partial<MinutesRecord>): Promise<MinutesRecord>;

  listSignatures(minutesId: string): Promise<Signature[]>;
  addSignature(input: NewSignatureInput): Promise<Signature>;

  /**
   * Firma el acta y finaliza la reunión en una sola transacción. Es la única
   * vía admitida: la escritura directa sobre `signatures` está revocada en
   * Postgres para que no se pueda eludir.
   */
  signMinutes(input: SignMinutesInput): Promise<SignMinutesResult>;

  createDocument(input: NewDocumentInput): Promise<DocumentRecord>;
  /**
   * Documento ya generado para exactamente estos datos de entrada, si existe.
   * Es lo que evita fabricar un duplicado cuando nada ha cambiado.
   */
  findDocumentByFingerprint(
    minutesId: string,
    fingerprint: string,
  ): Promise<DocumentRecord | null>;
  /**
   * Compensación: deshace un registro recién creado cuando el archivo no se
   * pudo guardar, para no dejar una fila que apunte a un PDF inexistente.
   *
   * Exige la huella y solo alcanza a documentos sin enviar, de modo que no
   * pueda borrar un acta ya entregada ni un registro ajeno a esta generación.
   * Los documentos son evidencia: no hay borrado para el usuario, solo esta
   * reparación del servidor.
   */
  deleteOrphanDocument(id: string, fingerprint: string): Promise<void>;
  getDocument(id: string): Promise<DocumentRecord | null>;
  updateDocument(id: string, patch: Partial<DocumentRecord>): Promise<DocumentRecord>;
  listDocuments(institutionId: string, filters?: { studentId?: string }): Promise<DocumentListItem[]>;

  /**
   * Deriva los acuerdos y compromisos de un acta aprobada hacia el tablero de
   * seguimiento. Es idempotente: reemplaza lo derivado de esa misma acta.
   */
  syncCommitmentsFromMinutes(minutesId: string): Promise<CommitmentTracking[]>;
  listCommitments(institutionId: string, filters?: { studentId?: string }): Promise<CommitmentWithContext[]>;
  setCommitmentStatus(id: string, status: CommitmentStatus): Promise<CommitmentTracking>;

  appendAudit(input: AuditInput): Promise<AuditLog>;
  listAudit(meetingId: string): Promise<AuditLog[]>;

  /** Guarda el PDF en almacenamiento privado y devuelve la ruta interna. */
  putDocumentFile(path: string, bytes: Uint8Array): Promise<string>;
  /** Recupera el PDF para servirlo desde una ruta autenticada. */
  getDocumentFile(path: string): Promise<Uint8Array | null>;
}

export class NotFoundError extends Error {
  constructor(entity: string, id: string) {
    super(`No se encontró ${entity} con identificador ${id}.`);
    this.name = "NotFoundError";
  }
}

export function assertMeetingStatus(meeting: Meeting, allowed: MeetingStatus[]) {
  if (!allowed.includes(meeting.status)) {
    throw new Error(
      `La reunión está en estado "${meeting.status}" y esta acción requiere: ${allowed.join(", ")}.`,
    );
  }
}
