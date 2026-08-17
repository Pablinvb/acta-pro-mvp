import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { transcribePrerecorded } from "@/lib/deepgram/prerecorded";
import { resetEnvCache } from "@/lib/env";
import { ApiError } from "@/lib/api/http";

const DEEPGRAM_RESPONSE = {
  metadata: { duration: 12.5 },
  results: {
    channels: [
      {
        alternatives: [
          {
            transcript: "Buenos días. Gracias por venir.",
            words: [
              { word: "buenos", punctuated_word: "Buenos", start: 0, end: 0.4, speaker: 0, confidence: 0.98 },
              { word: "días", punctuated_word: "días.", start: 0.4, end: 0.9, speaker: 0, confidence: 0.97 },
              { word: "gracias", punctuated_word: "Gracias", start: 1.2, end: 1.7, speaker: 1, confidence: 0.95 },
            ],
          },
        ],
      },
    ],
  },
};

function mockFetch(response: unknown, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 502,
    json: async () => response,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  process.env.DEEPGRAM_API_KEY = "clave-de-prueba";
  process.env.NEXT_PUBLIC_DEEPGRAM_MODEL = "nova-3";
  process.env.NEXT_PUBLIC_DEEPGRAM_LANGUAGE = "es-419";
  process.env.DEEPGRAM_DIARIZE_MODEL = "latest";
  process.env.DEEPGRAM_MIP_OPT_OUT = "true";
  resetEnvCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.DEEPGRAM_API_KEY;
  delete process.env.DEEPGRAM_DIARIZE_MODEL;
  resetEnvCache();
});

describe("DeepgramRecoveryService (pregrabado)", () => {
  it("normaliza la respuesta al esquema común de segmentos", async () => {
    mockFetch(DEEPGRAM_RESPONSE);

    const result = await transcribePrerecorded(new ArrayBuffer(8), "audio/webm");

    expect(result.duration).toBe(12.5);
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0]).toMatchObject({
      speaker: "speaker_0",
      text: "Buenos días.",
      isFinal: true,
    });
    expect(result.segments[1].speaker).toBe("speaker_1");
  });

  it("envía diarize_model y nunca diarize", async () => {
    const fetchMock = mockFetch(DEEPGRAM_RESPONSE);
    await transcribePrerecorded(new ArrayBuffer(8), "audio/webm");

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get("diarize_model")).toBe("latest");
    expect(url.searchParams.has("diarize")).toBe(false);
    expect(url.searchParams.get("model")).toBe("nova-3");
    expect(url.searchParams.get("language")).toBe("es-419");
    expect(url.searchParams.get("mip_opt_out")).toBe("true");
  });

  it("no expone la clave más allá del encabezado de autorización", async () => {
    const fetchMock = mockFetch(DEEPGRAM_RESPONSE);
    await transcribePrerecorded(new ArrayBuffer(8), "audio/webm");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain("clave-de-prueba");
    expect((init.headers as Record<string, string>).authorization).toBe("Token clave-de-prueba");
  });

  it("trata una diarización mal configurada como error del servidor", async () => {
    process.env.DEEPGRAM_DIARIZE_MODEL = "true";
    resetEnvCache();
    mockFetch(DEEPGRAM_RESPONSE);

    await expect(transcribePrerecorded(new ArrayBuffer(8), "audio/webm")).rejects.toThrow(ApiError);
  });

  it("convierte un fallo del proveedor en un error recuperable", async () => {
    mockFetch({}, false);
    await expect(transcribePrerecorded(new ArrayBuffer(8), "audio/webm")).rejects.toThrow(
      /no pudo procesar la grabación/,
    );
  });

  it("falla de forma explícita si no hay clave", async () => {
    delete process.env.DEEPGRAM_API_KEY;
    resetEnvCache();
    await expect(transcribePrerecorded(new ArrayBuffer(8), "audio/webm")).rejects.toThrow(/no está configurado/);
  });
});
