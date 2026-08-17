"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

/**
 * Firma manuscrita digitalizada.
 *
 * Es un trazo dibujado en pantalla que se guarda como imagen PNG. No es una
 * firma electrónica cualificada ni acredita la identidad de quien firma: su
 * valor depende de que la persona firme presencialmente y de las políticas de
 * la institución.
 */
export function SignaturePad({
  label,
  onChange,
  disabled = false,
  initialValue = null,
}: {
  label: string;
  onChange: (dataUrl: string | null) => void;
  disabled?: boolean;
  initialValue?: string | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const [hasStrokes, setHasStrokes] = useState(Boolean(initialValue));

  const prepareContext = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.lineWidth = 2.5;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#101828";
    return context;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.scale(ratio, ratio);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, rect.width, rect.height);

    if (initialValue) {
      const image = new Image();
      image.onload = () => context.drawImage(image, 0, 0, rect.width, rect.height);
      image.src = initialValue;
    }
  }, [initialValue]);

  function pointFrom(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    const context = prepareContext();
    if (!context) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    const { x, y } = pointFrom(event);
    context.beginPath();
    context.moveTo(x, y);
  }

  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || disabled) return;
    const context = prepareContext();
    if (!context) return;
    const { x, y } = pointFrom(event);
    context.lineTo(x, y);
    context.stroke();
    if (!hasStrokes) setHasStrokes(true);
  }

  function end() {
    if (!drawing.current) return;
    drawing.current = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    onChange(hasStrokes ? canvas.toDataURL("image/png") : null);
  }

  function clear() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const rect = canvas.getBoundingClientRect();
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, rect.width, rect.height);
    setHasStrokes(false);
    onChange(null);
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-ink">{label}</p>
      {/* El lienzo es blanco a propósito: la firma se imprime sobre el PDF. */}
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`Área de firma para ${label}`}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        className="h-40 w-full cursor-crosshair touch-none rounded-card border-2 border-dashed border-line-strong bg-white transition-colors hover:border-brand-500/60"
      />
      <div className="flex items-center justify-between">
        <p className="text-xs text-ink-subtle">Firme con el dedo, el lápiz digital o el ratón.</p>
        <Button type="button" size="sm" variant="ghost" onClick={clear} disabled={disabled || !hasStrokes}>
          Borrar firma
        </Button>
      </div>
    </div>
  );
}
