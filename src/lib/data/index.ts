import { getEnv, isDemoMode, isSupabaseConfigured } from "@/lib/env";
import { DemoRepository } from "@/lib/data/demo-repository";
import { SupabaseRepository } from "@/lib/data/supabase-repository";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";
import type { Repository } from "@/lib/data/repository";

/**
 * Selecciona el repositorio activo.
 *
 * Con Supabase configurado se usa Postgres aunque DEMO_MODE siga en true: el
 * modo demo describe la ausencia de claves externas, no una base de datos
 * distinta. Sin Supabase, y solo si DEMO_MODE=true, se usa el repositorio en
 * memoria; en caso contrario se falla de forma explícita.
 */
export async function getRepository(): Promise<Repository> {
  const env = getEnv();
  if (isSupabaseConfigured(env)) {
    const [db, admin] = [await createSupabaseServerClient(), createSupabaseAdminClient()];
    return new SupabaseRepository(db, admin);
  }
  if (isDemoMode(env)) {
    return new DemoRepository();
  }
  throw new Error(
    "Supabase no está configurado y DEMO_MODE=false. Configure las variables o active el modo demostración.",
  );
}

export function isDemoRepository(repository: Repository) {
  return repository.kind === "demo";
}
