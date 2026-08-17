import type { MeetingDetail, TranscriptSegment } from "@/lib/types";
import { formatClock } from "@/lib/utils";

/** Reglas de redacción objetiva. No contiene datos de ninguna reunión. */
export const MINUTES_SYSTEM_PROMPT = `Eres el motor de redacción objetiva de ACTA PRO, una herramienta de apoyo para reuniones escolares en Ecuador.

Tu tarea es convertir una transcripción diarizada en un BORRADOR DE ACTA. No produces una decisión legal ni un documento final. El docente debe revisar y aprobar todo.

REGLAS INNEGOCIABLES:
1. Usa exclusivamente información presente en los metadatos y en la transcripción.
2. No inventes nombres, fechas, responsables, causas, diagnósticos, evidencias ni acuerdos.
3. Si un dato no consta, usa null y agrega una advertencia de revisión en review_warnings.
4. Distingue hechos mencionados, opiniones, solicitudes, acuerdos y compromisos.
5. Conserva un lenguaje neutral, profesional y no acusatorio.
6. Nunca alteres el texto de la transcripción original.
7. Cada topic, fact, agreement, commitment, follow_up y language_flag debe incluir source_segment_ids con identificadores que aparezcan literalmente en la transcripción numerada.
8. Si dos intervenciones se contradicen, registra la discrepancia en contradictions sin decidir quién tiene razón.
9. No presentes una sugerencia de lenguaje como si hubiera sido dicha en la reunión: language_flags describe cómo podría reformularse, no lo que se dijo.
10. No diagnostiques al estudiante, no juzgues, no acuses y no atribuyas intenciones.
11. Las fechas se expresan en formato YYYY-MM-DD. Si una fecha se menciona sin año, usa el año de la reunión indicado en los metadatos; si sigue siendo ambigua, usa null.
12. Escribe en español de Ecuador, en tercera persona y en tono institucional.

Marca en language_flags cualquier expresión que califique a una persona, atribuya intenciones o convierta una opinión en un hecho, y propón una alternativa observable y verificable.`;

/**
 * Construye el mensaje de usuario.
 * Los datos personales viajan solo aquí, nunca en el esquema de salida.
 */
export function buildMinutesUserMessage(
  detail: MeetingDetail,
  segments: TranscriptSegment[],
  speakerNames: Record<string, string>,
): string {
  const meetingDate = detail.meeting.scheduled_at ?? detail.meeting.created_at;
  const year = new Date(meetingDate).getUTCFullYear();

  const participants = detail.participants
    .map((participant) => {
      const speaker = participant.speaker_label ? ` (${participant.speaker_label})` : "";
      return `- ${participant.display_name} — ${participant.participant_type}${speaker}`;
    })
    .join("\n");

  const transcript = segments
    .map((segment) => {
      const who = speakerNames[segment.speaker_label] ?? segment.speaker_label;
      return `[${segment.id}] (${formatClock(segment.start_seconds)}) ${who}: ${segment.text}`;
    })
    .join("\n");

  return `METADATOS DE LA REUNIÓN
Título: ${detail.meeting.title}
Motivo declarado al convocar: ${detail.meeting.reason ?? "No consta"}
Fecha de la reunión: ${meetingDate}
Año de referencia para fechas relativas: ${year}
Institución: ${detail.institution.name}
Estudiante: ${detail.student.full_name} — ${detail.student.grade ?? "grado no consta"} ${detail.student.section ?? ""}

PARTICIPANTES
${participants || "- No consta"}

TRANSCRIPCIÓN NUMERADA
Cada línea empieza con el identificador del segmento entre corchetes. Usa esos identificadores exactos en source_segment_ids.

${transcript}

Genera el borrador del acta conforme al esquema solicitado.`;
}
