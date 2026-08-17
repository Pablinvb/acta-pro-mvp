import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Pruebas smoke contra las APIs reales.
 * Se ejecutan aparte (`npm run test:smoke`) y cada una se omite sola si falta
 * su credencial, para que nunca formen parte del pipeline por accidente.
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/smoke/**/*.test.ts"],
    testTimeout: 60_000,
  },
});
