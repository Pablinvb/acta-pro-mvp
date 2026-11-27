import type { Minutes } from "@/lib/schemas/minutes";

export type UserRole = "teacher" | "admin";

export type MeetingStatus =
  | "scheduled"
  | "ready"
  | "recording"
  | "processing"
  | "draft"
  | "approved"
  | "signed"
  | "sent";

export type MeetingSource = "manual" | "mock_runachay" | "google_calendar";

export type ParticipantType = "teacher" | "representative" | "student" | "other";

export type ConsentStatus = "pending" | "granted" | "declined";

export type MinutesStatus = "draft" | "approved";

export type SpeakerLabel = string;

export interface Institution {
  id: string;
  name: string;
  address: string | null;
  created_at: string;
}

export interface Profile {
  id: string;
  full_name: string;
  email: string;
  role: UserRole;
  institution_id: string;
  created_at: string;
}

export interface Student {
  id: string;
  institution_id: string;
  external_id: string | null;
  full_name: string;
  grade: string | null;
  section: string | null;
  active: boolean;
}

export interface Representative {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
}

export interface StudentRepresentative {
  student_id: string;
  representative_id: string;
  relationship: string | null;
}

export interface Meeting {
  id: string;
  institution_id: string;
  teacher_id: string;
  student_id: string;
  title: string;
  reason: string | null;
  scheduled_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  status: MeetingStatus;
  source: MeetingSource;
  google_event_id: string | null;
  created_at: string;
}

export interface MeetingParticipant {
  id: string;
  meeting_id: string;
  participant_type: ParticipantType;
  participant_ref_id: string | null;
  display_name: string;
  speaker_label: SpeakerLabel | null;
  consent_status: ConsentStatus;
  consent_at: string | null;
  consent_text_version: string | null;
}

export interface TranscriptSegment {
  id: string;
  meeting_id: string;
  speaker_label: SpeakerLabel;
  start_seconds: number;
  end_seconds: number;
  text: string;
  confidence: number | null;
  is_final: boolean;
  created_at: string;
}

export interface MinutesRecord {
  id: string;
  meeting_id: string;
  version: number;
  status: MinutesStatus;
  content: Minutes;
  /** Ediciones humanas aplicadas sobre el borrador de la IA. */
  edited_content: Minutes | null;
  /** Índices de language_flags aceptados por el docente. */
  accepted_language_flags: number[];
  generated_at: string;
  approved_at: string | null;
  generator: "anthropic" | "demo";
  model: string | null;
}

export interface Signature {
  id: string;
  minutes_id: string;
  signer_name: string;
  signer_role: ParticipantType;
  /** Data URL PNG de la firma manuscrita digitalizada. */
  signature_path: string;
  signed_at: string;
  acceptance_text_version: string;
  /**
   * Sesión verificada que capturó la firma, de `auth.uid()`.
   *
   * No es necesariamente quien firma: en una reunión presencial, la firma del
   * representante se dibuja en el dispositivo de la docente. Lo que este campo
   * registra es quién operaba la sesión, que es un dato distinto y que antes se
   * perdía. Las firmas anteriores a la migración `20261127040000` lo tienen a
   * `null`, y eso es correcto: no se sabe.
   */
  signed_by: string | null;
  /** Cómo se verificó a quien firma. */
  verification_method: SignatureVerificationMethod;
}

/**
 * Formas de verificar a quien firma, de menos a más fuerte.
 *
 * Que el acta pueda declarar **cuál** se usó es más útil para una institución
 * que fingir que todas las firmas se verificaron igual.
 */
export type SignatureVerificationMethod =
  /** Capturada con la docente presente, sin verificar la identidad de quien firma. */
  | "presencial_atestiguada"
  /** La firma del personal docente, atada a su cuenta autenticada. */
  | "sesion_verificada"
  /** Verificada con un código de un solo uso. Reservado: todavía sin implementar. */
  | "codigo_correo";

export type DocumentKind = "preview" | "final";

export interface DocumentRecord {
  id: string;
  minutes_id: string;
  meeting_id: string;
  storage_path: string;
  sha256: string;
  document_code: string;
  version: number;
  /**
   * Huella de los datos que produjeron el PDF. No es el hash del archivo: los
   * bytes cambian en cada generacion porque el documento incrusta la fecha.
   * Null en los documentos anteriores a la idempotencia.
   */
  generation_fingerprint: string | null;
  /** `preview` sale de un borrador y lleva la banda BORRADOR. */
  kind: DocumentKind;
  sent_at: string | null;
  provider_message_id: string | null;
  created_at: string;
}

export type CommitmentStatus = "pending" | "in_progress" | "completed";

/**
 * Acuerdo o compromiso extraído de un acta aprobada, con su estado de avance.
 * Se crea al aprobar el acta y solo la persona docente cambia su estado: el
 * sistema no marca nada como cumplido por su cuenta.
 */
export interface CommitmentTracking {
  id: string;
  institution_id: string;
  meeting_id: string;
  minutes_id: string;
  kind: "agreement" | "commitment";
  item_index: number;
  description: string;
  responsible: string | null;
  due_date: string | null;
  status: CommitmentStatus;
  completed_at: string | null;
  updated_at: string;
  created_at: string;
}

export interface CommitmentWithContext {
  commitment: CommitmentTracking;
  meeting: Meeting;
  student: Student;
}

export type AuditAction =
  | "meeting.created"
  | "meeting.participants_confirmed"
  | "consent.recorded"
  | "recording.started"
  | "recording.stopped"
  | "transcription.saved"
  | "transcription.recovered"
  | "speakers.mapped"
  | "minutes.generated"
  | "minutes.edited"
  | "minutes.approved"
  | "commitment.status_changed"
  | "minutes.signed"
  | "document.generated"
  | "document.downloaded"
  | "document.sent"
  | "google.synced";

export interface AuditLog {
  id: string;
  institution_id: string;
  actor_id: string | null;
  meeting_id: string | null;
  action: AuditAction;
  metadata_json: Record<string, unknown>;
  created_at: string;
}

/** Vista compuesta usada por la interfaz para no encadenar consultas. */
export interface MeetingDetail {
  meeting: Meeting;
  student: Student;
  teacher: Profile;
  representatives: Representative[];
  participants: MeetingParticipant[];
  institution: Institution;
}
