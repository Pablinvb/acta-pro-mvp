"use client";

import {
  groupWordsBySpeaker,
  segmentKey,
  type DeepgramWord,
  type NormalizedSegment,
} from "@/lib/deepgram/segments";

export type LiveState = "idle" | "connecting" | "open" | "reconnecting" | "finalizing" | "closed" | "error";

export interface LiveTranscriptEvents {
  onState: (state: LiveState, detail?: string) => void;
  onInterim: (text: string) => void;
  onSegments: (segments: NormalizedSegment[]) => void;
}

interface DeepgramResultMessage {
  type?: string;
  is_final?: boolean;
  speech_final?: boolean;
  channel?: { alternatives?: { transcript?: string; words?: DeepgramWord[] }[] };
}

const KEEPALIVE_INTERVAL_MS = 4000;
const FINALIZE_TIMEOUT_MS = 6000;

/**
 * LiveTranscriptService: conexión de transcripción en vivo con Deepgram.
 *
 * - Pide al backend un token temporal; la clave de Deepgram nunca llega aquí.
 * - Envía los Blob de MediaRecorder tal cual, en binario y sin base64.
 * - Distingue texto provisional (interim) de segmentos finales, y solo entrega
 *   como definitivos los `is_final`.
 * - Deduplica por hablante y rango temporal.
 * - Permite una única reconexión automática con un token nuevo.
 */
export class LiveTranscriptService {
  private socket: WebSocket | null = null;
  private keepAlive: ReturnType<typeof setInterval> | null = null;
  private readonly seen = new Set<string>();
  private segments: NormalizedSegment[] = [];
  private reconnectsLeft = 1;
  private closing = false;
  private state: LiveState = "idle";

  constructor(
    private readonly meetingId: string,
    private readonly events: LiveTranscriptEvents,
  ) {}

  getSegments(): NormalizedSegment[] {
    return this.segments;
  }

  getState(): LiveState {
    return this.state;
  }

  private setState(state: LiveState, detail?: string) {
    this.state = state;
    this.events.onState(state, detail);
  }

  private async requestToken(): Promise<{ access_token: string; expires_in: number }> {
    const response = await fetch("/api/integrations/deepgram/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ meetingId: this.meetingId }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? "No se pudo obtener el token de transcripción.");
    }
    return response.json();
  }

  private buildUrl(): string {
    const params = new URLSearchParams({
      model: process.env.NEXT_PUBLIC_DEEPGRAM_MODEL || "nova-3",
      language: process.env.NEXT_PUBLIC_DEEPGRAM_LANGUAGE || "es-419",
      smart_format: "true",
      punctuate: "true",
      interim_results: "true",
      // `diarize` está deprecado: se usa exclusivamente `diarize_model`.
      diarize_model: "latest",
      endpointing: "300",
      utterance_end_ms: "1200",
      vad_events: "true",
    });
    return `wss://api.deepgram.com/v1/listen?${params.toString()}`;
  }

  async connect(): Promise<void> {
    this.closing = false;
    this.setState(this.reconnectsLeft === 1 ? "connecting" : "reconnecting");

    const { access_token } = await this.requestToken();

    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(this.buildUrl(), ["bearer", access_token]);
      socket.binaryType = "arraybuffer";
      this.socket = socket;

      const timeout = setTimeout(() => reject(new Error("Tiempo de espera agotado al conectar.")), 10000);

      socket.onopen = () => {
        clearTimeout(timeout);
        this.setState("open");
        resolve();
      };

      socket.onerror = () => {
        clearTimeout(timeout);
        // El evento de error del WebSocket no expone detalles por seguridad.
        reject(new Error("No se pudo abrir la conexión de transcripción."));
      };

      socket.onmessage = (event) => this.handleMessage(event);

      socket.onclose = () => {
        clearTimeout(timeout);
        this.stopKeepAlive();
        if (this.closing) {
          this.setState("closed");
          return;
        }
        void this.handleUnexpectedClose();
      };
    });
  }

  private async handleUnexpectedClose() {
    if (this.reconnectsLeft <= 0) {
      this.setState("error", "La conexión de transcripción se cerró y no se pudo restablecer.");
      return;
    }
    this.reconnectsLeft -= 1;
    try {
      await this.connect();
    } catch (error) {
      this.setState("error", error instanceof Error ? error.message : "Fallo al reconectar.");
    }
  }

  private handleMessage(event: MessageEvent) {
    if (typeof event.data !== "string") return;

    let message: DeepgramResultMessage;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }

    if (message.type && message.type !== "Results") return;

    const alternative = message.channel?.alternatives?.[0];
    if (!alternative) return;

    if (!message.is_final) {
      this.events.onInterim(alternative.transcript ?? "");
      return;
    }

    this.events.onInterim("");
    const words = alternative.words ?? [];
    if (words.length === 0) return;

    const grouped = groupWordsBySpeaker(words, "live");
    let added = false;
    for (const segment of grouped) {
      const key = segmentKey(segment);
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      this.segments.push(segment);
      added = true;
    }

    if (added) {
      this.segments.sort((a, b) => a.start - b.start);
      this.segments = this.segments.map((segment, index) => ({ ...segment, id: `seg-${index + 1}` }));
      this.events.onSegments(this.segments);
    }
  }

  /** Envía un fragmento de audio tal cual lo entrega MediaRecorder. */
  async send(chunk: Blob) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(await chunk.arrayBuffer());
  }

  /** Mantiene viva la conexión mientras la grabación está en pausa. */
  startKeepAlive() {
    if (this.keepAlive) return;
    this.keepAlive = setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ type: "KeepAlive" }));
      }
    }, KEEPALIVE_INTERVAL_MS);
  }

  stopKeepAlive() {
    if (!this.keepAlive) return;
    clearInterval(this.keepAlive);
    this.keepAlive = null;
  }

  /**
   * Cierra ordenadamente: Finalize, espera el último resultado y CloseStream.
   * Devuelve los segmentos finales acumulados.
   */
  async finalize(): Promise<NormalizedSegment[]> {
    this.stopKeepAlive();
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.closing = true;
      this.setState("closed");
      return this.segments;
    }

    this.setState("finalizing");
    const before = this.segments.length;
    this.socket.send(JSON.stringify({ type: "Finalize" }));

    await new Promise<void>((resolve) => {
      const started = Date.now();
      const timer = setInterval(() => {
        const gotMore = this.segments.length > before;
        if (gotMore || Date.now() - started > FINALIZE_TIMEOUT_MS) {
          clearInterval(timer);
          resolve();
        }
      }, 200);
    });

    this.closing = true;
    this.socket.send(JSON.stringify({ type: "CloseStream" }));
    this.socket.close();
    this.socket = null;
    this.setState("closed");
    return this.segments;
  }

  /** Cierre abrupto, por ejemplo al desmontar el componente. */
  abort() {
    this.closing = true;
    this.stopKeepAlive();
    this.socket?.close();
    this.socket = null;
    this.setState("closed");
  }
}
