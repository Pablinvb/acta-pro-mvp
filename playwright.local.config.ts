import { defineConfig, devices } from "@playwright/test";

import { clavesExternas, pilaLocal } from "./tests/e2e-local/fixture";

/**
 * Recorrido funcional completo contra la pila **local** de Supabase y con
 * Anthropic **de verdad**.
 *
 * El otro recorrido (`playwright.config.ts`) corre en modo demostración, con
 * un repositorio en memoria: prueba la interfaz, no la integración. Este corre
 * contra Postgres, el bucket y el modelo reales, que es donde aparecen los
 * fallos que la demostración no puede ver.
 *
 * Consume una llamada a Anthropic por ejecución. Ninguna clave se imprime.
 *
 *   npm run test:e2e:local
 */
const PORT = Number(process.env.E2E_LOCAL_PORT ?? 3102);
const baseURL = `http://localhost:${PORT}`;

const pila = pilaLocal();
const claves = clavesExternas();

export default defineConfig({
  testDir: "./tests/e2e-local",
  globalSetup: "./tests/e2e-local/global-setup.ts",
  globalTeardown: "./tests/e2e-local/global-teardown.ts",
  // La generación real del borrador es el paso lento del recorrido: se le deja
  // margen sobre el plazo del propio modelo.
  timeout: 240_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: { baseURL, trace: "retain-on-failure", permissions: [] },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run build && npm run start -- --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: false,
    // La construcción de producción más el arranque no caben siempre en los
    // 300 s por defecto de la otra configuración.
    timeout: 600_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      // Sin modo demostración: se quiere la integración, no la simulación.
      DEMO_MODE: "false",
      NEXT_PUBLIC_SUPABASE_URL: pila.apiUrl,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: pila.anonKey,
      SUPABASE_SERVICE_ROLE_KEY: pila.serviceKey,
      // Claves reales de los servicios externos. Deepgram no llega a usarse
      // -el recorrido no graba audio- pero sin ella la aplicación se considera
      // mal configurada y redirige a la página de integraciones.
      ANTHROPIC_API_KEY: claves.ANTHROPIC_API_KEY ?? "",
      ANTHROPIC_MODEL: claves.ANTHROPIC_MODEL ?? "claude-sonnet-5",
      DEEPGRAM_API_KEY: claves.DEEPGRAM_API_KEY ?? "",
      NEXT_PUBLIC_APP_URL: baseURL,
    },
  },
});
