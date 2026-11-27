import { signatureMethodLabel } from "@/lib/signature-method";
import type { Metadata } from "next";

import { Alert } from "@/components/ui/alert";
import { MeetingHeader } from "@/components/meeting-header";
import { SignPanel, type Signer } from "@/app/(app)/meetings/[id]/sign/sign-panel";
import { loadMeeting, requireStage } from "@/app/(app)/meetings/[id]/meeting-context";
import { isResendConfigured } from "@/lib/env";
import { contentFingerprint, buildDocumentCode } from "@/lib/pdf/render";

export const metadata: Metadata = { title: "Firmas y PDF" };

const ROLE_LABEL: Record<string, string> = {
  teacher: "Docente",
  representative: "Representante",
  student: "Estudiante",
  other: "Otra persona participante",
};

export default async function SignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { session, detail } = await loadMeeting(id);
  requireStage(detail, "approved");

  const record = await session.repository.getLatestMinutes(id);
  if (!record) {
    return (
      <div className="space-y-8">
        <MeetingHeader detail={detail} current="sign" />
        <Alert tone="danger" title="No hay acta aprobada">
          Genere y apruebe el acta antes de firmar.
        </Alert>
      </div>
    );
  }

  const [signatures, documents] = await Promise.all([
    session.repository.listSignatures(record.id),
    session.repository.listDocuments(detail.institution.id, { studentId: detail.student.id }),
  ]);

  const signers: Signer[] = detail.participants
    .filter((participant) => participant.participant_type !== "student")
    .map((participant) => ({
      id: participant.id,
      name: participant.display_name,
      role: participant.participant_type,
      roleLabel: ROLE_LABEL[participant.participant_type] ?? "Participante",
    }));

  const existing = documents.find((item) => item.document.minutes_id === record.id)?.document ?? null;
  const content = record.edited_content ?? record.content;

  const existingDocument = existing
    ? {
        documentId: existing.id,
        documentCode: existing.document_code,
        sha256: existing.sha256,
        contentSha256: contentFingerprint({
          documentCode: buildDocumentCode(detail, record.version),
          version: record.version,
          meetingId: id,
          content,
          signerNames: signatures.map((signature) => signature.signer_name),
        }),
        downloadUrl: `/api/documents/download/${existing.id}`,
      }
    : null;

  const representativeEmail = detail.representatives.find((rep) => rep.email)?.email ?? null;
  const hasRepresentative = signers.some((signer) => signer.role === "representative");

  return (
    <div className="space-y-8">
      <MeetingHeader detail={detail} current="sign" />

      {signatures.length > 0 && (
        <ul aria-label="Verificación de las firmas">
          {signatures.map((signature) => (
            <li key={signature.id}>{signature.signer_name} · {signatureMethodLabel(signature.verification_method)}</li>
          ))}
        </ul>
      )}
      {!hasRepresentative ? (
        <Alert tone="danger" title="Falta el representante entre los participantes">
          El acta requiere la firma de la persona docente y la del representante. Vuelva al paso de participantes.
        </Alert>
      ) : (
        <SignPanel
          verifyIdentity={session.mode === "supabase"}
          minutesId={record.id}
          signers={signers}
          alreadySigned={signatures.length > 0}
          existingDocument={existingDocument}
          emailAvailable={isResendConfigured()}
          representativeEmail={representativeEmail}
        />
      )}
    </div>
  );
}
