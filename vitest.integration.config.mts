import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Pruebas de integración contra el stack **local** de Supabase.
 *
 * Se ejecutan aparte porque necesitan Docker arriba, y no se omiten solas si
 * no lo está: fallan. Una prueba que se salta en silencio informa de un éxito
 * que nadie comprobó.
 *
 * Corren en serie: comparten la base y el bucket locales, y dos archivos
 * montando y retirando datos a la vez se estorbarían.
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
