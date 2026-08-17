import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LoginForm } from "@/app/login/login-form";
import { getSession } from "@/lib/session";
import { isDemoMode, isSupabaseConfigured } from "@/lib/env";
import { DEMO_TEACHER_EMAIL, DEMO_TEACHER_PASSWORD } from "@/lib/demo/seed-data";

export const metadata: Metadata = { title: "Ingresar" };

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect("/dashboard");

  const usingSupabase = isSupabaseConfigured();
  const demo = isDemoMode();

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <section className="flex flex-col justify-center bg-navy-600 px-8 py-16 text-white lg:px-14">
        <div className="mx-auto w-full max-w-md">
          <span
            aria-hidden
            className="flex size-11 items-center justify-center rounded-xl bg-white/15 text-base font-bold"
          >
            AP
          </span>
          <h1 className="mt-6 text-3xl font-bold tracking-tight">ACTA PRO</h1>
          <p className="mt-3 text-lg leading-relaxed text-white/85">
            De la conversación al acta trazable, sin dejar de escuchar para redactar.
          </p>
          <ol className="mt-8 space-y-3 text-sm text-white/80">
            {[
              "Consentimiento registrado antes de grabar.",
              "Transcripción separada por hablante.",
              "Borrador objetivo que usted revisa y aprueba.",
              "PDF firmado con huella SHA-256 y auditoría.",
            ].map((item, index) => (
              <li key={item} className="flex gap-3">
                <span
                  aria-hidden
                  className="flex size-6 shrink-0 items-center justify-center rounded-full bg-white/15 text-xs font-bold"
                >
                  {index + 1}
                </span>
                {item}
              </li>
            ))}
          </ol>
          <p className="mt-10 text-xs leading-relaxed text-white/60">
            ACTA PRO genera evidencia institucional trazable. No otorga validez legal automática ni sustituye una
            firma electrónica cualificada.
          </p>
        </div>
      </section>

      <section className="flex flex-col justify-center px-6 py-16 lg:px-14">
        <div className="mx-auto w-full max-w-sm">
          <h2 className="text-2xl font-bold tracking-tight text-ink">Ingrese a su cuenta</h2>
          <p className="mt-2 text-sm text-ink-muted">
            {usingSupabase
              ? "Autenticación gestionada por Supabase."
              : "Autenticación de demostración: no hay proveedor de identidad conectado."}
          </p>

          <LoginForm defaultEmail={demo && !usingSupabase ? DEMO_TEACHER_EMAIL : ""} />

          {demo && !usingSupabase ? (
            <div className="mt-6 rounded-card border border-review-600/25 bg-review-50 px-4 py-3 text-sm text-review-700">
              <p className="font-semibold">Credenciales de demostración</p>
              <p className="mt-1">
                Correo <code className="font-mono">{DEMO_TEACHER_EMAIL}</code> · contraseña{" "}
                <code className="font-mono">{DEMO_TEACHER_PASSWORD}</code>
              </p>
              <p className="mt-2 text-xs">Persona ficticia creada para la demostración.</p>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
