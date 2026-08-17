import * as React from "react";

import { cn } from "@/lib/utils";

const CONTROL =
  "w-full rounded-xl border border-line-strong bg-surface-inset px-3 py-2.5 text-sm text-ink transition-colors placeholder:text-ink-subtle hover:border-brand-500/40 focus:border-brand-500 disabled:cursor-not-allowed disabled:border-line disabled:bg-surface/60 disabled:text-ink-subtle";

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  htmlFor: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-ink">
        {label}
      </label>
      {hint ? (
        <p id={`${htmlFor}-hint`} className="text-xs leading-relaxed text-ink-muted">
          {hint}
        </p>
      ) : null}
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="text-xs font-medium text-danger-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(CONTROL, "[color-scheme:dark]", className)} {...props} />;
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(CONTROL, "min-h-24 resize-y leading-relaxed", className)} {...props} />;
}

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(CONTROL, "pr-8 [color-scheme:dark]", className)} {...props} />;
}

/** Casilla con el mismo tratamiento visual en toda la aplicación. */
export function Checkbox({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="checkbox"
      className={cn(
        "mt-0.5 size-4 shrink-0 cursor-pointer rounded border-line-strong bg-surface-inset accent-[#1f6feb] disabled:cursor-not-allowed",
        className,
      )}
      {...props}
    />
  );
}
