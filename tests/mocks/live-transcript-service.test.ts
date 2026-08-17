import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LiveTranscriptService, type LiveState } from "@/lib/deepgram/live-transcript-service";
import type { NormalizedSegment } from "@/lib/deepgram/segments";

/** WebSocket falso: registra lo enviado y permite inyectar mensajes. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static OPEN = 1;

  readyState = 1;
  binaryType = "arraybuffer";
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;

  constructor(
    readonly url: string,
    readonly protocols?: string[],
  ) {
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => this.onopen?.());
  }

  send(payload: unknown) {
    this.sent.push(payload);
  }

  close() {
    this.readyState = 3;
    this.onclose?.();
  }

  emit(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

function resultsMessage(isFinal: boolean, words: unknown[], transcript = "") {
  return {
    type: "Results",
    is_final: isFinal,
    channel: { alternatives: [{ transcript, words }] },
  };
}

const WORDS_A = [
  { word: "buenos", punctuated_word: "Buenos", start: 0, end: 0.4, speaker: 0, confidence: 0.98 },
  { word: "días", punctuated_word: "días.", start: 0.4, end: 0.9, speaker: 0, confidence: 0.97 },
];

let states: LiveState[];
let interims: string[];
let batches: NormalizedSegment[][];

function makeService(meetingId = "meeting-1") {
  states = [];
  interims = [];
  batches = [];
  return new LiveTranscriptService(meetingId, {
    onState: (state) => states.push(state),
    onInterim: (text) => interims.push(text),
    onSegments: (segments) => batches.push(segments.map((segment) => ({ ...segment }))),
  });
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "jwt-temporal", expires_in: 3600 }),
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LiveTranscriptService", () => {
  it("solicita el token al backend y lo usa como subprotocolo", async () => {
    const service = makeService();
    await service.connect();

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/integrations/deepgram/token",
      expect.objectContaining({ method: "POST" }),
    );

    const socket = FakeWebSocket.instances[0];
    expect(socket.protocols).toEqual(["bearer", "jwt-temporal"]);
    expect(states).toContain("open");
  });

  it("usa diarize_model y nunca diarize en la URL", async () => {
    const service = makeService();
    await service.connect();

    const url = new URL(FakeWebSocket.instances[0].url);
    expect(url.searchParams.get("diarize_model")).toBe("latest");
    expect(url.searchParams.has("diarize")).toBe(false);
    expect(url.searchParams.get("interim_results")).toBe("true");
    expect(url.searchParams.get("utterance_end_ms")).toBe("1200");
  });

  it("separa el texto provisional de los segmentos definitivos", async () => {
    const service = makeService();
    await service.connect();
    const socket = FakeWebSocket.instances[0];

    socket.emit(resultsMessage(false, WORDS_A, "Buenos dí"));
    expect(interims.at(-1)).toBe("Buenos dí");
    expect(service.getSegments()).toHaveLength(0);

    socket.emit(resultsMessage(true, WORDS_A));
    expect(service.getSegments()).toHaveLength(1);
    expect(service.getSegments()[0].text).toBe("Buenos días.");
    // Al confirmar, el texto provisional se limpia.
    expect(interims.at(-1)).toBe("");
  });

  it("deduplica resultados repetidos por hablante y rango", async () => {
    const service = makeService();
    await service.connect();
    const socket = FakeWebSocket.instances[0];

    socket.emit(resultsMessage(true, WORDS_A));
    socket.emit(resultsMessage(true, WORDS_A));

    expect(service.getSegments()).toHaveLength(1);
    expect(batches).toHaveLength(1);
  });

  it("envía KeepAlive mientras la grabación está en pausa", async () => {
    vi.useFakeTimers();
    try {
      const service = makeService();
      await service.connect();
      const socket = FakeWebSocket.instances[0];

      service.startKeepAlive();
      vi.advanceTimersByTime(9000);
      service.stopKeepAlive();

      const keepAlives = socket.sent.filter((item) => String(item).includes("KeepAlive"));
      expect(keepAlives.length).toBeGreaterThanOrEqual(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cierra con Finalize y luego CloseStream", async () => {
    const service = makeService();
    await service.connect();
    const socket = FakeWebSocket.instances[0];

    const finalizing = service.finalize();
    socket.emit(resultsMessage(true, WORDS_A));
    const segments = await finalizing;

    const messages = socket.sent.map((item) => String(item));
    expect(messages.some((message) => message.includes("Finalize"))).toBe(true);
    expect(messages.some((message) => message.includes("CloseStream"))).toBe(true);
    expect(messages.indexOf(messages.find((m) => m.includes("Finalize"))!)).toBeLessThan(
      messages.indexOf(messages.find((m) => m.includes("CloseStream"))!),
    );
    expect(segments).toHaveLength(1);
    expect(states.at(-1)).toBe("closed");
  });

  it("reconecta una sola vez ante un cierre inesperado", async () => {
    const service = makeService();
    await service.connect();

    FakeWebSocket.instances[0].onclose?.();
    await vi.waitFor(() => expect(FakeWebSocket.instances.length).toBe(2));
    expect(states).toContain("reconnecting");

    FakeWebSocket.instances[1].onclose?.();
    await vi.waitFor(() => expect(states.at(-1)).toBe("error"));
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("propaga un error legible si el backend no entrega el token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "Sin consentimiento registrado." }) }),
    );

    const service = makeService();
    await expect(service.connect()).rejects.toThrow("Sin consentimiento registrado.");
  });
});
