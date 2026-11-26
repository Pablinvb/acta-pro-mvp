"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Badge, LiveBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MicIcon } from "@/components/icons";
import { LiveWaveform } from "@/components/waveform";
import { speakerColor } from "@/lib/speakers";
import { LiveTranscriptService, type LiveState } from "@/lib/deepgram/live-transcript-service";
import type { NormalizedSegment } from "@/lib/deepgram/segments";
import { formatClock } from "@/lib/utils";

type Phase = "idle" | "starting" | "recording" | "paused" | "processing" | "done";

const STATE_LABEL: Record<LiveState, string> = {
  idle: "Sin conectar",
  connecting: "Conectando…",
  open: "Transcribiendo en vivo",
  reconnecting: "Reconectando…",
  finalizing: "Cerrando la transcripción…",
  closed: "Conexión cerrada",
  error: "Transcripción en vivo no disponible",
};

const TIMESLICE_MS = 250;

/**
 * Tope del audio que se puede enviar al servidor en la recuperación.
 *
 * El camino normal no manda audio a ningún servidor propio: el navegador habla
 * con Deepgram directamente. Esta vía es el plan B de cuando la transcripción en
 * vivo no deja ni una intervención, y ahí sí viaja la grabación completa.
 *
 * El límite no es nuestro: las funciones de Netlify aceptan 6 MB de cuerpo y
 * codifican el binario en base64, lo que añade cerca de un 30 % y deja el tope
 * real en unos 4,5 MB. Pasado eso la plataforma rechaza la petición **antes** de
 * que llegue al código, de modo que sin esta comprobación el mensaje sería un
 * error de red sin explicación. A ~1 MB por minuto de audio en webm, son unos
 * cuatro minutos de grabación.
 */
const MAX_AUDIO_UPLOAD_BYTES = 4_000_000;

function pickMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
  if (typeof MediaRecorder === "undefined") return "";
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

