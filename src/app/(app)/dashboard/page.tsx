import type { Metadata } from "next";

import { ButtonLink } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { MeetingCard } from "@/components/meeting-card";
import { requireSession } from "@/lib/session";
import { formatDateTime, shortHash } from "@/lib/utils";
import { hasReached } from "@/lib/meeting-state";

export const metadata: Metadata = { title: "Inicio" };

export default async function DashboardPage() {
  const session = await requireSession();
  const { repository, profile, institution } = session;

  const [meetings, students, documents] = await Promise.all([
    repository.listMeetings(profile.id),
    repository.listStudents(institution.id),
    repository.listDocuments(institution.id),
  ]);

  const studentById = new Map(students.map((student) => [student.id, student]));
  const upcoming = meetings.filter((meeting) => !hasReached(meeting.status, "draft")).slice(0, 5);
  const inProgress = meetings.filter(
    (meeting) => hasReached(meeting.status, "draft") && meeting.status !== "sent",
  );

  return (
    <div className="space-y-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-ink-muted">Hola, {profile.full_name.split(" ")[0]}</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink">Sus reuniones y actas</h1>
        </div>
        <ButtonLink href="/meetings/new">Nueva reunión</ButtonLink>
      </header>

      <section aria-labelledby="proximas" className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 id="proximas" className="text-lg font-semibold text-ink">
            Reuniones próximas
          </h2>
          <ButtonLink href="/meetings" variant="ghost" size="sm">
            Ver todas
          </ButtonLink>
        </div>

        {upcoming.length === 0 ? (
          <EmptyState
            title="No hay reuniones pendientes de grabar"
            description="Cree una reunión manualmente o importe una desde Google Calendar para iniciar el flujo de acta."
            action={<ButtonLink href="/meetings/new">Crear reunión</ButtonLink>}
          />
        ) : (
          <ul className="grid gap-3">
            {upcoming.map((meeting) => (
              <MeetingCard key={meeting.id} meeting={meeting} student={studentById.get(meeting.student_id)} />
            ))}
          </ul>
        )}
      </section>

      {inProgress.length > 0 ? (
        <section aria-labelledby="en-curso" className="space-y-4">
          <h2 id="en-curso" className="text-lg font-semibold text-ink">
            Actas en proceso
          </h2>
          <ul className="grid gap-3">
            {inProgress.map((meeting) => (
              <MeetingCard key={meeting.id} meeting={meeting} student={studentById.get(meeting.student_id)} />
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="recientes" className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 id="recientes" className="text-lg font-semibold text-ink">
            Actas recientes
          </h2>
          <ButtonLink href="/repository" variant="ghost" size="sm">
            Abrir repositorio
          </ButtonLink>
        </div>

        {documents.length === 0 ? (
          <EmptyState
            title="Todavía no hay actas generadas"
            description="Cuando complete una reunión y genere el PDF, el documento aparecerá aquí con su código, su versión y su huella SHA-256."
          />
        ) : (
          <ul className="grid gap-3">
            {documents.slice(0, 5).map(({ document, meeting, student }) => (
              <li
                key={document.id}
                className="rounded-card border border-line bg-surface px-5 py-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-ink">{meeting.title}</p>
                    <p className="mt-1 text-sm text-ink-muted">{student.full_name}</p>
                  </div>
                  <Badge tone="verified">{document.document_code}</Badge>
                </div>
                <p className="mt-3 font-mono text-xs text-ink-subtle">
                  SHA-256 {shortHash(document.sha256)} · v{document.version} ·{" "}
                  {formatDateTime(document.created_at)}
                </p>
                <ButtonLink
                  href={`/repository/${document.id}`}
                  variant="secondary"
                  size="sm"
                  className="mt-3"
                >
                  Ver documento
                </ButtonLink>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
