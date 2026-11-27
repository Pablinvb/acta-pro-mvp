import { groupWordsBySpeaker, type DeepgramWord, type NormalizedSegment } from "@/lib/deepgram/segments";
import { getEnv } from "@/lib/env";
import { ApiError } from "@/lib/api/http";

export interface PrerecordedResult {
  text: string;
  duration: number;
  segments: NormalizedSegment[];
}

interface DeepgramPrerecordedResponse {
  metadata?: { duration?: number };
  results?: {
    channels?: {
      alternatives?: { transcript?: string; words?: DeepgramWord[] }[];
    }[];
  };
}

/**
 * DeepgramRecoveryService: transcripción del audio completo.
 *
 * Es la ruta de recuperación cuando el streaming falla o quedan segmentos sin
 * confirmar. Devuelve exactamente el mismo esquema que la capa en vivo.
 */
export async function transcribePrerecorded(audio: ArrayBuffer | { url: string }, mimeType: string): Promise<PrerecordedResult> {
  const env = getEnv();
  if (!env.DEEPGRAM_API_KEY) {
    throw new ApiError(503, "Deepgram no está configurado.");
  }
  if (env.DEEPGRAM_DIARIZE_MODEL && env.DEEPGRAM_DIARIZE_MODEL !== "latest") {
    // `diarize=true` está deprecado; enviar ambos parámetros es un error de configuración.
    throw new ApiError(500, "Configuración de diarización inválida: use DEEPGRAM_DIARIZE_MODEL=latest.");
  }

  const params = new URLSearchParams({
    model: env.NEXT_PUBLIC_DEEPGRAM_MODEL,
    language: env.NEXT_PUBLIC_DEEPGRAM_LANGUAGE,
    smart_format: "true",
    punctuate: "true",
    diarize_model: env.DEEPGRAM_DIARIZE_MODEL,
  });
  if (env.DEEPGRAM_MIP_OPT_OUT) params.set("mip_opt_out", "true");

  const response = await fetch(`https://api.deepgram.com/v1/listen?${params.toString()}`, {
    method: "POST",
    headers: {
      authorization: `Token ${env.DEEPGRAM_API_KEY}`,
      "content-type": mimeType,
    },
    body: audio instanceof ArrayBuffer ? audio : JSON.stringify(audio),
  });

  if (!response.ok) {
    throw new ApiError(502, "El proveedor de transcripción no pudo procesar la grabación.");
  }

  const payload = (await response.json()) as DeepgramPrerecordedResponse;
  const alternative = payload.results?.channels?.[0]?.alternatives?.[0];
  const words = alternative?.words ?? [];

  return {
    text: alternative?.transcript ?? "",
    duration: payload.metadata?.duration ?? 0,
    segments: groupWordsBySpeaker(words),
  };
}
