import type { Metadata } from "next";

import { Alert } from "@/components/ui/alert";
import { MeetingHeader } from "@/components/meeting-header";
import { SpeakersForm } from "@/app/(app)/meetings/[id]/speakers/speakers-form";
import { loadMeeting, requireStage } from "@/app/(app)/meetings/[id]/meeting-context";

export const metadata: Metadata = { title: "Hablantes" };

export default async function SpeakersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { session, detail } = await loadMeeting(id);
  requireStage(detail, "processing");

  const segments = await session.repository.listSegments(id);
  const labels = [...new Set(segments.map((segment) => segment.speaker_label))].sort();

  const samples = labels.map((label) => ({
    label,
    count: segments.filter((segment) => segment.speaker_label === label).length,
    excerpt:
      segments
        .filter((segment) => segment.speaker_label === label)
        .sort((a, b) => b.text.length - a.text.length)[0]?.text ?? "",
    assignedTo: detail.participants.find((p) => p.speaker_label === label)?.id ?? "",
  }));

  return (
    <div className="space-y-8">
      <MeetingHeader detail={detail} current="speakers" />

      <Alert tone="review" title="La identificación de voz no es biométrica">
        El sistema separa la conversación en hablantes distintos (<code>speaker_0</code>, <code>speaker_1</code>…),
        pero no reconoce quién es cada persona. Usted confirma la correspondencia y puede corregirla cuando quiera.
      </Alert>

      {segments.length === 0 ? (
        <Alert tone="danger" title="No hay transcripción">
          No se guardaron intervenciones para esta reunión. Vuelva al paso de grabación e intente de nuevo.
        </Alert>
      ) : (
        <SpeakersForm meetingId={id} speakers={samples} participants={detail.participants} />
      )}
    </div>
  );
}
