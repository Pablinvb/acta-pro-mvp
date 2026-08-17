import type { Metadata } from "next";

import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { MeetingCard } from "@/components/meeting-card";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Reuniones" };

export default async function MeetingsPage() {
  const { repository, profile, institution } = await requireSession();
  const [meetings, students] = await Promise.all([
    repository.listMeetings(profile.id),
    repository.listStudents(institution.id),
  ]);
  const studentById = new Map(students.map((student) => [student.id, student]));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">Reuniones</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {meetings.length} {meetings.length === 1 ? "reunión registrada" : "reuniones registradas"}.
          </p>
        </div>
        <ButtonLink href="/meetings/new">Nueva reunión</ButtonLink>
      </header>

      {meetings.length === 0 ? (
        <EmptyState
          title="Sin reuniones registradas"
          description="Cree la primera reunión para iniciar el flujo de consentimiento, grabación y acta."
          action={<ButtonLink href="/meetings/new">Crear reunión</ButtonLink>}
        />
      ) : (
        <ul className="grid gap-3">
          {meetings.map((meeting) => (
            <MeetingCard key={meeting.id} meeting={meeting} student={studentById.get(meeting.student_id)} />
          ))}
        </ul>
      )}
    </div>
  );
}
