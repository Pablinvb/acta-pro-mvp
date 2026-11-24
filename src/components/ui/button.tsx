import * as React from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "verified";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary:
    "brand-gradient text-white shadow-[0_10px_30px_-12px_rgba(31,111,235,0.9)] hover:brightness-110 disabled:opacity-45 disabled:shadow-none disabled:hover:brightness-100",
  secondary:
    "border border-line-strong bg-surface-raised/70 text-ink hover:border-brand-500/60 hover:bg-surface-raised disabled:text-ink-subtle disabled:hover:border-line-strong",
  ghost: "text-ink-muted hover:bg-surface-raised/70 hover:text-ink disabled:text-ink-subtle",
  danger: "bg-danger-500 text-white hover:bg-danger-400 disabled:bg-danger-500/40",
  verified: "bg-verified-500 text-canvas-deep hover:bg-verified-400 disabled:bg-verified-500/40",
};

const SIZES: Record<Size, string> = {
  sm: "h-9 gap-1.5 px-3 text-sm",
  md: "h-11 gap-2 px-4 text-sm",
  lg: "h-13 gap-2.5 px-6 text-base",
};

const BASE =
  "inline-flex items-center justify-center rounded-xl font-semibold transition-all duration-150 active:translate-y-px disabled:cursor-not-allowed disabled:active:translate-y-0";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export function Button({ variant = "primary", size = "md", className, ...props }: ButtonProps) {
  return <button className={cn(BASE, VARIANTS[variant], SIZES[size], className)} {...props} />;
}

export interface ButtonLinkProps extends React.ComponentProps<typeof Link> {
  variant?: Variant;
  size?: Size;
}

export function ButtonLink({ variant = "primary", size = "md", className, ...props }: ButtonLinkProps) {
  return <Link className={cn(BASE, VARIANTS[variant], SIZES[size], className)} {...props} />;
}
