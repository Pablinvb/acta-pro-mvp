"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckIcon, ClockIcon, UsersIcon } from "@/components/icons";
import { cn, shortDate, startOfWeek, weekRange } from "@/lib/utils";
import type { CommitmentStatus, CommitmentWithContext } from "@/lib/types";

const STATUS_LABEL: Record<CommitmentStatus, string> = {
  pending: "Pendiente",
  in_progress: "En progreso",
  completed: "Completado",
};

const STATUS_ORDER: CommitmentStatus[] = ["pending", "in_progress", "completed"];

const STATUS_STYLE: Record<CommitmentStatus, string> = {
  pending: "border-line-strong bg-surface-inset text-ink-subtle",
  in_progress: "border-brand-500/45 bg-brand-soft text-brand-300",
  completed: "border-verified-500/40 bg-verified-soft text-verified-400",
};

const WEEKS = 4;

export function FollowUpBoard({ items }: { items: CommitmentWithContext[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState<Record<string, CommitmentStatus>>({});

  const statusOf = (item: CommitmentWithContext) => optimistic[item.commitment.id] ?? item.commitment.status;

  async function advance(item: CommitmentWithContext) {
    const current = statusOf(item);
    const next = STATUS_ORDER[(STATUS_ORDER.indexOf(current) + 1) % STATUS_ORDER.length];

    setOptimistic((state) => ({ ...state, [item.commitment.id]: next }));
    setError(null);

    try {
      const response = await fetch(`/api/commitments/${item.commitment.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "No se pudo actualizar el compromiso.");
      }
      startTransition(() => router.refresh());
    } catch (updateError) {
      // Se revierte la vista optimista: el estado real no cambió.
      setOptimistic((state) => {
        const next = { ...state };
        delete next[item.commitment.id];
        return next;
      });
      setError(updateError instanceof Error ? updateError.message : "No se pudo actualizar el compromiso.");
    }
  }

  const weeks = useMemo(() => weekRange(new Date(), WEEKS), []);
  const currentWeek = weeks[0];

  const dated = items.filter((item) => item.commitment.due_date);
  const undated = items.filter((item) => !item.commitment.due_date);

  // Filas del tablero: una por persona responsable.
  const responsables = useMemo(() => {
    const names = new Set(dated.map((item) => item.commitment.responsible ?? "Sin responsable"));
    return [...names].sort((a, b) => a.localeCompare(b, "es"));
  }, [dated]);

  const inWeek = (item: CommitmentWithContext, week: string) =>
    item.commitment.due_date ? startOfWeek(item.commitment.due_date) === week : false;

  const overdue = dated.filter(
    (item) =>
      statusOf(item) !== "completed" &&
      item.commitment.due_date! < new Date().toISOString().slice(0, 10),
  );

  return (
    <div className="space-y-6">
      {error ? (
        <Alert tone="danger" title="No se pudo guardar el cambio">
          {error}
        </Alert>
      ) : null}

      {overdue.length > 0 ? (
        <Alert tone="review" title={`${overdue.length} compromiso(s) con fecha vencida`}>
          Revise si se cumplieron y actualice su estado, o acuerde una nueva fecha en la próxima reunión.
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Compromisos por responsable y semana</CardTitle>
          <CardDescription>
            Pulse cualquier compromiso para avanzar su estado: pendiente → en progreso → completado. Solo usted
            cambia el estado; el sistema no marca nada como cumplido por su cuenta.
          </CardDescription>
        </CardHeader>
        <CardBody className="overflow-x-auto">
          {responsables.length === 0 ? (
            <p className="text-sm text-ink-muted">
              No hay compromisos con fecha en las próximas semanas.
            </p>
          ) : (
            <table className="w-full min-w-3xl border-separate border-spacing-0 text-sm">
              <caption className="sr-only">
                Compromisos agrupados por persona responsable y semana de vencimiento
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="w-52 border-b border-line px-3 py-2 text-left text-ink-subtle">
                    Responsable
                  </th>
                  {weeks.map((week, index) => (
                    <th
                      key={week}
                      scope="col"
                      className={cn(
                        "border-b border-line px-3 py-2 text-left font-medium",
                        week === currentWeek ? "text-brand-300" : "text-ink-subtle",
                      )}
                    >
                      <span className="block text-xs uppercase tracking-wide">
                        {index === 0 ? "Esta semana" : `Semana ${index + 1}`}
                      </span>
                      <span className="text-xs font-normal text-ink-subtle">Desde el {shortDate(week)}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {responsables.map((responsable) => (
                  <tr key={responsable}>
                    <th scope="row" className="border-b border-line px-3 py-3 text-left align-top">
                      <span className="flex items-start gap-2">
                        <UsersIcon className="mt-0.5 size-4 shrink-0 text-ink-subtle" />
                        <span className="font-medium text-ink">{responsable}</span>
                      </span>
                    </th>
                    {weeks.map((week) => {
                      const cell = dated.filter(
                        (item) =>
                          (item.commitment.responsible ?? "Sin responsable") === responsable && inWeek(item, week),
                      );
                      return (
                        <td key={week} className="border-b border-line px-3 py-3 align-top">
                          {cell.length === 0 ? (
                            <span className="text-xs text-ink-subtle">—</span>
                          ) : (
                            <ul className="space-y-2">
                              {cell.map((item) => (
                                <li key={item.commitment.id}>
                                  <CommitmentChip
                                    item={item}
                                    status={statusOf(item)}
                                    disabled={pending}
                                    onAdvance={() => advance(item)}
                                  />
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>

      {undated.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Compromisos sin fecha</CardTitle>
            <CardDescription>
              La fecha no consta en el acta. No se inventa una: acuérdela en la próxima reunión.
            </CardDescription>
          </CardHeader>
          <CardBody>
            <ul className="space-y-3">
              {undated.map((item) => (
                <li key={item.commitment.id} className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-ink">{item.commitment.description}</p>
                    <p className="mt-1 text-xs text-ink-subtle">
                      {item.commitment.responsible ?? "Responsable no consta"} · {item.student.full_name} ·{" "}
                      <Link
                        href={`/meetings/${item.commitment.meeting_id}`}
                        className="text-brand-400 hover:underline"
                      >
                        {item.meeting.title}
                      </Link>
                    </p>
                  </div>
                  <CommitmentChip
                    item={item}
                    status={statusOf(item)}
                    disabled={pending}
                    onAdvance={() => advance(item)}
                  />
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}

function CommitmentChip({
  item,
  status,
  disabled,
  onAdvance,
}: {
  item: CommitmentWithContext;
  status: CommitmentStatus;
  disabled: boolean;
  onAdvance: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onAdvance}
      disabled={disabled}
      aria-label={`${item.commitment.description}. Estado actual: ${STATUS_LABEL[status]}. Pulse para cambiarlo.`}
      className={cn(
        "w-full rounded-xl border px-3 py-2 text-left transition-colors hover:border-brand-500/60 disabled:cursor-not-allowed",
        STATUS_STYLE[status],
      )}
    >
      <span className="flex items-center gap-1.5 text-xs font-semibold">
        {status === "completed" ? <CheckIcon className="size-3.5" /> : <ClockIcon className="size-3.5" />}
        {STATUS_LABEL[status]}
      </span>
      <span className="mt-1 line-clamp-3 block text-xs leading-relaxed text-ink-muted">
        {item.commitment.description}
      </span>
      <span className="mt-1 block truncate text-[0.68rem] text-ink-subtle">
        {item.student.full_name}
        {item.commitment.due_date ? ` · ${shortDate(item.commitment.due_date)}` : ""}
      </span>
    </button>
  );
}

export function CommitmentLegend() {
  return (
    <div className="flex flex-wrap gap-2">
      {STATUS_ORDER.map((status) => (
        <Badge key={status} tone={status === "completed" ? "verified" : status === "in_progress" ? "info" : "neutral"}>
          {STATUS_LABEL[status]}
        </Badge>
      ))}
    </div>
  );
}
