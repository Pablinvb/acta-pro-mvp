import type { Metadata } from "next";

import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { CommitmentLegend, FollowUpBoard } from "@/components/follow-up-board";
import { ProgressRing } from "@/components/progress-ring";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Seguimiento" };

export default async function FollowUpPage() {
  const { repository, institution } = await requireSession();
  const items = await repository.listCommitments(institution.id);

  const completed = items.filter((item) => item.commitment.status === "completed").length;
  const inProgress = items.filter((item) => item.commitment.status === "in_progress").length;
  const pendingCount = items.filter((item) => item.commitment.status === "pending").length;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">Seguimiento de acuerdos</h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-muted">
            Cada acuerdo y compromiso proviene de un acta aprobada, con su responsable y su fecha tal como constan
            en el documento. Aquí se registra si se cumplieron.
          </p>
        </div>
        <CommitmentLegend />
      </header>

      {items.length === 0 ? (
        <EmptyState
          title="Todavía no hay compromisos que seguir"
          description="Los acuerdos y compromisos aparecen aquí en cuanto apruebe un acta. Se toman de la versión aprobada, no del borrador de la IA."
          action={<ButtonLink href="/meetings">Ir a reuniones</ButtonLink>}
        />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Estado general</CardTitle>
              <CardDescription>
                {items.length} {items.length === 1 ? "compromiso registrado" : "compromisos registrados"} en actas
                aprobadas de {institution.name}.
              </CardDescription>
            </CardHeader>
            <CardBody>
              <ProgressRing
                segments={[
                  { label: "Completados", value: completed, color: "var(--color-verified-500)" },
                  { label: "En progreso", value: inProgress, color: "var(--color-brand-500)" },
                  { label: "Pendientes", value: pendingCount, color: "var(--color-line-strong)" },
                ]}
              />
            </CardBody>
          </Card>

          <FollowUpBoard items={items} />
        </>
      )}
    </div>
  );
}
