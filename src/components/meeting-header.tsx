import Link from "next/link";

import { StatusBadge } from "@/components/status-badge";
import { MeetingSteps } from "@/components/meeting-steps";
import { formatDateTime } from "@/lib/utils";
import type { MeetingDetail } from "@/lib/types";

export function MeetingHeader({ detail, current }: { detail: MeetingDetail; current: string }) {
  const { meeting, student } = detail;

  return (
    <header className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link href="/meetings" className="text-sm font-medium text-brand-400 hover:text-brand-300 hover:underline">
            ← Reuniones
          </Link>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-ink">{meeting.title}</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {student.full_name} · {student.grade ?? "Sin grado"} {student.section ?? ""} ·{" "}
            {formatDateTime(meeting.scheduled_at)}
          </p>
        </div>
        <StatusBadge status={meeting.status} />
      </div>

      <MeetingSteps meetingId={meeting.id} status={meeting.status} current={current} />
    </header>
  );
}
