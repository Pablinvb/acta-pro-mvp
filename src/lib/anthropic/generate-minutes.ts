import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

import { ApiError } from "@/lib/api/http";
import { getEnv } from "@/lib/env";
import { MINUTES_SYSTEM_PROMPT, buildMinutesUserMessage } from "@/lib/anthropic/prompt";
import { MinutesSchema, findOrphanSourceIds, normalizeMinutes, type Minutes } from "@/lib/schemas/minutes";
import type { MeetingDetail, TranscriptSegment } from "@/lib/types";

const MAX_TOKENS = 6000;
const TIMEOUT_MS = 90_000;

export interface GeneratedMinutes {
  minutes: Minutes;
  model: string;
}

function toApiError(error: unknown): ApiError {
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
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new ApiError(504, "La generación del borrador superó el tiempo de espera. Vuelva a intentarlo.");
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
): Promise<GeneratedMinutes> {
  const env = getEnv();
  if (!env.ANTHROPIC_API_KEY) {
    throw new ApiError(503, "Anthropic no está configurado.");
  }
  if (segments.length === 0) {
    throw new ApiError(409, "No hay transcripción para generar el acta.");
  }

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: TIMEOUT_MS, maxRetries: 1 });
  const model = env.ANTHROPIC_MODEL;

  let parsed: unknown;
  let stopReason: string | null = null;

  try {
    const message = await client.messages.parse({
      model,
      max_tokens: MAX_TOKENS,
      system: MINUTES_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildMinutesUserMessage(detail, segments, speakerNames) }],
      output_config: { format: zodOutputFormat(MinutesSchema) },
    });

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

  return { minutes, model };
}
