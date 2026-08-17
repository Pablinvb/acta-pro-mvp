/**
 * Normalización de resultados de Deepgram a un único esquema de segmentos.
 * Se usa tanto en el navegador (streaming) como en el servidor (pregrabado),
 * de modo que ambas rutas produzcan exactamente la misma estructura.
 */

export interface DeepgramWord {
  word: string;
  punctuated_word?: string;
  start: number;
  end: number;
  speaker?: number;
  confidence?: number;
}

export interface NormalizedSegment {
  id: string;
  speaker: string;
  start: number;
  end: number;
  text: string;
  confidence: number | null;
  isFinal: true;
}

export function speakerLabel(speaker: number | undefined): string {
  return `speaker_${speaker ?? 0}`;
}

/**
 * Agrupa palabras consecutivas del mismo hablante en una sola intervención.
 * Conserva hablante, inicio, fin y texto; no reescribe ni corrige el texto.
 */
export function groupWordsBySpeaker(words: DeepgramWord[], idPrefix = "seg"): NormalizedSegment[] {
  const segments: NormalizedSegment[] = [];

  for (const word of words) {
    const label = speakerLabel(word.speaker);
    const text = (word.punctuated_word ?? word.word ?? "").trim();
    if (text === "") continue;

    const current = segments.at(-1);
    if (current && current.speaker === label) {
      current.text = `${current.text} ${text}`;
      current.end = word.end;
      current.confidence =
        current.confidence === null || word.confidence === undefined
          ? current.confidence
          : Math.min(current.confidence, word.confidence);
      continue;
    }

    segments.push({
      id: `${idPrefix}-${segments.length + 1}`,
      speaker: label,
      start: word.start,
      end: word.end,
      text,
      confidence: word.confidence ?? null,
      isFinal: true,
    });
  }

  return segments;
}

/** Clave de deduplicación por hablante y rango temporal. */
export function segmentKey(segment: { speaker: string; start: number; end: number }) {
  return `${segment.speaker}:${segment.start.toFixed(2)}:${segment.end.toFixed(2)}`;
}

/**
 * Reconcilia segmentos ya guardados con los recuperados del audio completo.
 * Se conservan los existentes y solo se añaden los que no solapan en tiempo
 * con ninguno previo del mismo hablante, para no duplicar contenido.
 */
export function reconcileSegments(
  existing: NormalizedSegment[],
  recovered: NormalizedSegment[],
): NormalizedSegment[] {
  const overlaps = (a: NormalizedSegment, b: NormalizedSegment) =>
    a.speaker === b.speaker && a.start < b.end && b.start < a.end;

  const merged = [...existing];
  for (const candidate of recovered) {
    if (merged.some((segment) => overlaps(segment, candidate))) continue;
    merged.push(candidate);
  }

  return merged
    .sort((a, b) => a.start - b.start)
    .map((segment, index) => ({ ...segment, id: `seg-${index + 1}` }));
}
