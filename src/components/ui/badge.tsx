import * as React from "react";

import { cn } from "@/lib/utils";

export type BadgeTone = "neutral" | "info" | "review" | "verified" | "danger" | "ai";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-canvas text-ink-muted border-line-strong",
  info: "bg-navy-50 text-navy-600 border-navy-100",
  review: "bg-review-50 text-review-700 border-review-600/25",
  verified: "bg-verified-50 text-verified-700 border-verified-600/25",
  danger: "bg-danger-50 text-danger-600 border-danger-600/25",
  ai: "bg-violet-50 text-violet-600 border-violet-100",
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
