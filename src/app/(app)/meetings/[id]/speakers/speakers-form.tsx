"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/field";
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
          {speakers.map((speaker) => (
            <Card key={speaker.label}>
              <CardHeader>
                <CardTitle>{speaker.label}</CardTitle>
                <CardDescription>
                  {speaker.count} {speaker.count === 1 ? "intervención" : "intervenciones"}
                </CardDescription>
              </CardHeader>
              <CardBody className="space-y-4">
                <blockquote className="rounded-lg bg-canvas px-3 py-2 text-sm italic leading-relaxed text-ink-muted">
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
          ))}
        </div>

        {state.error ? (
          <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm font-medium text-danger-600">
            {state.error}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <SaveButton />
          {state.ok ? <span className="text-sm text-verified-700">Asignación guardada.</span> : null}
        </div>
      </form>

      <Card>
        <CardHeader>
          <CardTitle>Generar el borrador del acta</CardTitle>
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
          <Button variant="ai" size="lg" onClick={generate} disabled={generating}>
            {generating ? "Generando borrador…" : "Generar borrador con IA"}
          </Button>
          <p className="text-xs text-ink-muted">
            Guarde primero la asignación de hablantes: el borrador atribuye cada intervención según esa
            correspondencia.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
