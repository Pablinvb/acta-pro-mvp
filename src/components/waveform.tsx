"use client";

import { useEffect, useMemo, useRef } from "react";

import { cn } from "@/lib/utils";

/**
 * Forma de onda en vivo del micrófono.
 *
 * Solo visualiza: lee el nivel de audio con un AnalyserNode y no graba ni
 * envía nada. Si el navegador no expone AudioContext, no se dibuja nada y la
 * grabación continúa igual.
 */
export function LiveWaveform({
  stream,
  active,
  bars = 64,
  className,
}: {
  stream: MediaStream | null;
  active: boolean;
  bars?: number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const levelsRef = useRef<number[]>(new Array(bars).fill(0));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    const AudioContextCtor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    let audioContext: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let data: Uint8Array<ArrayBuffer> | null = null;

    if (stream && AudioContextCtor) {
      audioContext = new AudioContextCtor();
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.75;
      source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      data = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
    }

    const draw = () => {
      frameRef.current = requestAnimationFrame(draw);

      const ratio = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      if (canvas.width !== Math.floor(rect.width * ratio)) {
        canvas.width = Math.floor(rect.width * ratio);
        canvas.height = Math.floor(rect.height * ratio);
      }

      const width = rect.width;
      const height = rect.height;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);

      let amplitude = 0;
      if (analyser && data) {
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (let index = 0; index < data.length; index += 1) {
          peak = Math.max(peak, Math.abs(data[index] - 128) / 128);
        }
        amplitude = peak;
      }

      // Desplazamiento tipo osciloscopio: la muestra nueva entra por la derecha.
      const levels = levelsRef.current;
      levels.shift();
      levels.push(active ? amplitude : 0);

      const gap = 2;
      const barWidth = Math.max(1.5, width / levels.length - gap);
      const gradient = context.createLinearGradient(0, 0, width, 0);
      gradient.addColorStop(0, "#1f6feb");
      gradient.addColorStop(0.5, "#4d93ff");
      gradient.addColorStop(1, "#7cb0ff");
      context.fillStyle = active ? gradient : "#1b2c50";

      levels.forEach((level, index) => {
        const barHeight = Math.max(2, level * height * 0.92);
        const x = index * (barWidth + gap);
        const y = (height - barHeight) / 2;
        context.beginPath();
        context.roundRect(x, y, barWidth, barHeight, barWidth / 2);
        context.fill();
      });
    };

    draw();

    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      source?.disconnect();
      analyser?.disconnect();
      void audioContext?.close();
    };
  }, [stream, active, bars]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={active ? "Nivel de audio del micrófono en tiempo real" : "Micrófono inactivo"}
      className={cn("h-14 w-full", className)}
    />
  );
}

/**
 * Forma de onda estática y determinística, derivada de un texto.
 * Representa una intervención ya transcrita; no reproduce audio, porque el
 * audio no se conserva.
 */
export function StaticWaveform({
  seed,
  color = "var(--color-brand-500)",
  bars = 48,
  className,
}: {
  seed: string;
  color?: string;
  bars?: number;
  className?: string;
}) {
  const heights = useMemo(() => {
    // Hash simple y estable: la misma intervención dibuja siempre lo mismo.
    let hash = 2166136261;
    for (let index = 0; index < seed.length; index += 1) {
      hash ^= seed.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }

    const values: number[] = [];
    for (let index = 0; index < bars; index += 1) {
      hash ^= hash << 13;
      hash ^= hash >>> 17;
      hash ^= hash << 5;
      const normalized = Math.abs(hash % 1000) / 1000;
      // Envolvente suave en los extremos: parece una voz y no ruido plano.
      const envelope = Math.sin((index / bars) * Math.PI) * 0.55 + 0.45;
      values.push(Math.max(0.12, normalized * envelope));
    }
    return values;
  }, [seed, bars]);

  return (
    <div
      aria-hidden
      className={cn("flex h-8 w-full items-center gap-[2px]", className)}
      style={{ color }}
    >
      {heights.map((height, index) => (
        <span
          key={index}
          className="flex-1 rounded-full bg-current"
          style={{ height: `${Math.round(height * 100)}%`, opacity: 0.35 + height * 0.65 }}
        />
      ))}
    </div>
  );
}

