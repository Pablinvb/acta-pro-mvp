import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getEnv } from "@/lib/env";

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
