import Link from "next/link";

import { StatusBadge } from "@/components/status-badge";
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
        className="block rounded-card border border-line bg-surface px-5 py-4 transition-colors hover:border-navy-100 hover:bg-navy-50/40"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-semibold text-ink">{meeting.title}</p>
            <p className="mt-1 text-sm text-ink-muted">
              {student ? `${student.full_name} · ${student.grade ?? "Sin grado"} ${student.section ?? ""}` : "Estudiante no disponible"}
            </p>
          </div>
          <StatusBadge status={meeting.status} />
        </div>
        <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-ink-subtle">
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
