"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { recordConsentAction, type ActionState } from "@/app/(app)/meetings/actions";
import { CONSENT_SECTIONS, CONSENT_SUMMARY, CONSENT_TEXT_VERSION, DRAFT_LEGAL_NOTE } from "@/lib/consent";
import type { MeetingParticipant } from "@/lib/types";

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" disabled={disabled || pending}>
      {pending ? "Registrando…" : "Registrar consentimiento"}
    </Button>
  );
}

export function ConsentPanel({
  meetingId,
  participants,
}: {
  meetingId: string;
  participants: MeetingParticipant[];
}) {
  const router = useRouter();
  const [state, formAction] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const result = await recordConsentAction(prev, formData);
    if (result.ok) router.refresh();
    return result;
  }, {});
  const [decisions, setDecisions] = useState<Record<string, boolean>>(
    Object.fromEntries(participants.map((p) => [p.id, p.consent_status === "granted"])),
  );
  const [readNotice, setReadNotice] = useState(false);

  const allGranted = participants.every((p) => decisions[p.id]);

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <Card className="lg:col-span-3">
        <CardHeader>
          <CardTitle>Aviso de tratamiento de datos</CardTitle>
          <CardDescription>{CONSENT_SUMMARY}</CardDescription>
        </CardHeader>
        <CardBody className="space-y-4">
          <dl className="space-y-4">
            {CONSENT_SECTIONS.map((section) => (
              <div key={section.heading}>
                <dt className="text-sm font-semibold text-ink">{section.heading}</dt>
                <dd className="mt-1 text-sm leading-relaxed text-ink-muted">{section.body}</dd>
              </div>
            ))}
          </dl>
          <p className="rounded-lg bg-canvas px-3 py-2 text-xs text-ink-subtle">
            {DRAFT_LEGAL_NOTE} Versión del texto: <code className="font-mono">{CONSENT_TEXT_VERSION}</code>
          </p>
        </CardBody>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Registro de consentimiento</CardTitle>
          <CardDescription>
            El micrófono permanece bloqueado hasta que todas las personas presentes acepten.
          </CardDescription>
        </CardHeader>
        <CardBody>
          <form action={formAction} className="space-y-5">
            <input type="hidden" name="meeting_id" value={meetingId} />

            <fieldset className="space-y-3">
              <legend className="sr-only">Personas presentes</legend>
              {participants.map((participant) => (
                <label
                  key={participant.id}
                  className="flex cursor-pointer items-start gap-3 rounded-card border border-line px-4 py-3 has-checked:border-verified-600/30 has-checked:bg-verified-50"
                >
                  <input
                    type="checkbox"
                    name={`consent_${participant.id}`}
                    value="granted"
                    checked={Boolean(decisions[participant.id])}
                    onChange={(event) =>
                      setDecisions((current) => ({ ...current, [participant.id]: event.target.checked }))
                    }
                    className="mt-0.5 size-4 accent-[#0f7b4f]"
                  />
                  <span>
                    <span className="block text-sm font-medium text-ink">{participant.display_name}</span>
                    <span className="block text-xs text-ink-muted">
                      Leí el aviso y autorizo la grabación de esta reunión.
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>

            <label className="flex cursor-pointer items-start gap-3 text-sm text-ink-muted">
              <input
                type="checkbox"
                checked={readNotice}
                onChange={(event) => setReadNotice(event.target.checked)}
                className="mt-0.5 size-4 accent-[#0b1f66]"
              />
              Confirmo que leí el aviso en voz alta y que todas las personas presentes pudieron preguntar.
            </label>

            {!allGranted ? (
              <Alert tone="review">
                Si alguien no autoriza la grabación, la reunión puede realizarse igualmente y el acta se redacta a
                mano. ACTA PRO no habilitará el micrófono.
              </Alert>
            ) : null}

            {state.error ? (
              <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm font-medium text-danger-600">
                {state.error}
              </p>
            ) : null}

            <SubmitButton disabled={!allGranted || !readNotice} />
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
