import type {
  Institution,
  Meeting,
  MeetingParticipant,
  Profile,
  Representative,
  Student,
  StudentRepresentative,
  TranscriptSegment,
} from "@/lib/types";

/**
 * Datos ficticios de demostración. Ninguna persona aquí es real.
 * Los mismos identificadores se usan en `supabase/seed.sql` para que el modo
 * demo y el modo con Supabase muestren exactamente el mismo escenario.
 */

export const DEMO_INSTITUTION_ID = "11111111-1111-4111-8111-111111111111";
export const DEMO_TEACHER_ID = "22222222-2222-4222-8222-222222222222";
export const DEMO_STUDENT_ID = "33333333-3333-4333-8333-333333333333";
export const DEMO_STUDENT_2_ID = "33333333-3333-4333-8333-333333333334";
export const DEMO_REPRESENTATIVE_ID = "44444444-4444-4444-8444-444444444444";
export const DEMO_REPRESENTATIVE_2_ID = "44444444-4444-4444-8444-444444444445";
export const DEMO_MEETING_ID = "55555555-5555-4555-8555-555555555555";
export const DEMO_MEETING_2_ID = "55555555-5555-4555-8555-555555555556";
export const DEMO_MEETING_3_ID = "55555555-5555-4555-8555-555555555557";

export const DEMO_TEACHER_EMAIL = "ana.perez@demo.actapro.ec";
export const DEMO_TEACHER_PASSWORD = "demo1234";

export const demoInstitution: Institution = {
  id: DEMO_INSTITUTION_ID,
  name: "Unidad Educativa Demostración ACTA PRO",
  address: "Av. Amazonas y Naciones Unidas, Quito, Ecuador",
  created_at: "2026-01-08T13:00:00.000Z",
};

export const demoTeacher: Profile = {
  id: DEMO_TEACHER_ID,
  full_name: "Ana Pérez",
  email: DEMO_TEACHER_EMAIL,
  role: "teacher",
  institution_id: DEMO_INSTITUTION_ID,
  created_at: "2026-01-08T13:00:00.000Z",
};

export const demoStudents: Student[] = [
  {
    id: DEMO_STUDENT_ID,
    institution_id: DEMO_INSTITUTION_ID,
    external_id: "DEMO-0001",
    full_name: "Juan Pérez López",
    grade: "5.º EGB",
    section: "A",
    active: true,
  },
  {
    id: DEMO_STUDENT_2_ID,
    institution_id: DEMO_INSTITUTION_ID,
    external_id: "DEMO-0002",
    full_name: "Sofía Andrade Vera",
    grade: "6.º EGB",
    section: "B",
    active: true,
  },
];

export const demoRepresentatives: Representative[] = [
  {
    id: DEMO_REPRESENTATIVE_ID,
    full_name: "María López",
    email: "maria.lopez@demo.actapro.ec",
    phone: "+593 99 000 0001",
  },
  {
    id: DEMO_REPRESENTATIVE_2_ID,
    full_name: "Carlos Andrade",
    email: "carlos.andrade@demo.actapro.ec",
    phone: "+593 99 000 0002",
  },
];

export const demoStudentRepresentatives: StudentRepresentative[] = [
  {
    student_id: DEMO_STUDENT_ID,
    representative_id: DEMO_REPRESENTATIVE_ID,
    relationship: "Madre",
  },
  {
    student_id: DEMO_STUDENT_2_ID,
    representative_id: DEMO_REPRESENTATIVE_2_ID,
    relationship: "Padre",
  },
];

export const demoMeetings: Meeting[] = [
  {
    id: DEMO_MEETING_ID,
    institution_id: DEMO_INSTITUTION_ID,
    teacher_id: DEMO_TEACHER_ID,
    student_id: DEMO_STUDENT_ID,
    title: "Seguimiento académico — Juan Pérez",
    reason: "Revisar el rendimiento en Matemáticas del segundo quimestre y acordar apoyos.",
    scheduled_at: "2026-08-18T15:00:00.000Z",
    started_at: null,
    ended_at: null,
    status: "scheduled",
    source: "manual",
    google_event_id: null,
    created_at: "2026-08-10T14:00:00.000Z",
  },
  {
    id: DEMO_MEETING_2_ID,
    institution_id: DEMO_INSTITUTION_ID,
    teacher_id: DEMO_TEACHER_ID,
    student_id: DEMO_STUDENT_2_ID,
    title: "Acompañamiento de convivencia — Sofía Andrade",
    reason: "Conversar sobre la integración al grupo tras el cambio de sección.",
    scheduled_at: "2026-08-20T14:30:00.000Z",
    started_at: null,
    ended_at: null,
    status: "scheduled",
    source: "mock_runachay",
    google_event_id: null,
    created_at: "2026-08-11T16:20:00.000Z",
  },
  {
    id: DEMO_MEETING_3_ID,
    institution_id: DEMO_INSTITUTION_ID,
    teacher_id: DEMO_TEACHER_ID,
    student_id: DEMO_STUDENT_ID,
    title: "Entrega de resultados del primer quimestre — Juan Pérez",
    reason: "Entrega de calificaciones y observaciones del primer quimestre.",
    scheduled_at: "2026-06-24T15:00:00.000Z",
    started_at: null,
    ended_at: null,
    status: "scheduled",
    source: "manual",
    google_event_id: null,
    created_at: "2026-06-18T13:00:00.000Z",
  },
];

