import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { UnauthorizedError } from "@/lib/session";
import { InvalidTransitionError } from "@/lib/meeting-state";
import { NotFoundError, SigningError } from "@/lib/data/repository";
import { DocumentIntegrityError } from "@/lib/documents/generate";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function jsonError(status: number, error: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, ...extra }, { status });
}

/**
 * Traduce excepciones a respuestas seguras.
 * Nunca devuelve trazas, nombres de tablas ni contenido de la reunión.
 */
export function toErrorResponse(error: unknown) {
  if (error instanceof UnauthorizedError) return jsonError(401, error.message);
  if (error instanceof NotFoundError) return jsonError(404, "El recurso solicitado no existe.");
  if (error instanceof InvalidTransitionError) return jsonError(409, error.message);
  if (error instanceof SigningError) return jsonError(409, error.message);
  if (error instanceof DocumentIntegrityError) return jsonError(409, error.message);
  if (error instanceof ApiError) return jsonError(error.status, error.message);
  if (error instanceof ZodError) {
    return jsonError(400, "Los datos enviados no son válidos.", {
      issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    });
  }

  // Se registra el tipo de error, no su contenido: puede incluir datos de la reunión.
  console.error("[acta-pro] error no controlado:", error instanceof Error ? error.name : typeof error);
  return jsonError(500, "Ocurrió un error inesperado. Vuelva a intentarlo.");
}

/**
 * Límite de tasa en memoria, por proceso.
 * Suficiente para proteger los endpoints de IA en la demostración; para
 * producción con varias instancias debe sustituirse por un almacén compartido.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  if (bucket.count >= limit) {
    const seconds = Math.ceil((bucket.resetAt - now) / 1000);
    throw new ApiError(429, `Demasiadas solicitudes. Vuelva a intentarlo en ${seconds} segundos.`);
  }
  bucket.count += 1;
}

/** Solo para pruebas. */
export function resetRateLimits() {
  buckets.clear();
}

export async function readJson<T>(request: Request, schema: { parse: (input: unknown) => T }): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ApiError(400, "Se esperaba un cuerpo JSON válido.");
  }
  return schema.parse(body);
}
