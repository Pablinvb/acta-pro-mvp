import { getEnv, isDemoMode, isSupabaseConfigured } from "@/lib/env";

/**
 * Decide, en un solo lugar, de dónde salen los datos.
 *
 * Tener las variables de Supabase no garantiza que el proyecto exista: puede
 * estar pausado, borrado o la URL puede tener una errata. Antes se daba por
 * bueno que «configurado» equivalía a «disponible», y un proyecto caído dejaba
 * la aplicación sin forma de entrar: el acceso por Supabase fallaba y las
 * credenciales de demostración quedaban bloqueadas por tener precedencia.
 */
export type DataMode = "supabase" | "demo";

export interface DataModeResult {
  mode: DataMode;
  /** Supabase está configurado pero su API no responde. */
  supabaseUnreachable: boolean;
}

const PROBE_TIMEOUT_MS = 3000;
const PROBE_TTL_MS = 30_000;

interface Probe {
  reachable: boolean;
  checkedAt: number;
}

// La sonda se cachea por proceso: no se consulta en cada petición.
const globalRef = globalThis as unknown as { __actaProSupabaseProbe?: Probe };

/** Solo para pruebas: fuerza una nueva comprobación. */
export function resetSupabaseProbe() {
  delete globalRef.__actaProSupabaseProbe;
}

async function probeSupabase(url: string, key: string): Promise<boolean> {
  try {
    const response = await fetch(`${url.replace(/\/$/, "")}/auth/v1/health`, {
      headers: { apikey: key },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      cache: "no-store",
    });
    // Cualquier respuesta HTTP demuestra que el proyecto existe y responde.
    // Un 401 o 404 sigue siendo alcanzable; lo que descarta es un fallo de red.
    return response.status > 0;
  } catch {
    return false;
  }
}

export async function isSupabaseReachable(): Promise<boolean> {
  const env = getEnv();
  if (!isSupabaseConfigured(env)) return false;

  const cached = globalRef.__actaProSupabaseProbe;
  if (cached && Date.now() - cached.checkedAt < PROBE_TTL_MS) return cached.reachable;

  const reachable = await probeSupabase(
    env.NEXT_PUBLIC_SUPABASE_URL!,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
  globalRef.__actaProSupabaseProbe = { reachable, checkedAt: Date.now() };
  return reachable;
}

export async function resolveDataMode(): Promise<DataModeResult> {
  const env = getEnv();

  if (!isSupabaseConfigured(env)) {
    if (isDemoMode(env)) return { mode: "demo", supabaseUnreachable: false };
    throw new Error(
      "Supabase no está configurado y DEMO_MODE=false. Configure las variables o active el modo demostración.",
    );
  }

  if (await isSupabaseReachable()) {
    return { mode: "supabase", supabaseUnreachable: false };
  }

  // Con DEMO_MODE=true se continúa en memoria y la interfaz lo advierte.
  if (isDemoMode(env)) {
    return { mode: "demo", supabaseUnreachable: true };
  }

  // Con DEMO_MODE=false no se sustituyen datos reales por datos ficticios:
  // se sigue apuntando a Supabase para que el fallo se vea tal cual es.
  return { mode: "supabase", supabaseUnreachable: true };
}
