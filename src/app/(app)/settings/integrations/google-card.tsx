"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";

export function GoogleCalendarCard({
  configured,
  connected,
  demo,
  calendarId,
}: {
  configured: boolean;
  connected: boolean;
  demo: boolean;
  calendarId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function sync() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/integrations/google/sync", { method: "POST" });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        imported?: number;
        updated?: number;
        skipped?: number;
      };
      if (!response.ok) throw new Error(payload.error ?? "No se pudo sincronizar.");
      setResult(
        `Importadas ${payload.imported ?? 0}, actualizadas ${payload.updated ?? 0}, omitidas ${payload.skipped ?? 0}.`,
      );
      router.refresh();
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "No se pudo sincronizar.");
    } finally {
      setBusy(false);
    }
  }

  const status = !configured ? (demo ? "Modo demostración" : "Falta configurar") : connected ? "Conectado" : "Configurado";

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>Google Calendar</CardTitle>
        <Badge tone={connected ? "verified" : configured ? "info" : "review"}>{status}</Badge>
      </CardHeader>
      <CardBody className="space-y-3">
        <p className="text-sm text-ink-muted">Importa reuniones ya programadas en el calendario del docente.</p>
        <p className="text-sm leading-relaxed text-ink">
          Solo se importan eventos cuyo título empiece por <code className="font-mono">ACTA PRO:</code> o que tengan
          la propiedad privada <code className="font-mono">actaPro=true</code>. No se copian descripciones ni eventos
          personales. Calendario: <span className="font-mono">{calendarId}</span>.
        </p>

        {!configured ? (
          <p className="text-xs text-ink-subtle">
            Variables:{" "}
            <span className="font-mono">
              GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, TOKEN_ENCRYPTION_KEY
            </span>
          </p>
        ) : (
          <div className="flex flex-wrap gap-3">
            <ButtonLink href="/api/integrations/google/start" prefetch={false} variant="secondary" size="sm">
              {connected ? "Reconectar cuenta" : "Conectar cuenta"}
            </ButtonLink>
            <Button size="sm" onClick={sync} disabled={busy || !connected}>
              {busy ? "Sincronizando…" : "Sincronizar reuniones"}
            </Button>
          </div>
        )}

        {result ? <Alert tone="verified">{result}</Alert> : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}
      </CardBody>
    </Card>
  );
}
