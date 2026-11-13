import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isSupabaseReachable, resetSupabaseProbe, resolveDataMode } from "@/lib/data/mode";
import { resetEnvCache } from "@/lib/env";

function configureSupabase() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://proyecto.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "clave-publicable";
  resetEnvCache();
}

function clearSupabase() {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  resetEnvCache();
}

const reachable = () => vi.fn().mockResolvedValue({ status: 200 });
const unreachable = () => vi.fn().mockRejectedValue(new TypeError("fetch failed"));

beforeEach(() => {
  resetSupabaseProbe();
  clearSupabase();
  delete process.env.DEMO_MODE;
  resetEnvCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetSupabaseProbe();
  clearSupabase();
  delete process.env.DEMO_MODE;
  resetEnvCache();
});

describe("resolveDataMode", () => {
  it("usa memoria cuando Supabase no está configurado y DEMO_MODE está activo", async () => {
    process.env.DEMO_MODE = "true";
    resetEnvCache();

    await expect(resolveDataMode()).resolves.toEqual({ mode: "demo", supabaseUnreachable: false });
  });

  it("falla de forma explícita sin Supabase y con DEMO_MODE desactivado", async () => {
    process.env.DEMO_MODE = "false";
    resetEnvCache();

    await expect(resolveDataMode()).rejects.toThrow(/DEMO_MODE=false/);
  });

  it("usa Postgres cuando Supabase responde", async () => {
    configureSupabase();
    process.env.DEMO_MODE = "true";
    resetEnvCache();
    vi.stubGlobal("fetch", reachable());

    await expect(resolveDataMode()).resolves.toEqual({ mode: "supabase", supabaseUnreachable: false });
  });

  it("cae a memoria, avisando, si Supabase está configurado pero no responde", async () => {
    configureSupabase();
    process.env.DEMO_MODE = "true";
    resetEnvCache();
    vi.stubGlobal("fetch", unreachable());

    await expect(resolveDataMode()).resolves.toEqual({ mode: "demo", supabaseUnreachable: true });
  });

  it("no sustituye datos reales por ficticios cuando DEMO_MODE=false", async () => {
    configureSupabase();
    process.env.DEMO_MODE = "false";
    resetEnvCache();
    vi.stubGlobal("fetch", unreachable());

    // Sigue apuntando a Supabase para que el fallo se vea tal cual es.
    await expect(resolveDataMode()).resolves.toEqual({ mode: "supabase", supabaseUnreachable: true });
  });

  it("considera alcanzable cualquier respuesta HTTP, incluido un 401", async () => {
    configureSupabase();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 401 }));

    await expect(isSupabaseReachable()).resolves.toBe(true);
  });

  it("cachea la sonda en lugar de consultar en cada petición", async () => {
    configureSupabase();
    const fetchMock = reachable();
    vi.stubGlobal("fetch", fetchMock);

    await isSupabaseReachable();
    await isSupabaseReachable();
    await isSupabaseReachable();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("consulta el endpoint de salud con la clave publicable y un plazo acotado", async () => {
    configureSupabase();
    const fetchMock = reachable();
    vi.stubGlobal("fetch", fetchMock);

    await isSupabaseReachable();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://proyecto.supabase.co/auth/v1/health");
    expect((init.headers as Record<string, string>).apikey).toBe("clave-publicable");
    expect(init.signal).toBeDefined();
  });

  it("no sondea nada si Supabase no está configurado", async () => {
    const fetchMock = reachable();
    vi.stubGlobal("fetch", fetchMock);

    await expect(isSupabaseReachable()).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
