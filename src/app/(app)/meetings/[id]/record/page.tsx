import type { Metadata } from "next";

import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { MeetingHeader } from "@/components/meeting-header";
import { ConsentPanel } from "@/app/(app)/meetings/[id]/record/consent-panel";
import { Recorder } from "@/app/(app)/meetings/[id]/record/recorder";
import { loadMeeting, requireStage } from "@/app/(app)/meetings/[id]/meeting-context";
import { isDeepgramConfigured, isDemoMode } from "@/lib/env";
import { hasReached } from "@/lib/meeting-state";

export const metadata: Metadata = { title: "Consentimiento y grabación" };

export default async function RecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { detail } = await loadMeeting(id);
  requireStage(detail, "ready");

  const participants = detail.participants;
  const allGranted =
    participants.length > 0 && participants.every((participant) => participant.consent_status === "granted");
  const alreadyTranscribed = hasReached(detail.meeting.status, "processing");

  return (
    <div className="space-y-8">
      <MeetingHeader detail={detail} current="record" />

      {alreadyTranscribed ? (
        <Alert tone="verified" title="Esta reunión ya fue grabada">
          <p>La transcripción está guardada. Puede continuar con la asignación de hablantes.</p>
          <ButtonLink href={`/meetings/${id}/speakers`} size="sm" className="mt-3">
            Ir a hablantes
          </ButtonLink>
        </Alert>
      ) : null}

      {!allGranted ? (
        <ConsentPanel meetingId={id} participants={participants} />
      ) : (
        <>
          <Alert tone="verified" title="Consentimiento registrado">
            Todas las personas presentes autorizaron la grabación. Puede habilitar el micrófono.
          </Alert>
          <Recorder
            meetingId={id}
            liveTranscriptionAvailable={isDeepgramConfigured()}
            demoModeAvailable={isDemoMode()}
          />
        </>
      )}
    </div>
  );
}
