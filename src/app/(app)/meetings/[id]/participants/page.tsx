import type { Metadata } from "next";

import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MeetingHeader } from "@/components/meeting-header";
import { ParticipantsForm } from "@/app/(app)/meetings/[id]/participants/participants-form";
import { loadMeeting } from "@/app/(app)/meetings/[id]/meeting-context";

export const metadata: Metadata = { title: "Participantes" };

export default async function ParticipantsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { detail } = await loadMeeting(id);

  const options = [
    {
      key: `teacher|${detail.teacher.id}|${detail.teacher.full_name}`,
      type: "teacher" as const,
      name: detail.teacher.full_name,
      subtitle: "Docente responsable de la reunión",
      required: true,
    },
    ...detail.representatives.map((representative) => ({
      key: `representative|${representative.id}|${representative.full_name}`,
      type: "representative" as const,
      name: representative.full_name,
      subtitle: `Representante · ${representative.email ?? "sin correo registrado"}`,
      required: false,
    })),
    {
      key: `student|${detail.student.id}|${detail.student.full_name}`,
      type: "student" as const,
      name: detail.student.full_name,
      subtitle: `Estudiante · ${detail.student.grade ?? "sin grado"} ${detail.student.section ?? ""}`,
      required: false,
    },
  ];

  const selected = new Set(
    detail.participants.map(
      (participant) =>
        `${participant.participant_type}|${participant.participant_ref_id ?? ""}|${participant.display_name}`,
    ),
  );

  return (
    <div className="space-y-8">
      <MeetingHeader detail={detail} current="participants" />

      <Card className="mx-auto max-w-2xl">
        <CardHeader>
          <CardTitle>Confirme quiénes están presentes</CardTitle>
          <CardDescription>
            Solo las personas marcadas aparecerán en el acta y deberán registrar su consentimiento antes de grabar.
            Si asiste alguien más, agréguelo al final del formulario.
          </CardDescription>
        </CardHeader>
        <CardBody>
          <ParticipantsForm
            meetingId={id}
            options={options}
            selectedKeys={[...selected]}
            hasPreviousSelection={detail.participants.length > 0}
          />
        </CardBody>
      </Card>
    </div>
  );
}