export const demoParticipants: MeetingParticipant[] = [];

export const demoStudentRepresentativeMap = demoStudentRepresentatives;

/**
 * Transcripción de demostración: doce intervenciones, tres hablantes.
 * Contiene deliberadamente:
 * - un acuerdo con responsable y fecha (entrega de tareas),
 * - un acuerdo sin fecha (tutoría de refuerzo, horario aún no confirmado),
 * - una expresión subjetiva que la IA debe marcar ("bastante flojo"),
 * - un dato que no consta (la fecha de la tutoría).
 */
export interface DemoSegmentSeed {
  speaker_label: string;
  start_seconds: number;
  end_seconds: number;
  text: string;
  confidence: number;
}

export const DEMO_TRANSCRIPT: DemoSegmentSeed[] = [
  {
    speaker_label: "speaker_0",
    start_seconds: 0,
    end_seconds: 11.4,
    confidence: 0.97,
    text: "Buenos días, señora María, gracias por venir. Convoqué esta reunión para revisar el rendimiento de Juan en Matemáticas durante el segundo quimestre.",
  },
  {
    speaker_label: "speaker_1",
    start_seconds: 11.9,
    end_seconds: 19.2,
    confidence: 0.95,
    text: "Buenos días, licenciada. Sí, en casa lo hemos notado más callado cuando le hablamos de las tareas.",
  },
  {
    speaker_label: "speaker_0",
    start_seconds: 19.8,
    end_seconds: 34.6,
    confidence: 0.96,
    text: "En el registro tengo tres tareas de Matemáticas no entregadas en las últimas cuatro semanas, y en la evaluación del 5 de agosto obtuvo siete sobre diez. En Lengua y Literatura no hay novedad.",
  },
  {
    speaker_label: "speaker_2",
    start_seconds: 35.1,
    end_seconds: 45.0,
    confidence: 0.93,
    text: "Sí, no entregué dos de esas tareas. Nos quedamos sin internet en la casa como dos semanas y no las pude subir a la plataforma.",
  },
  {
    speaker_label: "speaker_1",
    start_seconds: 45.4,
    end_seconds: 53.8,
    confidence: 0.94,
    text: "Eso es cierto, tuvimos un problema con el servicio de internet. Se solucionó la semana pasada.",
  },
  {
    speaker_label: "speaker_0",
    start_seconds: 54.2,
    end_seconds: 65.7,
    confidence: 0.95,
    text: "Entiendo. De todas formas Juan es un chico bastante flojo cuando el tema le aburre, se distrae demasiado en clase.",
  },
  {
    speaker_label: "speaker_2",
    start_seconds: 66.0,
    end_seconds: 73.5,
    confidence: 0.92,
    text: "No es que no quiera, licenciada. Cuando no entiendo un ejercicio me trabo y ya no sigo.",
  },
  {
    speaker_label: "speaker_1",
    start_seconds: 74.0,
    end_seconds: 83.6,
    confidence: 0.95,
    text: "Yo puedo revisar cada noche en la plataforma que haya subido las tareas y avisarle a usted si algo falta.",
  },
  {
    speaker_label: "speaker_0",
    start_seconds: 84.1,
    end_seconds: 98.9,
    confidence: 0.96,
    text: "Perfecto. Entonces acordamos que la señora María revisa la plataforma cada noche, y que Juan entrega las tres tareas pendientes hasta el 21 de agosto.",
  },
  {
    speaker_label: "speaker_2",
    start_seconds: 99.3,
    end_seconds: 104.2,
    confidence: 0.94,
    text: "Está bien, las voy a entregar hasta esa fecha.",
  },
  {
    speaker_label: "speaker_0",
    start_seconds: 104.8,
    end_seconds: 118.5,
    confidence: 0.95,
    text: "También quiero abrirle un espacio de tutoría de refuerzo en Matemáticas. Todavía no tengo el horario del departamento, así que la fecha la confirmo después.",
  },
  {
    speaker_label: "speaker_1",
    start_seconds: 119.0,
    end_seconds: 127.4,
    confidence: 0.93,
    text: "De acuerdo, licenciada. Quedo pendiente de que me avise el horario para organizarme.",
  },
];

export const DEMO_TRANSCRIPT_DURATION_SECONDS = 127.4;

/** Etiquetas de hablante presentes en la transcripción de demostración. */
export const DEMO_SPEAKER_LABELS = [...new Set(DEMO_TRANSCRIPT.map((s) => s.speaker_label))];

export function buildDemoSegments(meetingId: string, createdAt = new Date().toISOString()): TranscriptSegment[] {
  return DEMO_TRANSCRIPT.map((seed, index) => ({
    id: `${meetingId}-seg-${String(index + 1).padStart(2, "0")}`,
    meeting_id: meetingId,
    speaker_label: seed.speaker_label,
    start_seconds: seed.start_seconds,
    end_seconds: seed.end_seconds,
    text: seed.text,
    confidence: seed.confidence,
    is_final: true,
    created_at: createdAt,
  }));
}
