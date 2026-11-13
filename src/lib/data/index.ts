import { DemoRepository } from "@/lib/data/demo-repository";
import { SupabaseRepository } from "@/lib/data/supabase-repository";
import { resolveDataMode } from "@/lib/data/mode";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";
import type { Repository } from "@/lib/data/repository";

/**
 * Selecciona el repositorio activo según `resolveDataMode`.
 *
 * Con Supabase disponible se usa Postgres aunque DEMO_MODE siga en true: el
 * modo demo describe la ausencia de claves externas, no una base de datos
 * distinta. Si Supabase está configurado pero no responde, se continúa en
 * memoria solo cuando DEMO_MODE=true, y la interfaz lo advierte.
 */
export async function getRepository(): Promise<Repository> {
  const { mode } = await resolveDataMode();

  if (mode === "supabase") {
    const [db, admin] = [await createSupabaseServerClient(), createSupabaseAdminClient()];
    return new SupabaseRepository(db, admin);
  }

  return new DemoRepository();
}

export function isDemoRepository(repository: Repository) {
  return repository.kind === "demo";
}
