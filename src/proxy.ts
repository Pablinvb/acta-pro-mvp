import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Proxy (antes `middleware`) con dos responsabilidades:
 * 1. Refrescar la sesión de Supabase cuando está configurado.
 * 2. Impedir que la aplicación funcione a medias: si DEMO_MODE=false y faltan
 *    variables indispensables, dirige a la página de configuración en lugar de
 *    continuar con simulaciones silenciosas.
 */

const REQUIRED = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "DEEPGRAM_API_KEY",
  "ANTHROPIC_API_KEY",
];

const TRUTHY = ["1", "true", "yes", "si", "sí"];

function demoModeEnabled() {
  const raw = process.env.DEMO_MODE;
  if (raw === undefined || raw.trim() === "") return true;
  return TRUTHY.includes(raw.trim().toLowerCase());
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (url && key) {
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    });
    // Refresca el token si está por vencer; no se registra ningún dato del usuario.
    await supabase.auth.getUser();
  }

  if (!demoModeEnabled()) {
    const missing = REQUIRED.filter((name) => !process.env[name]);
    const path = request.nextUrl.pathname;
    const exempt =
      path.startsWith("/settings") || path.startsWith("/api/health") || path.startsWith("/login");
    if (missing.length > 0 && !exempt) {
      const target = request.nextUrl.clone();
      target.pathname = "/settings/integrations";
      target.search = "?configuracion=incompleta";
      return NextResponse.redirect(target);
    }
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
