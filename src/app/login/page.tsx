import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LoginForm } from "@/app/login/login-form";
import { ActaProMark } from "@/components/brand";
import { DocumentIcon, ShieldCheckIcon, SparkIcon, TrackingIcon } from "@/components/icons";
import { getSession } from "@/lib/session";
import { isDemoMode, isSupabaseConfigured } from "@/lib/env";
import { DEMO_TEACHER_EMAIL, DEMO_TEACHER_PASSWORD } from "@/lib/demo/seed-data";

export const metadata: Metadata = { title: "Ingresar" };

const PILLS = [
  { icon: <SparkIcon className="size-4" />, label: "IA que propone" },
  { icon: <DocumentIcon className="size-4" />, label: "Actas" },
  { icon: <TrackingIcon className="size-4" />, label: "Seguimiento" },
  { icon: <ShieldCheckIcon className="size-4" />, label: "Trazabilidad" },
];

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect("/dashboard");

  const usingSupabase = isSupabaseConfigured();
  const demo = isDemoMode();

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.15fr_1fr]">
      <section className="relative flex flex-col justify-center overflow-hidden px-8 py-16 lg:px-16">
        {/* Resplandor de marca detrás del titular. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -right-40 top-1/4 size-[38rem] rounded-full bg-brand-500/20 blur-[120px]"
        />

        <div className="relative mx-auto w-full max-w-xl">
          <div className="flex items-center gap-3">
            <ActaProMark className="size-11" />
            <span className="text-xl font-extrabold tracking-tight">
              <span className="text-ink">ACTA</span> <span className="text-brand-400">PRO</span>
            </span>
          </div>

          <h1 className="mt-10 text-5xl font-extrabold leading-[0.95] tracking-tight sm:text-6xl">
            <span className="block text-ink">ACTA</span>
            <span className="block text-brand-500">PRO</span>
          </h1>
          <span aria-hidden className="mt-5 block h-1 w-24 rounded-full bg-linear-to-r from-brand-400 to-transparent" />

          <p className="mt-6 text-2xl font-medium leading-snug text-ink-muted">
            De una reunión a una <span className="text-ink">evidencia institucional</span>
          </p>

          <ul className="mt-8 flex flex-wrap gap-2.5">
            {PILLS.map((pill) => (
              <li
                key={pill.label}
                className="flex items-center gap-2 rounded-xl border border-line-strong bg-surface/60 px-3.5 py-2 text-sm font-medium text-ink"
              >
                <span className="text-brand-400">{pill.icon}</span>
                {pill.label}
              </li>
            ))}
          </ul>

          <ol className="mt-10 space-y-3 text-sm text-ink-muted">
            {[
              "Consentimiento registrado antes de grabar.",
              "Transcripción separada por hablante.",
              "Borrador objetivo que usted revisa y aprueba.",
              "PDF firmado con huella SHA-256 y auditoría.",
            ].map((item, index) => (
              <li key={item} className="flex gap-3">
                <span
                  aria-hidden
                  className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-bold text-brand-300"
                >
                  {index + 1}
                </span>
                {item}
              </li>
            ))}
          </ol>

          <p className="mt-10 max-w-md text-xs leading-relaxed text-ink-subtle">
            ACTA PRO genera evidencia institucional trazable. No otorga validez legal automática ni sustituye una
            firma electrónica cualificada.
          </p>
        </div>
      </section>

      <section className="flex flex-col justify-center border-t border-line bg-surface/40 px-6 py-16 backdrop-blur lg:border-l lg:border-t-0 lg:px-14">
        <div className="mx-auto w-full max-w-sm">
          <h2 className="text-2xl font-bold tracking-tight text-ink">Ingrese a su cuenta</h2>
          <p className="mt-2 text-sm text-ink-muted">
            {usingSupabase
              ? "Autenticación gestionada por Supabase."
              : "Autenticación de demostración: no hay proveedor de identidad conectado."}
          </p>

          <LoginForm defaultEmail={demo && !usingSupabase ? DEMO_TEACHER_EMAIL : ""} />

          {demo && !usingSupabase ? (
            <div className="mt-6 rounded-card border border-review-500/30 bg-review-soft px-4 py-3 text-sm text-review-400">
              <p className="font-semibold text-ink">Credenciales de demostración</p>
              <p className="mt-1">
                Correo <code className="font-mono text-brand-300">{DEMO_TEACHER_EMAIL}</code>
              </p>
              <p>
                Contraseña <code className="font-mono text-brand-300">{DEMO_TEACHER_PASSWORD}</code>
              </p>
              <p className="mt-2 text-xs text-ink-subtle">Persona ficticia creada para la demostración.</p>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
