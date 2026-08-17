import Link from "next/link";

import { StatusBadge } from "@/components/status-badge";
import { CalendarIcon } from "@/components/icons";
import { formatDateTime } from "@/lib/utils";
import type { Meeting, Student } from "@/lib/types";

const SOURCE_LABEL: Record<Meeting["source"], string> = {
  manual: "Creada manualmente",
  mock_runachay: "Conector Runachay simulado",
  google_calendar: "Importada de Google Calendar",
};

export function MeetingCard({ meeting, student }: { meeting: Meeting; student: Student | undefined }) {
  return (
    <li>
      <Link
        href={`/meetings/${meeting.id}`}
        className="group block rounded-card border border-line bg-surface/70 px-5 py-4 transition-all hover:border-brand-500/50 hover:bg-surface-raised/70"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 gap-3">
            <span
              aria-hidden
              className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-300 transition-colors group-hover:bg-brand-500/25"
            >
              <CalendarIcon className="size-4.5" />
            </span>
            <div className="min-w-0">
              <p className="truncate font-semibold text-ink">{meeting.title}</p>
              <p className="mt-0.5 truncate text-sm text-ink-muted">
                {student
                  ? `${student.full_name} · ${student.grade ?? "Sin grado"} ${student.section ?? ""}`
                  : "Estudiante no disponible"}
              </p>
            </div>
          </div>
          <StatusBadge status={meeting.status} />
        </div>

        <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 pl-12 text-xs text-ink-subtle">
          <div className="flex gap-1.5">
            <dt>Fecha:</dt>
            <dd className="font-medium text-ink-muted">{formatDateTime(meeting.scheduled_at)}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt>Origen:</dt>
            <dd className="font-medium text-ink-muted">{SOURCE_LABEL[meeting.source]}</dd>
          </div>
        </dl>
      </Link>
    </li>
  );
}
