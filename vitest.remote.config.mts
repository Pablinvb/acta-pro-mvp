import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Verificación contra un proyecto **remoto** ya migrado.
 *
 * Separada de las demás configuraciones a propósito: `npm test` y
 * `test:integration` no deben poder arrastrar estas pruebas por descuido. Solo
 * se ejecutan nombrando este archivo y con `ACTA_VERIFY_REMOTE` apuntando al
 * proyecto, de modo que hace falta decir dos veces que se quiere.
 *
 *   ACTA_VERIFY_REMOTE=<referencia> npx vitest run -c vitest.remote.config.mts
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/remote/**/*.test.ts"],
    testTimeout: 180_000,
    hookTimeout: 180_000,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
