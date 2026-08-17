import { cn } from "@/lib/utils";

export interface RingSegment {
  label: string;
  value: number;
  color: string;
}

/**
 * Anillo de cumplimiento de acuerdos.
 * Muestra la proporción completada en el centro y el desglose al lado; no
 * inventa un porcentaje cuando todavía no hay compromisos registrados.
 */
export function ProgressRing({
  segments,
  caption = "Cumplimiento",
  size = 148,
  className,
}: {
  segments: RingSegment[];
  caption?: string;
  size?: number;
  className?: string;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const completed = segments[0]?.value ?? 0;
  const percentage = total === 0 ? 0 : Math.round((completed / total) * 100);

  const stroke = 14;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  let offset = 0;
  const arcs = segments.map((segment) => {
    const fraction = total === 0 ? 0 : segment.value / total;
    const arc = {
      ...segment,
      dash: fraction * circumference,
      gap: circumference - fraction * circumference,
      rotation: (offset / (total || 1)) * 360,
    };
    offset += segment.value;
    return arc;
  });

  return (
    <div className={cn("flex flex-wrap items-center gap-6", className)}>
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg
          viewBox={`0 0 ${size} ${size}`}
          className="-rotate-90"
          role="img"
          aria-label={`${percentage} por ciento de compromisos completados`}
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--color-surface-inset)"
            strokeWidth={stroke}
          />
          {total > 0
            ? arcs.map((arc) => (
                <circle
                  key={arc.label}
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  fill="none"
                  stroke={arc.color}
                  strokeWidth={stroke}
                  strokeLinecap="round"
                  strokeDasharray={`${arc.dash} ${arc.gap}`}
                  style={{
                    transform: `rotate(${arc.rotation}deg)`,
                    transformOrigin: "50% 50%",
                    transition: "stroke-dasharray 400ms ease",
                  }}
                />
              ))
            : null}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold tabular-nums text-ink">{total === 0 ? "—" : `${percentage}%`}</span>
          <span className="text-[0.68rem] uppercase tracking-wide text-ink-subtle">{caption}</span>
        </div>
      </div>

      <dl className="space-y-2 text-sm">
        {segments.map((segment) => (
          <div key={segment.label} className="flex items-center gap-3">
            <span aria-hidden className="size-2.5 rounded-full" style={{ background: segment.color }} />
            <dt className="text-ink-muted">{segment.label}</dt>
            <dd className="ml-auto font-semibold tabular-nums text-ink">{segment.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
