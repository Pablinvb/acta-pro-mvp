"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { createMeetingAction, type ActionState } from "@/app/(app)/meetings/actions";
import type { Student } from "@/lib/types";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Creando…" : "Crear y continuar"}
    </Button>
  );
}

export function NewMeetingForm({ students }: { students: Student[] }) {
  const [state, formAction] = useActionState<ActionState, FormData>(createMeetingAction, {});
  const [studentId, setStudentId] = useState(students[0]?.id ?? "");

  const student = students.find((item) => item.id === studentId);
  const suggestedTitle = student ? `Seguimiento académico — ${student.full_name.split(" ").slice(0, 2).join(" ")}` : "";

  return (
    <form action={formAction} className="space-y-5">
      <Field label="Estudiante" htmlFor="student_id">
        <Select
          id="student_id"
          name="student_id"
          required
          value={studentId}
          onChange={(event) => setStudentId(event.target.value)}
        >
          {students.length === 0 ? <option value="">No hay estudiantes disponibles</option> : null}
          {students.map((item) => (
            <option key={item.id} value={item.id}>
              {item.full_name} — {item.grade ?? "sin grado"} {item.section ?? ""}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Título de la reunión" htmlFor="title">
        <Input id="title" name="title" required maxLength={160} defaultValue={suggestedTitle} key={suggestedTitle} />
      </Field>

      <Field
        label="Motivo"
        htmlFor="reason"
        hint="Opcional. Describe por qué se convoca; no reemplaza lo que se registre durante la reunión."
      >
        <Textarea id="reason" name="reason" maxLength={600} />
      </Field>

      <Field label="Fecha y hora" htmlFor="scheduled_at" hint="Zona horaria del dispositivo (America/Guayaquil).">
        <Input id="scheduled_at" name="scheduled_at" type="datetime-local" required />
      </Field>

      {state.error ? (
        <p role="alert" className="rounded-xl border border-danger-500/35 bg-danger-soft px-3 py-2 text-sm font-medium text-danger-400">
          {state.error}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  );
}
