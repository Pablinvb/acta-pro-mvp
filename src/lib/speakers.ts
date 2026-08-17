/**
 * Paleta por hablante. Vive fuera de los componentes de cliente para que
 * también pueda usarse desde el servidor al preparar los datos de una página.
 */
export const SPEAKER_COLORS = [
  "var(--color-speaker-1)",
  "var(--color-speaker-2)",
  "var(--color-speaker-3)",
  "var(--color-speaker-4)",
];

/** Color estable de una voz según su posición en el orden de aparición. */
export function speakerColor(label: string, order: string[]) {
  const index = order.indexOf(label);
  return SPEAKER_COLORS[(index < 0 ? 0 : index) % SPEAKER_COLORS.length];
}
