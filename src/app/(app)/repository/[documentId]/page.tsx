import { signatureMethodLabel } from "@/lib/signature-method";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { AuditTrail } from "@/components/audit-trail";
import { requireSession } from "@/lib/session";
import { formatDateTime } from "@/lib/utils";
import { contentFingerprint, buildDocumentCode } from "@/lib/pdf/render";

export const metadata: Metadata = { title: "Documento" };

export default async function DocumentPage({ params }: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await params;
  const session = await requireSession();

  const document = await session.repository.getDocument(documentId);
  if (!document) notFound();

  const detail = await session.repository.getMeetingDetail(document.meeting_id);
  if (!detail || detail.meeting.institution_id !== session.institution.id) notFound();

  const [minutes, audit] = await Promise.all([
    session.repository.getMinutes(document.minutes_id),
    session.repository.listAudit(document.meeting_id),
  ]);
  const signatures = minutes ? await session.repository.listSignatures(minutes.id) : [];

  const fingerprint =
    minutes &&
    contentFingerprint({
      documentCode: buildDocumentCode(detail, minutes.version),
      version: minutes.version,
      meetingId: document.meeting_id,
      content: minutes.edited_content ?? minutes.content,
      signerNames: signatures.map((signature) => signature.signer_name),
    });

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <Link href="/repository" className="text-sm font-medium text-brand-400 hover:text-brand-300 hover:underline">
          ← Repositorio
        </Link>
        <h1 className="text-2xl font-bold tracking-tight text-ink">{detail.meeting.title}</h1>
        <p className="text-sm text-ink-muted">
          {detail.student.full_name} · {formatDateTime(document.created_at)}
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Badge tone="info">{document.document_code}</Badge>
          <Badge tone="neutral">Versión {document.version}</Badge>
          {document.sent_at ? <Badge tone="verified">Enviada el {formatDateTime(document.sent_at)}</Badge> : null}
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Trazabilidad del documento</CardTitle>
          </CardHeader>
          <CardBody className="space-y-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                SHA-256 del archivo PDF
              </p>
              <p className="mt-1 break-all font-mono text-xs text-ink">{document.sha256}</p>
              <p className="mt-1 text-xs text-ink-muted">
                Compárela con la huella del archivo descargado para comprobar que no fue alterado.
              </p>
            </div>

            {fingerprint ? (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                  SHA-256 del contenido del acta
                </p>
                <p className="mt-1 break-all font-mono text-xs text-ink">{fingerprint}</p>
                <p className="mt-1 text-xs text-ink-muted">
                  Es la huella impresa dentro del PDF. Se recalcula desde la versión almacenada del acta.
                </p>
              </div>
            ) : null}

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">Firmas registradas</p>
              {signatures.length === 0 ? (
                <p className="mt-1 text-sm text-ink-muted">No consta</p>
              ) : (
                <ul className="mt-2 space-y-1 text-sm text-ink-muted">
                  {signatures.map((signature) => (
                    <li key={signature.id}>
                      {signature.signer_name} · {formatDateTime(signature.signed_at)} · texto{" "}
                      {signature.acceptance_text_version} · {signatureMethodLabel(signature.verification_method)}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex flex-wrap gap-3">
              <ButtonLink href={`/api/documents/download/${document.id}`} prefetch={false}>
                Descargar PDF
              </ButtonLink>
              <ButtonLink href={`/meetings/${document.meeting_id}`} variant="secondary">
                Ver la reunión
              </ButtonLink>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Historial de auditoría</CardTitle>
          </CardHeader>
          <CardBody>
            <AuditTrail entries={audit} />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
