import { NextResponse } from "next/server";

import { getRepository } from "@/lib/data";
import { ApiError, toErrorResponse } from "@/lib/api/http";
import { getEnv } from "@/lib/env";
import { resetDemoState } from "@/lib/data/demo-repository";

export const runtime = "nodejs";

/**
 * Devuelve el escenario de demostración a sus datos semilla.
 *
 * Existe para que la prueba end-to-end y los ensayos de la demostración partan
 * siempre del mismo estado. Solo funciona con el repositorio en memoria: con
 * Supabase configurado responde 409 y no toca ningún dato real.
 */
export async function POST() {
  try {
    const repository = await getRepository();
    if (!getEnv().DEMO_MODE || repository.kind !== "demo") {
      throw new ApiError(409, "El reinicio solo está disponible con el repositorio de demostración en memoria.");
    }

    resetDemoState();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
