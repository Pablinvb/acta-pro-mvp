import { cn } from "@/lib/utils";

/**
 * Marca de ACTA PRO: escudo institucional con columnas.
 * El escudo comunica resguardo y la fachada con columnas, institución
 * educativa. Se dibuja en SVG para que escale sin pérdida en cualquier tamaño.
 */
export function ActaProMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 44" role="img" aria-label="ACTA PRO" className={cn("size-9", className)}>
      <defs>
        <linearGradient id="acta-shield" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7fcbf2" />
          <stop offset="100%" stopColor="#1657c2" />
        </linearGradient>
      </defs>
      <path
        d="M20 1.5 37 7.4v14.2c0 9.5-6.6 17.6-17 21-10.4-3.4-17-11.5-17-21V7.4z"
        fill="rgba(16,32,63,0.9)"
        stroke="url(#acta-shield)"
        strokeWidth="2"
      />
      {/* Frontón y columnas */}
      <path d="M11 17h18l-9-6z" fill="#7cb0ff" />
      <rect x="11" y="19" width="18" height="1.8" rx="0.9" fill="#4d93ff" />
      <rect x="13" y="22" width="2.4" height="8" rx="1.2" fill="#7cb0ff" />
      <rect x="18.8" y="22" width="2.4" height="8" rx="1.2" fill="#7cb0ff" />
      <rect x="24.6" y="22" width="2.4" height="8" rx="1.2" fill="#7cb0ff" />
      <rect x="11" y="31" width="18" height="2" rx="1" fill="#4d93ff" />
    </svg>
  );
}

export function ActaProWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("text-lg font-extrabold tracking-tight", className)}>
      <span className="text-ink">ACTA</span> <span className="brand-gradient-text">PRO</span>
    </span>
  );
}

export function ActaProLogo({ className, markClassName }: { className?: string; markClassName?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <ActaProMark className={markClassName} />
      <ActaProWordmark />
    </span>
  );
}
