"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/field";
import { SparkIcon } from "@/components/icons";
import { StaticWaveform } from "@/components/waveform";
import { speakerColor } from "@/lib/speakers";
import { mapSpeakersAction, type ActionState } from "@/app/(app)/meetings/actions";
import type { MeetingParticipant } from "@/lib/types";

interface SpeakerSample {
  label: string;
  count: number;
  excerpt: string;
  assignedTo: string;
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" disabled={pending}>
      {pending ? "Guardando…" : "Guardar asignación"}
    </Button>
  );
}

export function SpeakersForm({
  meetingId,
  speakers,
  participants,
}: {
  meetingId: string;
  speakers: SpeakerSample[];
  participants: MeetingParticipant[];
}) {
  const router = useRouter();
  const [state, formAction] = useActionState<ActionState, FormData>(mapSpeakersAction, {});
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);

  const order = speakers.map((speaker) => speaker.label);

  async function generate() {
    setGenerating(true);
    setGenerationError(null);
    try {
      const response = await fetch("/api/minutes/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ meetingId }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "No se pudo generar el borrador.");
      router.push(`/meetings/${meetingId}/minutes`);
      router.refresh();
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : "No se pudo generar el borrador.");
      setGenerating(false);
    }
  }

  return (
    <div className="space-y-6">
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="meeting_id" value={meetingId} />

        <div className="grid gap-4 md:grid-cols-2">
          {speakers.map((speaker) => {
            const color = speakerColor(speaker.label, order);
            return (
              <Card key={speaker.label}>
                <CardHeader className="flex flex-wrap items-center justify-between gap-3">
                  <span className="flex items-center gap-2">
                    <span aria-hidden className="size-2.5 rounded-full" style={{ background: color }} />
                    <CardTitle className="font-mono">{speaker.label}</CardTitle>
                  </span>
                  <span className="text-xs text-ink-subtle">
                    {speaker.count} {speaker.count === 1 ? "intervención" : "intervenciones"}
                  </span>
                </CardHeader>
                <CardBody className="space-y-4">
                  {/* Huella visual de la voz: no reproduce audio, que no se conserva. */}
                  <StaticWaveform seed={`${speaker.label}:${speaker.excerpt}`} color={color} />

                  <blockquote className="rounded-xl border border-line bg-surface-inset/70 px-3 py-2.5 text-sm italic leading-relaxed text-ink-muted">
                    “{speaker.excerpt.slice(0, 220)}
                    {speaker.excerpt.length > 220 ? "…" : ""}”
                  </blockquote>

                  <Field label="Corresponde a" htmlFor={`speaker_${speaker.label}`}>
                    <Select
                      id={`speaker_${speaker.label}`}
                      name={`speaker_${speaker.label}`}
                      defaultValue={speaker.assignedTo}
                      required
                    >
                      <option value="">Seleccione una persona</option>
                      {participants.map((participant) => (
                        <option key={participant.id} value={participant.id}>
                          {participant.display_name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </CardBody>
              </Card>
            );
          })}
        </div>

        {state.error ? (
          <p
            role="alert"
            className="rounded-xl border border-danger-500/35 bg-danger-soft px-3 py-2 text-sm font-medium text-danger-400"
          >
            {state.error}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <SaveButton />
          {state.ok ? <span className="text-sm text-verified-400">Asignación guardada.</span> : null}
        </div>
      </form>

      <Card className="glow-brand">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SparkIcon className="size-4.5 text-brand-400" />
            Generar el borrador del acta
          </CardTitle>
          <CardDescription>
            La IA propone un borrador a partir de la transcripción. Usted revisa, corrige y aprueba antes de firmar.
            El acta permanece como BORRADOR hasta su aprobación.
          </CardDescription>
        </CardHeader>
        <CardBody className="space-y-4">
          {generationError ? (
            <Alert tone="danger" title="No se pudo generar el borrador">
              {generationError}
            </Alert>
          ) : null}
          <Button size="lg" onClick={generate} disabled={generating}>
            <SparkIcon className="size-4.5" />
            {generating ? "Generando borrador…" : "Generar borrador con IA"}
          </Button>
          <p className="text-xs text-ink-subtle">
            Guarde primero la asignación de hablantes: el borrador atribuye cada intervención según esa
            correspondencia.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
