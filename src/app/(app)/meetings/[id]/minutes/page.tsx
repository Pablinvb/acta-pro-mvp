import type { Metadata } from "next";

import { Alert } from "@/components/ui/alert";
import { MeetingHeader } from "@/components/meeting-header";
import { MinutesEditor } from "@/app/(app)/meetings/[id]/minutes/minutes-editor";
import { loadMeeting, requireStage } from "@/app/(app)/meetings/[id]/meeting-context";
import type { SourceSegment } from "@/components/source-segments";
import { speakerColor } from "@/lib/speakers";

export const metadata: Metadata = { title: "Acta" };

export default async function MinutesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { session, detail } = await loadMeeting(id);
  requireStage(detail, "draft");

  const [record, segments] = await Promise.all([
    session.repository.getLatestMinutes(id),
    session.repository.listSegments(id),
  ]);

  if (!record) {
    return (
      <div className="space-y-8">
        <MeetingHeader detail={detail} current="minutes" />
        <Alert tone="danger" title="Todavía no hay borrador">
          Genere el borrador desde el paso de hablantes.
        </Alert>
      </div>
    );
  }

  const speakerToName = new Map(
    detail.participants
      .filter((participant) => participant.speaker_label)
      .map((participant) => [participant.speaker_label!, participant.display_name]),
  );

  // Un color estable por voz, coherente con la pantalla de hablantes.
  const speakerOrder = [...new Set(segments.map((segment) => segment.speaker_label))].sort();

  const sourceSegments: SourceSegment[] = segments.map((segment) => ({
    id: segment.id,
    speaker: segment.speaker_label,
    displayName: speakerToName.get(segment.speaker_label) ?? segment.speaker_label,
    start: segment.start_seconds,
    text: segment.text,
    color: speakerColor(segment.speaker_label, speakerOrder),
  }));

  const editable = record.status === "draft" && detail.meeting.status === "draft";

  return (
    <div className="space-y-8">
      <MeetingHeader detail={detail} current="minutes" />

      <Alert tone="info" title="La IA propone, usted decide">
        Revise cada apartado antes de aprobar. Las entradas sin segmento de origen y las advertencias marcadas en
        naranja son los puntos donde el borrador puede estar equivocado.
      </Alert>

      <MinutesEditor
        meetingId={id}
        minutesId={record.id}
        version={record.version}
        status={record.status}
        generator={record.generator}
        model={record.model}
        draft={record.content}
        initialContent={record.edited_content ?? record.content}
        initialAcceptedFlags={record.accepted_language_flags}
        segments={sourceSegments}
        editable={editable}
      />
    </div>
  );
}
