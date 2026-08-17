import { emptyMinutes, type Minutes } from "@/lib/schemas/minutes";
import type { TranscriptSegment } from "@/lib/types";
import { DEMO_TRANSCRIPT } from "@/lib/demo/seed-data";

/**
 * Generador determinístico del borrador de acta para el modo demostración.
 *
 * Solo devuelve el acta curada cuando la transcripción es efectivamente la de
 * demostración. Con cualquier otra transcripción produce un borrador honesto y
 * vacío que advierte que no hubo modelo de lenguaje disponible: el modo demo
 * nunca debe simular en silencio un análisis que no ocurrió.
 */

export function isDemoTranscript(segments: TranscriptSegment[]): boolean {
  if (segments.length !== DEMO_TRANSCRIPT.length) return false;
  return segments.every((segment, index) => segment.text === DEMO_TRANSCRIPT[index].text);
}

function speakerName(map: Record<string, string>, label: string, fallback: string) {
  return map[label] ?? fallback;
}

export function generateDemoMinutes(
  segments: TranscriptSegment[],
  speakerNames: Record<string, string> = {},
): Minutes {
  if (!isDemoTranscript(segments)) {
    return {
      ...emptyMinutes(),
      summary: "",
      review_warnings: [
        "Modo demostración sin clave de Anthropic: no se generó un análisis del contenido.",
        "Esta acta debe redactarse manualmente o configurarse ANTHROPIC_API_KEY para generar el borrador.",
      ],
    };
  }

  const id = (index: number) => segments[index].id;
  const teacher = speakerName(speakerNames, "speaker_0", "Hablante A");
  const representative = speakerName(speakerNames, "speaker_1", "Hablante B");
  const student = speakerName(speakerNames, "speaker_2", "Hablante C");

  return {
    summary:
      "Reunión de seguimiento académico sobre el desempeño en Matemáticas durante el segundo quimestre. Se revisaron tareas no entregadas y una evaluación, se expusieron dificultades de conectividad en el domicilio y se acordaron acciones de acompañamiento familiar y de refuerzo académico.",
    meeting_reason:
      "Revisar el rendimiento en Matemáticas del segundo quimestre y acordar medidas de acompañamiento.",
    topics: [
      {
        title: "Rendimiento en Matemáticas",
        description:
          "Se revisaron las tareas no entregadas y el resultado de la evaluación del segundo quimestre en Matemáticas.",
        source_segment_ids: [id(0), id(2)],
      },
      {
        title: "Dificultades de conectividad en el domicilio",
        description:
          "Se mencionó una interrupción del servicio de internet en el domicilio que afectó la entrega de tareas en la plataforma.",
        source_segment_ids: [id(3), id(4)],
      },
      {
        title: "Acompañamiento familiar y refuerzo académico",
        description:
          "Se conversó sobre el seguimiento de tareas desde el hogar y sobre la apertura de un espacio de tutoría de refuerzo.",
        source_segment_ids: [id(7), id(8), id(10)],
      },
    ],
    facts: [
      {
        statement:
          "Se registran tres tareas de Matemáticas no entregadas en las últimas cuatro semanas.",
        attributed_to: teacher,
        source_segment_ids: [id(2)],
      },
      {
        statement: "En la evaluación del 5 de agosto se obtuvo una calificación de siete sobre diez.",
        attributed_to: teacher,
        source_segment_ids: [id(2)],
      },
      {
        statement: "En la asignatura de Lengua y Literatura no se reportan novedades.",
        attributed_to: teacher,
        source_segment_ids: [id(2)],
      },
      {
        statement:
          "Dos de las tareas no se subieron a la plataforma por una interrupción del servicio de internet en el domicilio de aproximadamente dos semanas.",
        attributed_to: student,
        source_segment_ids: [id(3)],
      },
      {
        statement: "El servicio de internet del domicilio quedó restablecido la semana anterior a la reunión.",
        attributed_to: representative,
        source_segment_ids: [id(4)],
      },
    ],
    agreements: [
      {
        description:
          "Revisar cada noche en la plataforma que las tareas hayan sido subidas y comunicar a la docente si falta alguna.",
        responsible: representative,
        due_date: null,
        source_segment_ids: [id(7), id(8)],
      },
      {
        description: "Entregar las tres tareas de Matemáticas pendientes.",
        responsible: student,
        due_date: "2026-08-21",
        source_segment_ids: [id(8), id(9)],
      },
      {
        description:
          "Abrir un espacio de tutoría de refuerzo en Matemáticas. La fecha y el horario no constan en la reunión.",
        responsible: teacher,
        due_date: null,
        source_segment_ids: [id(10)],
      },
    ],
    commitments: [
      {
        description: "Confirmar el horario de la tutoría de refuerzo una vez que el departamento lo asigne.",
        responsible: teacher,
        due_date: null,
        source_segment_ids: [id(10), id(11)],
      },
    ],
    follow_up: [
      {
        action:
          "Verificar la entrega de las tres tareas pendientes y coordinar el inicio de la tutoría de refuerzo.",
        date: null,
        source_segment_ids: [id(8), id(10)],
      },
    ],
    pending_items: [
      "Fecha y horario de la tutoría de refuerzo en Matemáticas: no consta en la reunión.",
      "Medio por el cual se comunicará el horario confirmado: no consta en la reunión.",
    ],
    contradictions: [
      "Sobre la causa de la baja entrega de tareas existen dos versiones no resueltas en la reunión: la docente la relaciona con desinterés y distracción en clase, mientras que el estudiante la relaciona con dificultad para continuar cuando no comprende un ejercicio.",
    ],
    language_flags: [
      {
        original_fragment: "Juan es un chico bastante flojo cuando el tema le aburre, se distrae demasiado en clase.",
        reason:
          "Califica a la persona y atribuye una intención en lugar de describir una conducta observable. No corresponde a un hecho verificable en la reunión.",
        objective_suggestion:
          "Se observa disminución de la participación y de la entrega de tareas en Matemáticas durante las últimas cuatro semanas.",
        source_segment_ids: [id(5)],
      },
    ],
    review_warnings: [
      "Borrador generado en modo demostración con datos ficticios y sin modelo de lenguaje.",
      "La fecha de la tutoría de refuerzo no consta en la conversación y quedó como pendiente.",
      "Revise la atribución de cada hecho antes de aprobar el acta.",
    ],
  };
}
