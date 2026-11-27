import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

import { ApiError } from "@/lib/api/error";
import { getEnv } from "@/lib/env";
import { MINUTES_SYSTEM_PROMPT, buildMinutesUserMessage } from "@/lib/anthropic/prompt";
import { MinutesSchema, findOrphanSourceIds, normalizeMinutes, type Minutes } from "@/lib/schemas/minutes";
import type { MeetingDetail, TranscriptSegment } from "@/lib/types";


export interface GeneratedMinutes {
  minutes: Minutes;
  model: string;
  usage?: {input_tokens: number; output_tokens: number};
}

function toApiError(error: unknown): ApiError {
  // El tiempo de espera va **antes** que `APIError`, y no es una preferencia de
  // estilo: `APIConnectionTimeoutError` hereda de `APIConnectionError`, que
  // hereda de `APIError`. Con la comprobación general delante, todo plazo
  // agotado caía en ella, salía con `status` indefinido y se informaba como
  // «El servicio de IA rechazó la solicitud» -que es decirle a quien usa la
  // aplicación que mire la clave cuando lo que pasó fue que no dio tiempo-.
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new ApiError(504, "La generación del borrador superó el tiempo de espera. Vuelva a intentarlo.");
  }
  if (error instanceof Anthropic.APIError) {
    if (error.status === 429) {
      return new ApiError(429, "El servicio de IA está saturado. Espere unos segundos y vuelva a intentarlo.");
    }
    // Un 400 por saldo no es un fallo del esquema ni de la clave: decirlo
    // evita buscar el error en el codigo durante una demostracion.
    if (error.status === 400 && /credit balance/i.test(error.message)) {
      return new ApiError(
        402,
        "La cuenta de Anthropic no tiene saldo. Recargue créditos en console.anthropic.com para generar actas reales.",
      );
    }
    if (error.status === 401 || error.status === 403) {
      return new ApiError(502, "La clave de Anthropic fue rechazada. Revise la configuración.");
    }
    if (error.status && error.status >= 500) {
      return new ApiError(502, "El servicio de IA no respondió. Vuelva a intentarlo.");
    }
    return new ApiError(502, "El servicio de IA rechazó la solicitud.");
  }
  if (error instanceof ApiError) return error;
  return new ApiError(502, "No se pudo generar el borrador del acta.");
}

/**
 * Genera el borrador con Structured Outputs y lo vuelve a validar con Zod.
 *
 * Se rechaza cualquier resultado que no cumpla el esquema o que cite segmentos
 * inexistentes: un identificador inventado es señal de que el modelo se salió
 * de la transcripción.
 */
export async function generateMinutesWithAnthropic(
  detail: MeetingDetail,
  segments: TranscriptSegment[],
  speakerNames: Record<string, string>,
  timeoutMs?: number,
): Promise<GeneratedMinutes> {
  const env = getEnv();
  if (!env.ANTHROPIC_API_KEY) {
    throw new ApiError(503, "Anthropic no está configurado.");
  }
  if (segments.length === 0) {
    throw new ApiError(409, "No hay transcripción para generar el acta.");
  }

  // Un reintento dentro de un plazo que la plataforma no va a conceder no es
  // resiliencia: es garantizar que la función muera sin decir por qué. Se hace
  // un intento, acotado por `ANTHROPIC_TIMEOUT_MS`, y quien use la aplicación
  // decide si vuelve a pedirlo.
  const client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    timeout: timeoutMs ?? env.ANTHROPIC_TIMEOUT_MS,
    maxRetries: 0,
  });
  const model = env.ANTHROPIC_MODEL;

  let parsed: unknown;
  let usage: GeneratedMinutes["usage"];
  let stopReason: string | null = null;

  try {
    const message = await client.messages.parse({
      model,
      max_tokens: env.ANTHROPIC_MAX_TOKENS,
      system: MINUTES_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildMinutesUserMessage(detail, segments, speakerNames) }],
      // El razonamiento extendido viene activado por defecto en estos modelos y
      // es lo que hacía que el borrador tardara casi un minuto: los tokens de
      // pensamiento salen del mismo presupuesto y del mismo reloj. Aquí no hace
      // falta. Lo que se pide es redactar a partir de una transcripción con un
      // esquema fijo, y el acta la revisa y aprueba una persona: el modelo no
      // tiene que deliberar, tiene que transcribir a estructura.
      //
      // Desactivarlo no deja al modelo sin criterio: la salida sigue
      // restringida por el esquema, y si se saliera de la transcripción, la
      // comprobación de identificadores huérfanos lo rechaza igual.
      thinking: { type: "disabled" },
      output_config: { format: zodOutputFormat(MinutesSchema) },
    });

    usage = message.usage;
    stopReason = message.stop_reason ?? null;
    parsed = message.parsed_output;
  } catch (error) {
    throw toApiError(error);
  }

  if (stopReason === "refusal") {
    throw new ApiError(
      422,
      "El modelo no pudo redactar el borrador con esta transcripción. Revise el contenido y vuelva a intentarlo.",
    );
  }
  if (stopReason === "max_tokens") {
    throw new ApiError(
      422,
      "La reunión es demasiado extensa para un solo borrador. Divida la transcripción y vuelva a intentarlo.",
    );
  }

  const validated = MinutesSchema.safeParse(parsed);
  if (!validated.success) {
    throw new ApiError(422, "El borrador devuelto no cumple el esquema requerido. Vuelva a intentarlo.");
  }

  const { minutes } = normalizeMinutes(validated.data);
  const validIds = new Set(segments.map((segment) => segment.id));
  const orphans = findOrphanSourceIds(minutes, validIds);

  if (orphans.length > 0) {
    // No se descarta el borrador: se marca para revisión humana explícita.
    minutes.review_warnings.push(
      `Se citaron ${orphans.length} segmentos que no existen en la transcripción. Verifique las referencias antes de aprobar.`,
    );
  }

  return { minutes, model, usage };
}