export function Recorder({
  meetingId,
  liveTranscriptionAvailable,
  demoModeAvailable,
}: {
  meetingId: string;
  liveTranscriptionAvailable: boolean;
  demoModeAvailable: boolean;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [liveState, setLiveState] = useState<LiveState>("idle");
  const [liveDetail, setLiveDetail] = useState<string | null>(null);
  const [interim, setInterim] = useState("");
  const [segments, setSegments] = useState<NormalizedSegment[]>([]);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const serviceRef = useRef<LiveTranscriptService | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  const releaseDevices = useCallback(() => {
    recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    streamRef.current?.getTracks().forEach((track) => track.stop());
    recorderRef.current = null;
    streamRef.current = null;
    setStream(null);
  }, []);

  useEffect(
    () => () => {
      stopTimer();
      serviceRef.current?.abort();
      releaseDevices();
    },
    [releaseDevices, stopTimer],
  );

  async function callApi(path: string, body: unknown) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error ?? "No se pudo completar la operación.");
    }
    return response.json();
  }

  async function start() {
    setError(null);
    setNotice(null);
    setPhase("starting");

    try {
      await callApi(`/api/meetings/${meetingId}/recording`, { action: "start" });

      const media = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = media;
      setStream(media);

      const mimeType = pickMimeType();
      if (!mimeType) throw new Error("Este navegador no permite grabar en WebM/Opus.");

      if (liveTranscriptionAvailable) {
        const service = new LiveTranscriptService(meetingId, {
          onState: (state, detail) => {
            setLiveState(state);
            setLiveDetail(detail ?? null);
          },
          onInterim: setInterim,
          onSegments: (next) => setSegments([...next]),
        });
        serviceRef.current = service;
        try {
          await service.connect();
        } catch (connectionError) {
          // La grabación continúa: al finalizar se recupera desde el audio completo.
          serviceRef.current = null;
          setLiveState("error");
          setLiveDetail(connectionError instanceof Error ? connectionError.message : "Fallo de conexión.");
        }
      }

      chunksRef.current = [];
      const recorder = new MediaRecorder(media, { mimeType });
      recorder.ondataavailable = (event) => {
        if (event.data.size === 0) return;
        // Copia local: sostiene la recuperación si el streaming falla.
        chunksRef.current.push(event.data);
        void serviceRef.current?.send(event.data);
      };
      recorder.start(TIMESLICE_MS);
      recorderRef.current = recorder;

      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((value) => value + 1), 1000);
      setPhase("recording");
    } catch (startError) {
      releaseDevices();
      await callApi(`/api/meetings/${meetingId}/recording`, { action: "cancel" }).catch(() => undefined);
      setPhase("idle");
      setError(
        startError instanceof Error
          ? startError.message
          : "No se pudo iniciar la grabación. Revise los permisos del micrófono.",
      );
    }
  }

  function pause() {
    recorderRef.current?.pause();
    stopTimer();
    serviceRef.current?.startKeepAlive();
    setPhase("paused");
  }

  function resume() {
    recorderRef.current?.resume();
    serviceRef.current?.stopKeepAlive();
    timerRef.current = setInterval(() => setSeconds((value) => value + 1), 1000);
    setPhase("recording");
  }

  async function finish() {
    setPhase("processing");
    setError(null);
    stopTimer();

    try {
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        await new Promise<void>((resolve) => {
          recorder.onstop = () => resolve();
          recorder.stop();
        });
      }
      releaseDevices();

      const finalSegments = (await serviceRef.current?.finalize()) ?? [];

      if (finalSegments.length > 0) {
        await callApi(`/api/meetings/${meetingId}/transcript`, {
          source: "live",
          segments: finalSegments.map((segment) => ({
            speaker: segment.speaker,
            start: segment.start,
            end: segment.end,
            text: segment.text,
            confidence: segment.confidence,
          })),
        });
      }

      await callApi(`/api/meetings/${meetingId}/recording`, { action: "stop" });

      if (finalSegments.length === 0) {
        await recoverFromAudio();
      }

      setPhase("done");
      router.push(`/meetings/${meetingId}/speakers`);
      router.refresh();
    } catch (finishError) {
      setPhase("done");
      setError(
        finishError instanceof Error
          ? finishError.message
          : "La grabación terminó pero no se pudo procesar la transcripción.",
      );
    }
  }

  async function recoverFromAudio(options: { demo?: boolean } = {}) {
    const form = new FormData();
    form.append("meetingId", meetingId);
    // `source=demo` pide la transcripción ficticia aunque Deepgram esté
    // configurado: es el plan B que la interfaz ofrece de forma explícita.
    if (options.demo) form.append("source", "demo");
    if (!options.demo && chunksRef.current.length > 0) {
      const audio = new Blob(chunksRef.current, { type: "audio/webm" });
      if (audio.size > MAX_AUDIO_UPLOAD_BYTES) {
        throw new Error(
          `El audio grabado ocupa ${Math.round(audio.size / 1_000_000)} MB y el servidor no acepta ` +
            `envíos de más de ${Math.round(MAX_AUDIO_UPLOAD_BYTES / 1_000_000)} MB. ` +
            "La transcripción en vivo no dejó texto, así que no hay nada que recuperar por esta vía. " +
            "Puede cargar la transcripción de demostración y escribir el acta a mano.",
        );
      }
      form.append("audio", audio, "grabacion.webm");
    }

    const response = await fetch("/api/transcriptions/recover", { method: "POST", body: form });
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error ?? "No se pudo recuperar la transcripción.");
    }
    const payload = (await response.json()) as { simulated: boolean; segments: unknown[] };
    setNotice(
      payload.simulated
        ? "Se cargó la transcripción de demostración. No proviene del audio grabado."
        : `Transcripción recuperada desde el audio completo: ${payload.segments.length} intervenciones.`,
    );
  }

  /** Plan B de la demostración: no depende del micrófono ni de la red. */
  async function useDemoTranscript() {
    setError(null);
    setPhase("processing");
    try {
      await callApi(`/api/meetings/${meetingId}/recording`, { action: "start" }).catch(() => undefined);
      await callApi(`/api/meetings/${meetingId}/recording`, { action: "stop" }).catch(() => undefined);
      await recoverFromAudio({ demo: true });
      setPhase("done");
      router.push(`/meetings/${meetingId}/speakers`);
      router.refresh();
    } catch (demoError) {
      setPhase("idle");
      setError(
        demoError instanceof Error ? demoError.message : "No se pudo cargar la transcripción de demostración.",
      );
    }
  }

  const recording = phase === "recording" || phase === "paused";
  const speakerOrder = [...new Set(segments.map((segment) => segment.speaker))];

  return (
    <div className="space-y-6">
      {/* Consola de grabación: cronómetro, onda en vivo y controles. */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-4 border-b border-line bg-surface-inset/60 px-5 py-4">
          <span
            aria-hidden
            className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${
              phase === "recording" ? "bg-danger-soft text-danger-400" : "bg-brand-soft text-brand-300"
            }`}
          >
            <MicIcon />
          </span>

          <div>
            <p className="font-mono text-3xl font-semibold tabular-nums text-ink" aria-live="polite">
              {formatClock(seconds)}
            </p>
            <p className="text-xs text-ink-subtle">
              {phase === "recording"
                ? "Grabando"
                : phase === "paused"
                  ? "En pausa · la conexión se mantiene viva"
                  : phase === "processing"
                    ? "Procesando transcripción"
                    : "Listo para grabar"}
            </p>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            {phase === "recording" ? <LiveBadge /> : null}
            {liveTranscriptionAvailable ? (
              <Badge tone={liveState === "open" ? "verified" : liveState === "error" ? "review" : "info"}>
                {STATE_LABEL[liveState]}
              </Badge>
            ) : (
              <Badge tone="review">Transcripción simulada</Badge>
            )}
          </div>
        </div>

        <div className="px-5 py-4">
          <LiveWaveform stream={stream} active={phase === "recording"} />
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-4">
          {phase === "idle" ? (
            <Button onClick={start} size="lg">
              <MicIcon className="size-4.5" />
              Iniciar grabación
            </Button>
          ) : null}
          {phase === "starting" ? (
            <Button size="lg" disabled>
              Preparando…
            </Button>
          ) : null}
          {phase === "recording" ? (
            <>
              <Button onClick={pause} variant="secondary" size="lg">
                Pausar
              </Button>
              <Button onClick={finish} size="lg">
                Finalizar y transcribir
              </Button>
            </>
          ) : null}
          {phase === "paused" ? (
            <>
              <Button onClick={resume} size="lg">
                Reanudar
              </Button>
              <Button onClick={finish} variant="secondary" size="lg">
                Finalizar y transcribir
              </Button>
            </>
          ) : null}
          {phase === "processing" ? (
            <Button size="lg" disabled>
              Procesando transcripción…
            </Button>
          ) : null}

          {demoModeAvailable && !recording && phase !== "processing" ? (
            <Button onClick={useDemoTranscript} variant="ghost" size="lg" className="ml-auto">
              Cargar transcripción de demostración
            </Button>
          ) : null}
        </div>
      </Card>

      {!liveTranscriptionAvailable ? (
        <Alert tone="review" title="Transcripción en vivo no disponible">
          Deepgram no está configurado. Puede grabar igualmente: al finalizar se usará la transcripción de
          demostración, claramente rotulada como simulación.
        </Alert>
      ) : null}

      {liveDetail ? (
        <Alert tone="review">
          {liveDetail} La grabación continúa y se transcribirá desde el audio completo al finalizar.
        </Alert>
      ) : null}

      {error ? (
        <Alert tone="danger" title="No se pudo continuar">
          {error}
        </Alert>
      ) : null}
      {notice ? <Alert tone="review">{notice}</Alert> : null}

      <Card>
        <CardHeader>
          <CardTitle>Transcripción en vivo</CardTitle>
          <CardDescription>
            El texto provisional aparece atenuado y no se guarda. Solo se conservan las intervenciones confirmadas,
            con su hablante y su marca de tiempo.
          </CardDescription>
        </CardHeader>
        <CardBody>
          {segments.length === 0 && !interim ? (
            <p className="text-sm text-ink-muted">
              Todavía no hay intervenciones. Aparecerán aquí a medida que se confirmen.
            </p>
          ) : (
            <ol className="max-h-96 space-y-3 overflow-y-auto pr-1" aria-live="polite">
              {segments.map((segment) => (
                <li
                  key={segment.id}
                  className="rise-in rounded-xl border border-line bg-surface-inset/70 px-3 py-2.5"
                >
                  <p
                    className="flex items-center gap-1.5 text-xs font-semibold"
                    style={{ color: speakerColor(segment.speaker, speakerOrder) }}
                  >
                    <span aria-hidden className="size-1.5 rounded-full bg-current" />
                    {segment.speaker} · {formatClock(segment.start)}
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-ink">{segment.text}</p>
                </li>
              ))}
              {interim ? (
                <li className="rounded-xl border border-dashed border-line-strong px-3 py-2.5">
                  <p className="text-xs font-semibold text-ink-subtle">Provisional · no se guarda</p>
                  <p className="mt-1 text-sm italic leading-relaxed text-ink-subtle">{interim}</p>
                </li>
              ) : null}
            </ol>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
