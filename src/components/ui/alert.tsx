import * as React from "react";

import { cn } from "@/lib/utils";

type Tone = "info" | "review" | "verified" | "danger";

const TONES: Record<Tone, string> = {
  info: "border-brand-500/35 bg-brand-soft/70 text-brand-300",
  review: "border-review-500/30 bg-review-soft/80 text-review-400",
  verified: "border-verified-500/30 bg-verified-soft/80 text-verified-400",
  danger: "border-danger-500/35 bg-danger-soft/80 text-danger-400",
};

export function Alert({
  tone = "info",
  title,
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { tone?: Tone; title?: string }) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn("rounded-card border px-4 py-3 text-sm", TONES[tone], className)}
      {...props}
    >
      {title ? <p className="font-semibold text-ink">{title}</p> : null}
      {children ? <div className={cn(title && "mt-1", "leading-relaxed")}>{children}</div> : null}
    </div>
  );
}
