"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { confirmParticipantsAction, type ActionState } from "@/app/(app)/meetings/actions";

interface Option {
  key: string;
  type: "teacher" | "representative" | "student";
  name: string;
  subtitle: string;
  required: boolean;
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Guardando…" : "Confirmar y continuar"}
    </Button>
  );
}

export function ParticipantsForm({
  meetingId,
  options,
  selectedKeys,
  hasPreviousSelection,
}: {
  meetingId: string;
  options: Option[];
  selectedKeys: string[];
  hasPreviousSelection: boolean;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(confirmParticipantsAction, {});
  const [extras, setExtras] = useState<string[]>([]);

  const isChecked = (option: Option) =>
    option.required || (hasPreviousSelection ? selectedKeys.includes(option.key) : true);

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="meeting_id" value={meetingId} />

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-ink">Personas registradas</legend>
        {options.map((option) => (
          <label
            key={option.key}
            className="flex cursor-pointer items-start gap-3 rounded-card border border-line px-4 py-3 hover:bg-navy-50/40 has-checked:border-navy-100 has-checked:bg-navy-50/60"
          >
            <input
              type="checkbox"
              name="participant"
              value={option.key}
              defaultChecked={isChecked(option)}
              disabled={option.required}
              className="mt-0.5 size-4 accent-[#0b1f66]"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-ink">{option.name}</span>
              <span className="block text-xs text-ink-muted">{option.subtitle}</span>
              {option.required ? (
                <span className="mt-1 block text-xs font-medium text-navy-600">
                  Siempre presente: es quien convoca y firma.
                </span>
              ) : null}
            </span>
          </label>
        ))}
        {options.some((option) => option.required) ? (
          <input
            type="hidden"
            name="participant"
            value={options.find((option) => option.required)!.key}
          />
        ) : null}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-ink">Otras personas presentes</legend>
        {extras.map((value, index) => (
          <div key={index} className="flex items-end gap-2">
            <Field label={`Persona adicional ${index + 1}`} htmlFor={`extra-${index}`} className="flex-1">
              <Input
                id={`extra-${index}`}
                value={value}
                onChange={(event) =>
                  setExtras((current) => current.map((item, i) => (i === index ? event.target.value : item)))
                }
                placeholder="Nombre y rol, por ejemplo: Luis Salas — DECE"
                maxLength={160}
              />
            </Field>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setExtras((current) => current.filter((_, i) => i !== index))}
            >
              Quitar
            </Button>
            {value.trim().length >= 2 ? (
              <input type="hidden" name="participant" value={`other||${value.trim()}`} />
            ) : null}
          </div>
        ))}
        <Button type="button" variant="secondary" size="sm" onClick={() => setExtras((c) => [...c, ""])}>
          Agregar persona
        </Button>
      </fieldset>

      {state.error ? (
        <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm font-medium text-danger-600">
          {state.error}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  );
}
