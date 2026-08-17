"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { login, type LoginState } from "@/app/login/actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending}>
      {pending ? "Ingresando…" : "Ingresar"}
    </Button>
  );
}

export function LoginForm({ defaultEmail }: { defaultEmail: string }) {
  const [state, formAction] = useActionState<LoginState, FormData>(login, {});

  return (
    <form action={formAction} className="mt-8 space-y-5">
      <Field label="Correo institucional" htmlFor="email">
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          defaultValue={defaultEmail}
        />
      </Field>

      <Field label="Contraseña" htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>

      {state.error ? (
        <p
          role="alert"
          className="rounded-xl border border-danger-500/35 bg-danger-soft px-3 py-2 text-sm font-medium text-danger-400"
        >
          {state.error}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  );
}
