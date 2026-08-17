"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { SourceSegments, type SourceSegment } from "@/components/source-segments";
import { ArrowDownIcon, SparkIcon } from "@/components/icons";
import { cn } from "@/lib/utils";
import type { Minutes } from "@/lib/schemas/minutes";
import type { MinutesStatus } from "@/lib/types";

interface Props {
  meetingId: string;
  minutesId: string;
  version: number;
  status: MinutesStatus;
  generator: "anthropic" | "demo";
  model: string | null;
  draft: Minutes;
  initialContent: Minutes;
  initialAcceptedFlags: number[];
  segments: SourceSegment[];
  editable: boolean;
}

export function MinutesEditor({
  meetingId,
  minutesId,
  version,
  status,
  generator,
  model,
  draft,
  initialContent,
  initialAcceptedFlags,
  segments,
  editable,
}: Props) {
  const router = useRouter();
  const [content, setContent] = useState<Minutes>(initialContent);
  const [acceptedFlags, setAcceptedFlags] = useState<number[]>(initialAcceptedFlags);
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const segmentMap = useMemo(() => new Map(segments.map((segment) => [segment.id, segment])), [segments]);

  const update = <K extends keyof Minutes>(key: K, value: Minutes[K]) => {
    setContent((current) => ({ ...current, [key]: value }));
    setMessage(null);
  };

  async function save() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/minutes/${minutesId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content, accepted_language_flags: acceptedFlags }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "No se pudieron guardar los cambios.");
      setMessage("Cambios guardados. El borrador original de la IA se conserva sin modificar.");
      router.refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se pudieron guardar los cambios.");
    } finally {
      setSaving(false);
    }
  }

  async function approve() {
    setApproving(true);
    setError(null);
    try {
      const saveResponse = await fetch(`/api/minutes/${minutesId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content, accepted_language_flags: acceptedFlags }),
      });
      if (!saveResponse.ok) {
        const payload = (await saveResponse.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "No se pudieron guardar los cambios antes de aprobar.");
      }

      const response = await fetch(`/api/minutes/${minutesId}/approve`, { method: "POST" });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "No se pudo aprobar el acta.");

      router.push(`/meetings/${meetingId}/sign`);
      router.refresh();
    } catch (approveError) {
      setError(approveError instanceof Error ? approveError.message : "No se pudo aprobar el acta.");
      setApproving(false);
    }
  }

  const toggleFlag = (index: number) =>
    setAcceptedFlags((current) =>
      current.includes(index) ? current.filter((item) => item !== index) : [...current, index],
    );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={status === "approved" ? "verified" : "review"}>
          {status === "approved" ? "Aprobada" : "BORRADOR"}
        </Badge>
        <Badge tone="ai">
          {generator === "anthropic" ? `Borrador generado por ${model ?? "IA"}` : "Borrador de demostración"}
        </Badge>
        <Badge tone="neutral">Versión {version}</Badge>
      </div>

      {generator === "demo" ? (
        <Alert tone="review" title="Modo demostración">
          Este borrador no fue producido por un modelo de lenguaje: proviene de un generador determinístico con datos
          ficticios. Configure ANTHROPIC_API_KEY para generar actas reales.
        </Alert>
      ) : null}

      {content.review_warnings.length > 0 ? (
        <Alert tone="review" title="Puntos que requieren su revisión">
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {content.review_warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Resumen y motivo</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <Field label="Resumen" htmlFor="summary">
            <Textarea
              id="summary"
              value={content.summary}
              disabled={!editable}
              onChange={(event) => update("summary", event.target.value)}
              rows={4}
            />
          </Field>
          <Field label="Motivo de la reunión" htmlFor="reason" hint="Deje vacío si no consta en la conversación.">
            <Input
              id="reason"
              value={content.meeting_reason ?? ""}
              disabled={!editable}
              onChange={(event) => update("meeting_reason", event.target.value || null)}
            />
          </Field>
        </CardBody>
      </Card>

      <ListSection
        title="Temas tratados"
        description="Cada tema debe apoyarse en la transcripción."
        items={content.topics}
        segmentMap={segmentMap}
        editable={editable}
        getSources={(item) => item.source_segment_ids}
        onChange={(topics) => update("topics", topics)}
        renderFields={(item, onPatch, disabled, index) => (
          <>
            <Field label="Título" htmlFor={`topic-title-${index}`}>
              <Input
                id={`topic-title-${index}`}
                value={item.title}
                disabled={disabled}
                onChange={(event) => onPatch({ title: event.target.value })}
              />
            </Field>
            <Field label="Descripción" htmlFor={`topic-desc-${index}`}>
              <Textarea
                id={`topic-desc-${index}`}
                value={item.description}
                disabled={disabled}
                onChange={(event) => onPatch({ description: event.target.value })}
                rows={3}
              />
            </Field>
          </>
        )}
      />

      <ListSection
        title="Hechos mencionados"
        description="Se registran como afirmaciones atribuidas a quien las dijo, no como verdades verificadas."
        items={content.facts}
        segmentMap={segmentMap}
        editable={editable}
        getSources={(item) => item.source_segment_ids}
        onChange={(facts) => update("facts", facts)}
        renderFields={(item, onPatch, disabled, index) => (
          <>
            <Field label="Afirmación" htmlFor={`fact-${index}`}>
              <Textarea
                id={`fact-${index}`}
                value={item.statement}
                disabled={disabled}
                onChange={(event) => onPatch({ statement: event.target.value })}
                rows={2}
              />
            </Field>
            <Field label="Atribuido a" htmlFor={`fact-who-${index}`}>
              <Input
                id={`fact-who-${index}`}
                value={item.attributed_to}
                disabled={disabled}
                onChange={(event) => onPatch({ attributed_to: event.target.value })}
              />
            </Field>
          </>
        )}
      />

      <ListSection
        title="Acuerdos"
        description="Deje la fecha vacía cuando no conste en la conversación."
        items={content.agreements}
        segmentMap={segmentMap}
        editable={editable}
        getSources={(item) => item.source_segment_ids}
        onChange={(agreements) => update("agreements", agreements)}
        onAdd={() => ({ description: "", responsible: null, due_date: null, source_segment_ids: [] })}
        renderFields={(item, onPatch, disabled, index) => (
          <>
            <Field label="Acuerdo" htmlFor={`agr-${index}`}>
              <Textarea
                id={`agr-${index}`}
                value={item.description}
                disabled={disabled}
                onChange={(event) => onPatch({ description: event.target.value })}
                rows={2}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Responsable" htmlFor={`agr-resp-${index}`}>
                <Input
                  id={`agr-resp-${index}`}
                  value={item.responsible ?? ""}
                  placeholder="No consta"
                  disabled={disabled}
                  onChange={(event) => onPatch({ responsible: event.target.value || null })}
                />
              </Field>
              <Field label="Fecha límite" htmlFor={`agr-date-${index}`}>
                <Input
                  id={`agr-date-${index}`}
                  type="date"
                  value={item.due_date ?? ""}
                  disabled={disabled}
                  onChange={(event) => onPatch({ due_date: event.target.value || null })}
                />
              </Field>
            </div>
          </>
        )}
      />

      <ListSection
        title="Compromisos"
        description="Compromisos asumidos por una persona concreta durante la reunión."
        items={content.commitments}
        segmentMap={segmentMap}
        editable={editable}
        getSources={(item) => item.source_segment_ids}
        onChange={(commitments) => update("commitments", commitments)}
        onAdd={() => ({ description: "", responsible: null, due_date: null, source_segment_ids: [] })}
        renderFields={(item, onPatch, disabled, index) => (
          <>
            <Field label="Compromiso" htmlFor={`cmt-${index}`}>
              <Textarea
                id={`cmt-${index}`}
                value={item.description}
                disabled={disabled}
                onChange={(event) => onPatch({ description: event.target.value })}
                rows={2}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Responsable" htmlFor={`cmt-resp-${index}`}>
                <Input
                  id={`cmt-resp-${index}`}
                  value={item.responsible ?? ""}
                  placeholder="No consta"
                  disabled={disabled}
                  onChange={(event) => onPatch({ responsible: event.target.value || null })}
                />
              </Field>
              <Field label="Fecha límite" htmlFor={`cmt-date-${index}`}>
                <Input
                  id={`cmt-date-${index}`}
                  type="date"
                  value={item.due_date ?? ""}
                  disabled={disabled}
                  onChange={(event) => onPatch({ due_date: event.target.value || null })}
                />
              </Field>
            </div>
          </>
        )}
      />

      <ListSection
        title="Seguimiento"
        description="Acciones posteriores acordadas en la reunión."
        items={content.follow_up}
        segmentMap={segmentMap}
        editable={editable}
        getSources={(item) => item.source_segment_ids}
        onChange={(followUp) => update("follow_up", followUp)}
        onAdd={() => ({ action: "", date: null, source_segment_ids: [] })}
        renderFields={(item, onPatch, disabled, index) => (
          <>
            <Field label="Acción" htmlFor={`fu-${index}`}>
              <Textarea
                id={`fu-${index}`}
                value={item.action}
                disabled={disabled}
                onChange={(event) => onPatch({ action: event.target.value })}
                rows={2}
              />
            </Field>
            <Field label="Fecha" htmlFor={`fu-date-${index}`}>
              <Input
                id={`fu-date-${index}`}
                type="date"
                value={item.date ?? ""}
                disabled={disabled}
                onChange={(event) => onPatch({ date: event.target.value || null })}
              />
            </Field>
          </>
        )}
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SparkIcon className="size-4.5 text-brand-400" />
            Revisión asistida: IA que propone, humano decide
          </CardTitle>
          <CardDescription>
            Estas expresiones califican a una persona o atribuyen intenciones. Aceptar una sugerencia la incorpora
            al acta como precisión de lenguaje; la transcripción original no se modifica en ningún caso.
          </CardDescription>
        </CardHeader>
        <CardBody className="space-y-5">
          {draft.language_flags.length === 0 ? (
            <p className="text-sm text-ink-muted">No se detectaron expresiones que requieran ajuste.</p>
          ) : (
            draft.language_flags.map((flag, index) => {
              const accepted = acceptedFlags.includes(index);
              return (
                <article
                  key={index}
                  className={cn(
                    "rounded-card border transition-colors",
                    accepted ? "border-verified-500/40 bg-verified-soft/50" : "border-line bg-surface-inset/50",
                  )}
                >
                  <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
                    <span className="flex items-center gap-2 text-xs font-semibold text-review-400">
                      <span aria-hidden className="size-2 rounded-full bg-review-500" />
                      Detectado: lenguaje subjetivo
                    </span>
                    <Badge tone={accepted ? "verified" : "review"}>
                      {accepted ? "Incorporada al acta" : "En revisión"}
                    </Badge>
                  </header>

                  <div className="space-y-3 px-4 py-4">
                    <blockquote className="rounded-xl border border-review-500/25 bg-review-soft/40 px-3 py-2.5">
                      <p className="text-sm italic leading-relaxed text-ink">“{flag.original_fragment}”</p>
                    </blockquote>

                    <div className="flex justify-center" aria-hidden>
                      <ArrowDownIcon className="size-5 text-brand-400" />
                    </div>

                    <div>
                      <p className="flex items-center gap-2 text-xs font-semibold text-verified-400">
                        <span aria-hidden className="size-2 rounded-full bg-verified-500" />
                        Sugerencia de redacción institucional
                      </p>
                      <p className="mt-1.5 rounded-xl border border-verified-500/25 bg-verified-soft/40 px-3 py-2.5 text-sm leading-relaxed text-ink">
                        {flag.objective_suggestion}
                      </p>
                    </div>

                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">Justificación</p>
                      <p className="mt-1 text-sm leading-relaxed text-ink-muted">{flag.reason}</p>
                    </div>

                    <SourceSegments ids={flag.source_segment_ids} segments={segmentMap} />
                  </div>

                  <footer className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-3">
                    <Button
                      type="button"
                      size="sm"
                      variant={accepted ? "secondary" : "primary"}
                      disabled={!editable}
                      onClick={() => toggleFlag(index)}
                    >
                      {accepted ? "Quitar del acta" : "Aprobar sugerencia"}
                    </Button>
                    <p className="text-xs text-ink-subtle">
                      Una sugerencia aceptada se registra como precisión de lenguaje, no como algo dicho en la
                      reunión.
                    </p>
                  </footer>
                </article>
              );
            })
          )}
        </CardBody>
      </Card>

      <TextListSection
        title="Asuntos pendientes"
        description="Datos que no constan en la conversación o que quedaron sin resolver."
        items={content.pending_items}
        editable={editable}
        onChange={(items) => update("pending_items", items)}
      />

      <TextListSection
        title="Discrepancias registradas"
        description="Versiones distintas expresadas en la reunión. Se registran sin decidir quién tiene razón."
        items={content.contradictions}
        editable={editable}
        onChange={(items) => update("contradictions", items)}
      />

      {error ? (
        <Alert tone="danger" title="No se pudo completar la acción">
          {error}
        </Alert>
      ) : null}
      {message ? <Alert tone="verified">{message}</Alert> : null}

      {editable ? (
        <div className="glass sticky bottom-4 z-10 flex flex-wrap gap-3 rounded-card border border-brand-500/30 px-4 py-3 shadow-[0_18px_50px_-20px_rgba(3,7,19,0.95)]">
          <Button variant="secondary" onClick={save} disabled={saving || approving}>
            {saving ? "Guardando…" : "Guardar cambios"}
          </Button>
          <Button onClick={approve} disabled={saving || approving}>
            {approving ? "Aprobando…" : "Aprobar acta y continuar a firmas"}
          </Button>
          <p className="w-full text-xs text-ink-muted">
            Al aprobar declara que revisó el contenido. El acta deja de estar en BORRADOR y pasa a la etapa de firmas.
          </p>
        </div>
      ) : (
        <Alert tone="verified" title="Acta aprobada">
          El acta ya fue aprobada y no admite ediciones. Continúe con las firmas.
        </Alert>
      )}
    </div>
  );
}

function ListSection<T>({
  title,
  description,
  items,
  segmentMap,
  editable,
  getSources,
  onChange,
  onAdd,
  renderFields,
}: {
  title: string;
  description: string;
  items: T[];
  segmentMap: Map<string, SourceSegment>;
  editable: boolean;
  getSources: (item: T) => string[];
  onChange: (items: T[]) => void;
  onAdd?: () => T;
  renderFields: (
    item: T,
    onPatch: (patch: Partial<T>) => void,
    disabled: boolean,
    index: number,
  ) => React.ReactNode;
}) {
  const patch = (index: number, value: Partial<T>) =>
    onChange(items.map((item, i) => (i === index ? { ...item, ...value } : item)));

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardBody className="space-y-5">
        {items.length === 0 ? (
          <p className="text-sm text-ink-muted">No consta.</p>
        ) : (
          items.map((item, index) => (
            <div key={index} className="space-y-3 rounded-card border border-line px-4 py-3">
              {renderFields(item, (value) => patch(index, value), !editable, index)}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <SourceSegments ids={getSources(item)} segments={segmentMap} />
                {editable ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => onChange(items.filter((_, i) => i !== index))}
                  >
                    Eliminar
                  </Button>
                ) : null}
              </div>
            </div>
          ))
        )}
        {editable && onAdd ? (
          <Button type="button" size="sm" variant="secondary" onClick={() => onChange([...items, onAdd()])}>
            Agregar
          </Button>
        ) : null}
      </CardBody>
    </Card>
  );
}

function TextListSection({
  title,
  description,
  items,
  editable,
  onChange,
}: {
  title: string;
  description: string;
  items: string[];
  editable: boolean;
  onChange: (items: string[]) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardBody className="space-y-3">
        {items.length === 0 ? <p className="text-sm text-ink-muted">No consta.</p> : null}
        {items.map((item, index) => (
          <div key={index} className="flex items-start gap-2">
            <Textarea
              aria-label={`${title} ${index + 1}`}
              value={item}
              disabled={!editable}
              rows={2}
              onChange={(event) => onChange(items.map((value, i) => (i === index ? event.target.value : value)))}
            />
            {editable ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => onChange(items.filter((_, i) => i !== index))}
              >
                Quitar
              </Button>
            ) : null}
          </div>
        ))}
        {editable ? (
          <Button type="button" size="sm" variant="secondary" onClick={() => onChange([...items, ""])}>
            Agregar
          </Button>
        ) : null}
      </CardBody>
    </Card>
  );
}
