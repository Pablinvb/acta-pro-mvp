"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SignaturePad } from "@/components/signature-pad";
import { ACCEPTANCE_TEXT, ACCEPTANCE_TEXT_VERSION } from "@/lib/consent";
import type { ParticipantType } from "@/lib/types";

export interface Signer {
  id: string;
  name: string;
  role: ParticipantType;
  roleLabel: string;
}

interface DocumentResult {
  documentId: string;
  documentCode: string;
  sha256: string;
  contentSha256: string;
  downloadUrl: string;
}

export function SignPanel({
  minutesId,
  signers,
  alreadySigned,
  existingDocument,
  emailAvailable,
  representativeEmail,
}: {
  minutesId: string;
  signers: Signer[];
  alreadySigned: boolean;
  existingDocument: DocumentResult | null;
  emailAvailable: boolean;
  representativeEmail: string | null;
}) {
  const router = useRouter();
  const [drawings, setDrawings] = useState<Record<string, string | null>>({});
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [document, setDocument] = useState<DocumentResult | null>(existingDocument);
  const [emailState, setEmailState] = useState<{ sent: boolean; simulated: boolean; message: string } | null>(null);

  const required = signers.filter((signer) => signer.role === "teacher" || signer.role === "representative");
  const ready = required.every((signer) => drawings[signer.id] && accepted[signer.id]);

  async function generateDocument(): Promise<DocumentResult> {
    const response = await fetch(`/api/documents/${minutesId}/pdf`, { method: "POST" });
    const payload = (await response.json().catch(() => ({}))) as Partial<DocumentResult> & { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "No se pudo generar el PDF.");
    return payload as DocumentResult;
  }

  async function signAndGenerate() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/minutes/${minutesId}/signatures`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          signatures: required.map((signer) => ({
            signer_name: signer.name,
            signer_role: signer.role,
            signature_data_url: drawings[signer.id],
            accepted: true,
          })),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "No se pudieron registrar las firmas.");

      setDocument(await generateDocument());
      router.refresh();
    } catch (signError) {
      setError(signError instanceof Error ? signError.message : "No se pudo completar la firma.");
    } finally {
      setBusy(false);
    }
  }

  async function regenerate() {
    setBusy(true);
    setError(null);
    try {
      setDocument(await generateDocument());
      router.refresh();
    } catch (pdfError) {
      setError(pdfError instanceof Error ? pdfError.message : "No se pudo generar el PDF.");
    } finally {
      setBusy(false);
    }
  }

  async function sendEmail() {
    if (!document) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/emails/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ documentId: document.documentId, recipientEmail: representativeEmail }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        simulated?: boolean;
        preview?: { subject: string; to: string };
      };
      if (!response.ok) throw new Error(payload.error ?? "No se pudo enviar el correo.");

      setEmailState({
        sent: true,
        simulated: Boolean(payload.simulated),
        message: payload.simulated
          ? `Simulación de envío a ${payload.preview?.to ?? "el representante"}. No se envió ningún correo real.`
          : `Acta enviada a ${payload.preview?.to ?? "el representante"}.`,
      });
      router.refresh();
    } catch (emailError) {
      setError(emailError instanceof Error ? emailError.message : "No se pudo enviar el correo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {!alreadySigned ? (
        <Card>
          <CardHeader>
            <CardTitle>Firmas manuscritas digitalizadas</CardTitle>
            <CardDescription>
              Cada persona firma en este mismo dispositivo. La firma dibujada no es una firma electrónica
              cualificada; su valor depende de las políticas de la institución.
            </CardDescription>
          </CardHeader>
          <CardBody className="space-y-8">
            {required.map((signer) => (
              <div key={signer.id} className="space-y-3">
                <SignaturePad
                  label={`${signer.name} — ${signer.roleLabel}`}
                  disabled={busy}
                  onChange={(dataUrl) => setDrawings((current) => ({ ...current, [signer.id]: dataUrl }))}
                />
                <label className="flex cursor-pointer items-start gap-3 text-sm text-ink-muted">
                  <input
                    type="checkbox"
                    checked={Boolean(accepted[signer.id])}
                    onChange={(event) =>
                      setAccepted((current) => ({ ...current, [signer.id]: event.target.checked }))
                    }
                    className="mt-0.5 size-4 accent-[#0b1f66]"
                  />
                  <span>
                    {ACCEPTANCE_TEXT}
                    <span className="mt-1 block text-xs text-ink-subtle">
                      Versión del texto: <code className="font-mono">{ACCEPTANCE_TEXT_VERSION}</code>
                    </span>
                  </span>
                </label>
              </div>
            ))}

            {error ? (
              <Alert tone="danger" title="No se pudo completar la acción">
                {error}
              </Alert>
            ) : null}

            <Button size="lg" onClick={signAndGenerate} disabled={!ready || busy}>
              {busy ? "Procesando…" : "Firmar y generar PDF"}
            </Button>
          </CardBody>
        </Card>
      ) : null}

      {alreadySigned && !document ? (
        <Card>
          <CardHeader>
            <CardTitle>Acta firmada</CardTitle>
            <CardDescription>Las firmas están registradas. Genere el PDF para archivarlo.</CardDescription>
          </CardHeader>
          <CardBody className="space-y-4">
            {error ? (
              <Alert tone="danger" title="No se pudo generar el PDF">
                {error}
              </Alert>
            ) : null}
            <Button onClick={regenerate} disabled={busy}>
              {busy ? "Generando…" : "Generar PDF"}
            </Button>
          </CardBody>
        </Card>
      ) : null}

      {document ? (
        <Card>
          <CardHeader>
            <CardTitle>Documento generado</CardTitle>
            <CardDescription>
              Código {document.documentCode}. Guarde la huella para verificar después que el archivo no cambió.
            </CardDescription>
          </CardHeader>
          <CardBody className="space-y-4">
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                  SHA-256 del archivo PDF
                </dt>
                <dd className="mt-1 break-all font-mono text-xs text-ink">{document.sha256}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                  SHA-256 del contenido del acta
                </dt>
                <dd className="mt-1 break-all font-mono text-xs text-ink">{document.contentSha256}</dd>
              </div>
            </dl>

            <div className="flex flex-wrap gap-3">
              <ButtonLink href={document.downloadUrl} prefetch={false}>
                Descargar PDF
              </ButtonLink>
              <ButtonLink href={`/repository/${document.documentId}`} variant="secondary">
                Ver en el repositorio
              </ButtonLink>
              <Button variant="secondary" onClick={regenerate} disabled={busy}>
                Regenerar
              </Button>
            </div>

            <div className="border-t border-line pt-4">
              <p className="text-sm font-medium text-ink">Enviar al representante</p>
              <p className="mt-1 text-xs text-ink-muted">
                {representativeEmail
                  ? `Destinatario: ${representativeEmail}`
                  : "No hay correo registrado para el representante."}
                {emailAvailable ? "" : " El proveedor de correo no está configurado: se mostrará una simulación rotulada."}
              </p>
              <Button
                variant="secondary"
                className="mt-3"
                onClick={sendEmail}
                disabled={busy || !representativeEmail}
              >
                {emailAvailable ? "Enviar acta por correo" : "Ver simulación de envío"}
              </Button>
              {emailState ? (
                <Alert tone={emailState.simulated ? "review" : "verified"} className="mt-3">
                  {emailState.message}
                </Alert>
              ) : null}
            </div>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
