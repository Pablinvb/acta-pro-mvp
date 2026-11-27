import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

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

export { createSupabaseAdminClient, DOCUMENTS_BUCKET } from "./admin";
