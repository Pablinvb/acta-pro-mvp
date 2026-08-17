import { describe, expect, it } from "vitest";

import {
  groupWordsBySpeaker,
  reconcileSegments,
  segmentKey,
  speakerLabel,
  type NormalizedSegment,
} from "@/lib/deepgram/segments";

const word = (text: string, start: number, end: number, speaker?: number, confidence = 0.9) => ({
  word: text.toLowerCase(),
  punctuated_word: text,
  start,
  end,
  speaker,
  confidence,
});

describe("groupWordsBySpeaker", () => {
  it("agrupa palabras consecutivas del mismo hablante", () => {
    const segments = groupWordsBySpeaker([
      word("Buenos", 0, 0.4, 0),
      word("días.", 0.4, 0.9, 0),
      word("Gracias", 1.0, 1.5, 1),
    ]);

    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ speaker: "speaker_0", text: "Buenos días.", start: 0, end: 0.9 });
    expect(segments[1]).toMatchObject({ speaker: "speaker_1", text: "Gracias" });
  });

  it("conserva la confianza mínima del grupo", () => {
    const [segment] = groupWordsBySpeaker([word("Hola", 0, 0.3, 0, 0.95), word("mundo", 0.3, 0.6, 0, 0.62)]);
    expect(segment.confidence).toBeCloseTo(0.62);
  });

  it("trata la ausencia de hablante como speaker_0", () => {
    expect(speakerLabel(undefined)).toBe("speaker_0");
    const [segment] = groupWordsBySpeaker([word("Hola", 0, 0.3)]);
    expect(segment.speaker).toBe("speaker_0");
  });

  it("ignora palabras vacías", () => {
    expect(groupWordsBySpeaker([{ word: "", start: 0, end: 0.1, speaker: 0 }])).toHaveLength(0);
  });
});

describe("segmentKey", () => {
  it("distingue por hablante y rango temporal", () => {
    expect(segmentKey({ speaker: "speaker_0", start: 1.004, end: 2 })).toBe("speaker_0:1.00:2.00");
    expect(segmentKey({ speaker: "speaker_1", start: 1, end: 2 })).not.toBe(
      segmentKey({ speaker: "speaker_0", start: 1, end: 2 }),
    );
  });
});

describe("reconcileSegments", () => {
  const make = (speaker: string, start: number, end: number, text: string): NormalizedSegment => ({
    id: `x-${start}`,
    speaker,
    start,
    end,
    text,
    confidence: 0.9,
    isFinal: true,
  });

  it("no duplica contenido que solapa en tiempo con el mismo hablante", () => {
    const existing = [make("speaker_0", 0, 5, "Buenos días")];
    const recovered = [make("speaker_0", 0.1, 4.8, "Buenos días"), make("speaker_1", 6, 9, "Gracias")];

    const merged = reconcileSegments(existing, recovered);

    expect(merged).toHaveLength(2);
    expect(merged.map((segment) => segment.text)).toEqual(["Buenos días", "Gracias"]);
  });

  it("conserva intervenciones simultáneas de hablantes distintos", () => {
    const merged = reconcileSegments([make("speaker_0", 0, 5, "A")], [make("speaker_1", 1, 4, "B")]);
    expect(merged).toHaveLength(2);
  });

  it("reordena por tiempo y renumera los identificadores", () => {
    const merged = reconcileSegments([make("speaker_0", 10, 12, "Tarde")], [make("speaker_1", 1, 3, "Temprano")]);
    expect(merged.map((segment) => segment.id)).toEqual(["seg-1", "seg-2"]);
    expect(merged[0].text).toBe("Temprano");
  });
});
