import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { ActaProLogo } from "@/components/brand";
import { NavLink } from "@/components/nav-link";
import { LogoutButton } from "@/components/logout-button";
import {
  CalendarIcon,
  DocumentIcon,
  HomeIcon,
  PlugIcon,
  ShieldCheckIcon,
  TrackingIcon,
} from "@/components/icons";
import type { Session } from "@/lib/session";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: <HomeIcon /> },
  { href: "/meetings", label: "Reuniones", icon: <CalendarIcon /> },
  { href: "/repository", label: "Actas", icon: <DocumentIcon /> },
  { href: "/seguimiento", label: "Seguimiento", icon: <TrackingIcon /> },
  { href: "/settings/integrations", label: "Integraciones", icon: <PlugIcon /> },
];

function initials(fullName: string) {
  return fullName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

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
    <div className="min-h-dvh lg:grid lg:grid-cols-[17rem_1fr]">
      {/* Barra lateral fija en escritorio, navegación horizontal en pantallas pequeñas. */}
      <aside className="border-b border-line bg-surface/60 backdrop-blur lg:sticky lg:top-0 lg:h-dvh lg:border-b-0 lg:border-r">
        <div className="flex h-full flex-col gap-6 px-4 py-4 lg:px-5 lg:py-6">
          <Link href="/dashboard" className="flex items-center">
            <ActaProLogo />
          </Link>

          <nav aria-label="Principal" className="-mx-1 flex gap-1 overflow-x-auto lg:mx-0 lg:flex-col lg:overflow-visible">
            {NAV.map((item) => (
              <NavLink key={item.href} href={item.href} icon={item.icon} className="shrink-0 lg:shrink">
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="mt-auto hidden lg:block">
            <div className="rounded-card border border-line bg-surface-inset/80 px-3 py-3">
              <div className="flex items-center gap-3">
                <span
                  aria-hidden
                  className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-bold text-brand-300"
                >
                  {initials(session.profile.full_name)}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">{session.profile.full_name}</p>
                  <p className="truncate text-xs text-ink-subtle">{session.institution.name}</p>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between gap-2">
                {session.mode === "demo" ? (
                  <Badge tone="review">Sesión demo</Badge>
                ) : (
                  <Badge tone="verified">
                    <ShieldCheckIcon className="size-3.5" />
                    Sesión verificada
                  </Badge>
                )}
                <LogoutButton />
              </div>
            </div>
          </div>
        </div>
      </aside>

      <div className="flex min-h-dvh flex-col">
        {demoMode ? (
          <p className="border-b border-review-500/25 bg-review-soft px-4 py-1.5 text-center text-xs font-semibold text-review-400">
            Modo demostración · datos ficticios · las integraciones sin clave se simulan y aparecen rotuladas
          </p>
        ) : null}

        {/* En pantallas pequeñas la identidad de sesión vive en la cabecera. */}
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 lg:hidden">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink">{session.profile.full_name}</p>
            <p className="truncate text-xs text-ink-subtle">{session.institution.name}</p>
          </div>
          <LogoutButton />
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 lg:px-8">{children}</main>

        <footer className="mx-auto w-full max-w-6xl px-4 pb-10 text-xs leading-relaxed text-ink-subtle lg:px-8">
          ACTA PRO produce evidencia institucional trazable. No otorga validez legal automática: la validez del
          documento depende de las políticas de la institución y de la normativa aplicable. La firma dibujada en
          pantalla es una firma manuscrita digitalizada, no una firma electrónica cualificada.
        </footer>
      </div>
    </div>
  );
}
