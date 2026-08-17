import * as React from "react";

import { cn } from "@/lib/utils";

export type BadgeTone = "neutral" | "info" | "review" | "verified" | "danger" | "ai";

const TONES: Record<BadgeTone, string> = {
  neutral: "border-line-strong bg-surface-inset text-ink-muted",
  info: "border-brand-500/40 bg-brand-soft text-brand-300",
  review: "border-review-500/35 bg-review-soft text-review-400",
  verified: "border-verified-500/35 bg-verified-soft text-verified-400",
  danger: "border-danger-500/35 bg-danger-soft text-danger-400",
  ai: "border-brand-400/45 bg-brand-soft text-brand-300",
};

export function Badge({
  tone = "neutral",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold",
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}

/** Indicador rojo pulsante de grabación en curso. */
export function LiveBadge({ label = "EN VIVO" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-danger-500/40 bg-danger-soft px-2.5 py-0.5 text-xs font-bold tracking-wide text-danger-400">
      <span aria-hidden className="pulse-live size-2 rounded-full bg-danger-500" />
      {label}
    </span>
  );
}
