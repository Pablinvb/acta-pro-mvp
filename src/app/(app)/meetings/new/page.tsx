import type { Metadata } from "next";

import { Card, CardBody, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { NewMeetingForm } from "@/app/(app)/meetings/new/new-meeting-form";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Nueva reunión" };

export default async function NewMeetingPage() {
  const { repository, institution } = await requireSession();
  const students = await repository.listStudents(institution.id);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Nueva reunión</h1>
        <p className="mt-1 text-sm text-ink-muted">
          El listado de estudiantes proviene del conector de datos institucionales. En esta versión ese conector es
          un proveedor simulado con datos ficticios.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Datos de la reunión</CardTitle>
          <CardDescription>
            Podrá confirmar las personas participantes en el siguiente paso, antes de registrar el consentimiento.
          </CardDescription>
        </CardHeader>
        <CardBody>
          <NewMeetingForm students={students} />
        </CardBody>
      </Card>
    </div>
  );
}
