import Link from "next/link";

import { cn } from "@/lib/utils";
import type { MeetingStatus } from "@/lib/types";
import { hasReached } from "@/lib/meeting-state";

interface Step {
  key: string;
  label: string;
  href: (id: string) => string;
  /** Estado mínimo de la reunión para poder abrir el paso. */
  requires: MeetingStatus;
}

export const MEETING_STEPS: Step[] = [
  { key: "participants", label: "Participantes", href: (id) => `/meetings/${id}/participants`, requires: "scheduled" },
  { key: "record", label: "Consentimiento y grabación", href: (id) => `/meetings/${id}/record`, requires: "ready" },
  { key: "speakers", label: "Hablantes", href: (id) => `/meetings/${id}/speakers`, requires: "processing" },
  { key: "minutes", label: "Acta", href: (id) => `/meetings/${id}/minutes`, requires: "draft" },
  { key: "sign", label: "Firmas y PDF", href: (id) => `/meetings/${id}/sign`, requires: "approved" },
];

export function MeetingSteps({
  meetingId,
  status,
  current,
}: {
  meetingId: string;
  status: MeetingStatus;
  current: string;
}) {
  return (
    <nav aria-label="Progreso de la reunión" className="overflow-x-auto">
      <ol className="flex min-w-max items-center gap-1">
        {MEETING_STEPS.map((step, index) => {
          const unlocked = hasReached(status, step.requires);
          const isCurrent = step.key === current;
          const content = (
            <span className="flex items-center gap-2">
              <span
                aria-hidden
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                  isCurrent
                    ? "border-navy-600 bg-navy-600 text-white"
                    : unlocked
                      ? "border-navy-100 bg-navy-50 text-navy-600"
                      : "border-line bg-canvas text-ink-subtle",
                )}
              >
                {index + 1}
              </span>
              {step.label}
            </span>
          );

          return (
            <li key={step.key} className="flex items-center gap-1">
              {unlocked ? (
                <Link
                  href={step.href(meetingId)}
                  aria-current={isCurrent ? "step" : undefined}
                  className={cn(
                    "rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors",
                    isCurrent ? "text-navy-600" : "text-ink-muted hover:bg-navy-50 hover:text-navy-600",
                  )}
                >
                  {content}
                </Link>
              ) : (
                <span className="px-2.5 py-1.5 text-sm font-medium text-ink-subtle" aria-disabled>
                  {content}
                </span>
              )}
              {index < MEETING_STEPS.length - 1 ? (
                <span aria-hidden className="h-px w-4 bg-line-strong" />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
