import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  REQUIRED_IN_PRODUCTION,
  getEnv,
  isDemoMode,
  missingRequiredVariables,
  resetEnvCache,
} from "@/lib/env";

const TOUCHED = [
  ...REQUIRED_IN_PRODUCTION,
  "DEMO_MODE",
  "DEEPGRAM_DIARIZE_MODEL",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_TIMEOUT_MS",
];

function clear() {
  for (const name of TOUCHED) delete process.env[name];
  resetEnvCache();
}

beforeEach(clear);
afterEach(clear);

describe("missingRequiredVariables", () => {
  it("no reclama nada en modo demostración, aunque falte todo", () => {
    process.env.DEMO_MODE = "true";
    resetEnvCache();

    expect(missingRequiredVariables()).toEqual([]);
  });

  it("nombra cada variable indispensable que falte con DEMO_MODE=false", () => {
    process.env.DEMO_MODE = "false";
    resetEnvCache();

    expect(missingRequiredVariables()).toEqual([...REQUIRED_IN_PRODUCTION]);
  });

  it("deja de reclamar las que ya están puestas", () => {
    process.env.DEMO_MODE = "false";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://proyecto.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "clave";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "servicio";
    process.env.DEEPGRAM_API_KEY = "deepgram";
    resetEnvCache();

    // Es justo el caso del despliegue: solo falta la clave de Anthropic.
    expect(missingRequiredVariables()).toEqual(["ANTHROPIC_API_KEY"]);
  });

  it("trata una variable en blanco como ausente", () => {
    process.env.DEMO_MODE = "false";
    process.env.ANTHROPIC_API_KEY = "   ";
    resetEnvCache();

    expect(missingRequiredVariables()).toContain("ANTHROPIC_API_KEY");
  });
});

describe("DEMO_MODE", () => {
  it("se activa por defecto para que la aplicación arranque sin claves", () => {
    expect(isDemoMode()).toBe(true);
  });

  it.each([
    ["false", false],
    ["0", false],
    ["no", false],
    ["true", true],
    ["1", true],
    ["sí", true],
  ])("interpreta %s como %s", (raw, expected) => {
    process.env.DEMO_MODE = raw;
    resetEnvCache();

    expect(isDemoMode()).toBe(expected);
  });
});

describe("valores por defecto", () => {
  it("fija nova-3, es-419 y diarize_model=latest sin configuración", () => {
    const env = getEnv();

    expect(env.NEXT_PUBLIC_DEEPGRAM_MODEL).toBe("nova-3");
    expect(env.NEXT_PUBLIC_DEEPGRAM_LANGUAGE).toBe("es-419");
    expect(env.DEEPGRAM_DIARIZE_MODEL).toBe("latest");
    expect(env.ANTHROPIC_MODEL).toBe("claude-sonnet-5");
  });

  it("el plazo de Anthropic cabe dentro del límite de 60 s de una función", () => {
    const env = getEnv();

    // No es una preferencia estética: si el plazo del SDK excede el de la
    // plataforma, la función muere antes de que el SDK se rinda y quien usa la
    // aplicación recibe un error de pasarela en vez de un mensaje legible.
    expect(env.ANTHROPIC_TIMEOUT_MS).toBe(45_000);
    expect(env.ANTHROPIC_TIMEOUT_MS).toBeLessThan(60_000);
  });

  it("se puede ampliar el plazo donde la plataforma lo permita", () => {
    process.env.ANTHROPIC_TIMEOUT_MS = "120000";
    resetEnvCache();

    expect(getEnv().ANTHROPIC_TIMEOUT_MS).toBe(120_000);
  });
});
