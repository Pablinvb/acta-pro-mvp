import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
// `localhost` y no `127.0.0.1`: el servidor de desarrollo bloquea los recursos
// internos servidos a un origen distinto del suyo y la hidratación no ocurre.
const baseURL = `http://localhost:${PORT}`;

/**
 * La prueba end-to-end corre en modo demostración: sin Supabase, sin Deepgram,
 * sin Anthropic y sin Resend. Comprueba que el flujo completo funciona con las
 * alternativas rotuladas como simulación.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    permissions: [],
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      DEMO_MODE: "true",
      NEXT_PUBLIC_APP_URL: baseURL,
    },
  },
});
