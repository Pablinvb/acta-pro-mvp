import { defineConfig, devices } from "@playwright/test";

// Puerto propio: si la prueba compartiera el del servidor de desarrollo,
// reutilizaría ese proceso y heredaría las claves reales de .env.local,
// con lo que dejaría de ser determinística.
const PORT = Number(process.env.E2E_PORT ?? 3101);
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
    // Build de producción, no `next dev`: es lo que corre en Vercel, y
    // además Next 16 impide levantar un segundo servidor de desarrollo
    // para el mismo proyecto, lo que hacía fallar la prueba si alguien
    // tenía el suyo abierto.
    command: `npm run build && npm run start -- --port ${PORT}`,
    url: baseURL,
    // Nunca se reutiliza un servidor ajeno: el entorno de abajo solo se
    // aplica cuando Playwright arranca el suyo.
    reuseExistingServer: false,
    timeout: 300_000,
    env: {
      DEMO_MODE: "true",
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
      ANTHROPIC_API_KEY: "",
      DEEPGRAM_API_KEY: "",
      RESEND_API_KEY: "",
      NEXT_PUBLIC_APP_URL: baseURL,
    },
  },
});
