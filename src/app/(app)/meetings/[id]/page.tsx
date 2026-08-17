import type { Metadata } from "next";

import { ButtonLink } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { MeetingHeader } from "@/components/meeting-header";
import { AuditTrail } from "@/components/audit-trail";
import { loadMeeting } from "@/app/(app)/meetings/[id]/meeting-context";
import { formatDateTime } from "@/lib/utils";
import { MEETING_STEPS } from "@/components/meeting-steps";
import { hasReached } from "@/lib/meeting-state";

export const metadata: Metadata = { title: "Reunión" };

const CONSENT_LABEL = {
  pending: "Pendiente",
  granted: "Otorgado",
  declined: "Negado",
} as const;

export default async function MeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { session, detail } = await loadMeeting(id);
  const [audit, segments, minutes] = await Promise.all([
    session.repository.listAudit(id),
    session.repository.listSegments(id),
    session.repository.getLatestMinutes(id),
  ]);

  const nextStep =
    MEETING_STEPS.find((step) => !hasReached(detail.meeting.status, step.requires)) ??
    MEETING_STEPS[MEETING_STEPS.length - 1];
  const continueStep =
    MEETING_STEPS.filter((step) => hasReached(detail.meeting.status, step.requires)).at(-1) ??
    MEETING_STEPS[0];

  return (
    <div className="space-y-8">
      <MeetingHeader detail={detail} current="overview" />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>Ficha de la reunión</CardTitle>
            <ButtonLink href={continueStep.href(id)}>Continuar en «{continueStep.label}»</ButtonLink>
          </CardHeader>
          <CardBody className="space-y-6">
            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">Motivo</dt>
                <dd className="mt-1 text-sm leading-relaxed text-ink">{detail.meeting.reason ?? "No consta"}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">Institución</dt>
                <dd className="mt-1 text-sm text-ink">{detail.institution.name}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">Docente</dt>
                <dd className="mt-1 text-sm text-ink">{detail.teacher.full_name}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">Grabación</dt>
                <dd className="mt-1 text-sm text-ink">
                  {detail.meeting.started_at ? formatDateTime(detail.meeting.started_at) : "No iniciada"}
                </dd>
              </div>
            </dl>

            <section>
              <h3 className="text-sm font-semibold text-ink">Estudiante</h3>
              <p className="mt-1 text-sm text-ink-muted">
                {detail.student.full_name} · {detail.student.grade ?? "Sin grado"} {detail.student.section ?? ""} ·
                código {detail.student.external_id ?? "No consta"}
              </p>
            </section>

            <section>
              <h3 className="text-sm font-semibold text-ink">Representantes registrados</h3>
              {detail.representatives.length === 0 ? (
                <p className="mt-1 text-sm text-ink-muted">No consta</p>
              ) : (
                <ul className="mt-2 space-y-1 text-sm text-ink-muted">
                  {detail.representatives.map((representative) => (
                    <li key={representative.id}>
                      {representative.full_name} · {representative.email ?? "sin correo"}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h3 className="text-sm font-semibold text-ink">Participantes confirmados</h3>
              {detail.participants.length === 0 ? (
                <p className="mt-1 text-sm text-ink-muted">
                  Sin confirmar. Es el primer paso antes de registrar el consentimiento.
                </p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {detail.participants.map((participant) => (
                    <li key={participant.id} className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium text-ink">{participant.display_name}</span>
                      <Badge tone={participant.consent_status === "granted" ? "verified" : "review"}>
                        Consentimiento: {CONSENT_LABEL[participant.consent_status]}
                      </Badge>
                      {participant.speaker_label ? (
                        <Badge tone="info">{participant.speaker_label}</Badge>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </CardBody>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Estado del expediente</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3 text-sm">
              <p className="flex justify-between gap-3">
                <span className="text-ink-muted">Intervenciones transcritas</span>
                <span className="font-semibold text-ink">{segments.length}</span>
              </p>
              <p className="flex justify-between gap-3">
                <span className="text-ink-muted">Versión del acta</span>
                <span className="font-semibold text-ink">{minutes ? `v${minutes.version}` : "—"}</span>
              </p>
              <p className="flex justify-between gap-3">
                <span className="text-ink-muted">Siguiente paso</span>
                <span className="font-semibold text-ink">{nextStep.label}</span>
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Historial de auditoría</CardTitle>
            </CardHeader>
            <CardBody>
              <AuditTrail entries={audit} />
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
