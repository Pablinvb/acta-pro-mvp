import * as React from "react";

import { cn } from "@/lib/utils";

type Tone = "info" | "review" | "verified" | "danger";

const TONES: Record<Tone, string> = {
  info: "border-navy-100 bg-navy-50 text-navy-700",
  review: "border-review-600/25 bg-review-50 text-review-700",
  verified: "border-verified-600/25 bg-verified-50 text-verified-700",
  danger: "border-danger-600/25 bg-danger-50 text-danger-600",
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
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? <div className={cn(title && "mt-1", "leading-relaxed")}>{children}</div> : null}
    </div>
  );
}
