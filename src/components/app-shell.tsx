import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { NavLink } from "@/components/nav-link";
import { LogoutButton } from "@/components/logout-button";
import type { Session } from "@/lib/session";

const NAV = [
  { href: "/dashboard", label: "Inicio" },
  { href: "/meetings", label: "Reuniones" },
  { href: "/repository", label: "Repositorio" },
  { href: "/settings/integrations", label: "Integraciones" },
];

export function AppShell({
  session,
  demoMode,
  children,
}: {
  session: Session;
  demoMode: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh">
      {demoMode ? (
        <div className="bg-review-600 px-4 py-1.5 text-center text-xs font-semibold text-white">
          Modo demostración · datos ficticios · las integraciones sin clave se simulan y aparecen rotuladas
        </div>
      ) : null}

      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
          <Link href="/dashboard" className="flex items-center gap-2">
            <span
              aria-hidden
              className="flex size-8 items-center justify-center rounded-lg bg-navy-600 text-sm font-bold text-white"
            >
              AP
            </span>
            <span className="text-base font-bold tracking-tight text-navy-600">ACTA PRO</span>
          </Link>

          <nav aria-label="Principal" className="flex flex-1 flex-wrap items-center gap-1">
            {NAV.map((item) => (
              <NavLink key={item.href} href={item.href}>
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-sm font-semibold text-ink">{session.profile.full_name}</p>
              <p className="text-xs text-ink-muted">{session.institution.name}</p>
            </div>
            {session.mode === "demo" ? <Badge tone="review">Sesión demo</Badge> : null}
            <LogoutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>

      <footer className="mx-auto max-w-6xl px-4 pb-10 text-xs leading-relaxed text-ink-subtle">
        ACTA PRO produce evidencia institucional trazable. No otorga validez legal automática: la validez del
        documento depende de las políticas de la institución y de la normativa aplicable. La firma dibujada en
        pantalla es una firma manuscrita digitalizada, no una firma electrónica cualificada.
      </footer>
    </div>
  );
}
