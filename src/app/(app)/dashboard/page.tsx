import type { Metadata } from "next";

import { ButtonLink } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { MeetingCard } from "@/components/meeting-card";
import { ProgressRing } from "@/components/progress-ring";
import { CalendarIcon, DocumentIcon, ShieldCheckIcon, TrackingIcon } from "@/components/icons";
import { requireSession } from "@/lib/session";
import { formatDateTime, shortHash } from "@/lib/utils";
import { hasReached } from "@/lib/meeting-state";

export const metadata: Metadata = { title: "Dashboard" };

function StatTile({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-card border border-line bg-surface/70 px-4 py-4">
      <span
        aria-hidden
        className="flex size-9 items-center justify-center rounded-xl bg-brand-soft text-brand-300"
      >
        {icon}
      </span>
      <p className="mt-3 text-2xl font-bold tabular-nums text-ink">{value}</p>
      <p className="text-sm font-medium text-ink-muted">{label}</p>
      <p className="mt-1 text-xs leading-relaxed text-ink-subtle">{hint}</p>
    </div>
  );
}

export default async function DashboardPage() {
  const session = await requireSession();
  const { repository, profile, institution } = session;

  const [meetings, students, documents, commitments] = await Promise.all([
    repository.listMeetings(profile.id),
    repository.listStudents(institution.id),
    repository.listDocuments(institution.id),
    repository.listCommitments(institution.id),
  ]);

  const studentById = new Map(students.map((student) => [student.id, student]));
  const upcoming = meetings.filter((meeting) => !hasReached(meeting.status, "draft"));
  const inProgress = meetings.filter(
    (meeting) => hasReached(meeting.status, "draft") && meeting.status !== "sent",
  );

  const completed = commitments.filter((item) => item.commitment.status === "completed").length;
  const running = commitments.filter((item) => item.commitment.status === "in_progress").length;
  const pendingCount = commitments.filter((item) => item.commitment.status === "pending").length;

  return (
    <div className="space-y-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-ink-muted">Hola, {profile.full_name.split(" ")[0]}</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-ink">
            De una reunión a una <span className="text-brand-400">evidencia institucional</span>
          </h1>
        </div>
        <ButtonLink href="/meetings/new" size="lg">
          Nueva reunión
        </ButtonLink>
      </header>

      <section aria-label="Resumen" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          icon={<CalendarIcon className="size-4.5" />}
          label="Reuniones por procesar"
          value={String(upcoming.length)}
          hint="Pendientes de grabar o de generar su acta."
        />
        <StatTile
          icon={<DocumentIcon className="size-4.5" />}
          label="Actas archivadas"
          value={String(documents.length)}
          hint="Con código, versión y huella SHA-256."
        />
        <StatTile
          icon={<TrackingIcon className="size-4.5" />}
          label="Compromisos en seguimiento"
          value={String(commitments.length)}
          hint="Tomados de actas aprobadas, no del borrador."
        />
        <StatTile
          icon={<ShieldCheckIcon className="size-4.5" />}
          label="Actas firmadas"
          value={String(meetings.filter((meeting) => hasReached(meeting.status, "signed")).length)}
          hint="Con firmas registradas y PDF generado."
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <section aria-labelledby="proximas" className="space-y-4 lg:col-span-2">
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
              description="Cree una reunión manualmente o impórtela desde Google Calendar para iniciar el flujo de acta."
              action={<ButtonLink href="/meetings/new">Crear reunión</ButtonLink>}
            />
          ) : (
            <ul className="grid gap-3">
              {upcoming.slice(0, 5).map((meeting) => (
                <MeetingCard key={meeting.id} meeting={meeting} student={studentById.get(meeting.student_id)} />
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="cumplimiento" className="space-y-4">
          <h2 id="cumplimiento" className="text-lg font-semibold text-ink">
            Seguimiento de acuerdos
          </h2>
          <Card>
            <CardBody>
              {commitments.length === 0 ? (
                <p className="text-sm leading-relaxed text-ink-muted">
                  Los acuerdos aparecen aquí en cuanto apruebe un acta. No se calcula un porcentaje mientras no
                  haya compromisos registrados.
                </p>
              ) : (
                <ProgressRing
                  size={124}
                  segments={[
                    { label: "Completados", value: completed, color: "var(--color-verified-500)" },
                    { label: "En progreso", value: running, color: "var(--color-brand-500)" },
                    { label: "Pendientes", value: pendingCount, color: "var(--color-line-strong)" },
                  ]}
                />
              )}
              <ButtonLink href="/seguimiento" variant="secondary" size="sm" className="mt-4">
                Abrir seguimiento
              </ButtonLink>
            </CardBody>
          </Card>
        </section>
      </div>

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
          <ul className="grid gap-3 md:grid-cols-2">
            {documents.slice(0, 4).map(({ document, meeting, student }) => (
              <li key={document.id}>
                <Card>
                  <CardHeader className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle className="truncate">{meeting.title}</CardTitle>
                      <p className="mt-1 text-sm text-ink-muted">{student.full_name}</p>
                    </div>
                    <Badge tone="verified">
                      <ShieldCheckIcon className="size-3.5" />
                      {document.document_code}
                    </Badge>
                  </CardHeader>
                  <CardBody>
                    <p className="font-mono text-xs text-ink-subtle">
                      SHA-256 {shortHash(document.sha256)} · v{document.version} ·{" "}
                      {formatDateTime(document.created_at)}
                    </p>
                    <ButtonLink href={`/repository/${document.id}`} variant="secondary" size="sm" className="mt-3">
                      Ver documento
                    </ButtonLink>
                  </CardBody>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
