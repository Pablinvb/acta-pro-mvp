"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

export interface NavItem {
  href: string;
  label: string;
}

export function NavLink({
  href,
  children,
  icon,
  className,
}: {
  href: string;
  children: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
        active
          ? "bg-brand-soft text-ink"
          : "text-ink-muted hover:bg-surface-raised/60 hover:text-ink",
        className,
      )}
    >
      {/* Marcador lateral del elemento activo, como en la identidad de marca. */}
      <span
        aria-hidden
        className={cn(
          "absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full transition-all",
          active ? "brand-gradient" : "bg-transparent",
        )}
      />
      {icon ? (
        <span className={cn("shrink-0 transition-colors", active ? "text-brand-400" : "text-ink-subtle")}>
          {icon}
        </span>
      ) : null}
      <span className="truncate">{children}</span>
    </Link>
  );
}
