import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // Los unitarios y dobles de proveedor también corren dentro del build de Netlify.
    // Siempre arrancan sin credenciales del despliegue.
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
      ANTHROPIC_API_KEY: "",
      DEEPGRAM_API_KEY: "",
      RESEND_API_KEY: "",
      EMAIL_FROM: "",
      DEMO_MODE: "true",
    },
    include: ["tests/unit/**/*.test.ts", "tests/mocks/**/*.test.ts"],
    // Las pruebas smoke tocan APIs reales y se ejecutan aparte con npm run test:smoke.
    exclude: ["tests/smoke/**", "tests/e2e/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts"],
      exclude: ["src/lib/supabase/**", "src/lib/**/*.d.ts"],
    },
  },
});
