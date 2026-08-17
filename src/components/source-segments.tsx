import { formatClock } from "@/lib/utils";

export interface SourceSegment {
  id: string;
  speaker: string;
  displayName: string;
  start: number;
  text: string;
  color?: string;
}

/**
 * Muestra los segmentos que respaldan una entrada del acta.
 * La transcripción se cita literalmente y nunca se edita desde aquí.
 */
export function SourceSegments({
  ids,
  segments,
}: {
  ids: string[];
  segments: Map<string, SourceSegment>;
}) {
  const found = ids.map((id) => segments.get(id)).filter((segment): segment is SourceSegment => Boolean(segment));
  const missing = ids.length - found.length;

  if (ids.length === 0) {
    return <p className="text-xs font-medium text-review-400">Sin segmento de origen: verifique antes de aprobar.</p>;
  }

  return (
    <details className="group">
      <summary className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg text-xs font-medium text-brand-400 hover:text-brand-300">
        <span aria-hidden className="transition-transform group-open:rotate-90">
          ›
        </span>
        Ver origen en la transcripción ({found.length})
      </summary>
      <div className="mt-2 space-y-2.5 border-l-2 border-brand-500/35 pl-3">
        {found.map((segment) => (
          <blockquote key={segment.id} className="text-xs leading-relaxed text-ink-muted">
            <span className="flex items-center gap-1.5 font-semibold" style={{ color: segment.color ?? "var(--color-brand-300)" }}>
              <span aria-hidden className="size-1.5 rounded-full bg-current" />
              {segment.displayName} · {formatClock(segment.start)}
            </span>
            <p className="mt-0.5 italic">“{segment.text}”</p>
          </blockquote>
        ))}
        {missing > 0 ? (
          <p className="text-xs font-medium text-review-400">
            {missing} referencia(s) no corresponden a ningún segmento guardado.
          </p>
        ) : null}
      </div>
    </details>
  );
}
