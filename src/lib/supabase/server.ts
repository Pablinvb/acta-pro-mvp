import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getEnv, isSupabaseConfigured } from "@/lib/env";

/**
 * Cliente de Supabase ligado a la sesión de la petición.
 * Todas las consultas pasan por Row Level Security.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const env = getEnv();
  if (!isSupabaseConfigured(env)) {
    throw new Error("Supabase no está configurado. Revise /settings/integrations.");
  }
  const cookieStore = await cookies();

  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // `setAll` falla en Server Components de solo lectura; el middleware
          // ya refresca la sesión, así que se puede ignorar sin perder estado.
        }
      },
    },
  });
}

/**
 * Cliente con service role. Uso exclusivo del servidor y solo para
 * operaciones que RLS no puede resolver (almacenamiento privado y
 * sincronizaciones de sistema). Nunca debe importarse desde el cliente.
 */
export function createSupabaseAdminClient(): SupabaseClient {
  if (typeof window !== "undefined") {
    throw new Error("El cliente con service role no puede usarse en el navegador.");
  }
  const env = getEnv();
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.");
  }
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export const DOCUMENTS_BUCKET = "acta-documents";
