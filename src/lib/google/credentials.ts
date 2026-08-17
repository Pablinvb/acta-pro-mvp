import { isSupabaseConfigured } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export interface StoredGoogleCredentials {
  profile_id: string;
  access_token_encrypted: string;
  refresh_token_encrypted: string | null;
  expiry_date: number | null;
  scope: string | null;
}

/**
 * Almacén de credenciales de Google.
 *
 * Con Supabase configurado se guarda en la tabla `google_credentials`; sin él,
 * en memoria del proceso (solo válido para la demostración). Los tokens ya
 * llegan cifrados con AES-256-GCM: este módulo nunca ve el valor en claro.
 */
const globalRef = globalThis as unknown as { __actaProGoogleCreds?: Map<string, StoredGoogleCredentials> };

function memoryStore() {
  if (!globalRef.__actaProGoogleCreds) globalRef.__actaProGoogleCreds = new Map();
  return globalRef.__actaProGoogleCreds;
}

export async function saveGoogleCredentials(credentials: StoredGoogleCredentials): Promise<void> {
  if (!isSupabaseConfigured()) {
    memoryStore().set(credentials.profile_id, credentials);
    return;
  }
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("google_credentials").upsert(credentials, { onConflict: "profile_id" });
  if (error) throw new Error(`No se pudieron guardar las credenciales de Google: ${error.message}`);
}

export async function getGoogleCredentials(profileId: string): Promise<StoredGoogleCredentials | null> {
  if (!isSupabaseConfigured()) {
    return memoryStore().get(profileId) ?? null;
  }
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("google_credentials")
    .select("*")
    .eq("profile_id", profileId)
    .maybeSingle();
  return (data as StoredGoogleCredentials) ?? null;
}

export async function deleteGoogleCredentials(profileId: string): Promise<void> {
  if (!isSupabaseConfigured()) {
    memoryStore().delete(profileId);
    return;
  }
  const admin = createSupabaseAdminClient();
  await admin.from("google_credentials").delete().eq("profile_id", profileId);
}
