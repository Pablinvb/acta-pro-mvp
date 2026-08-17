import { formatDateTime } from "@/lib/utils";
import type { AuditAction, AuditLog } from "@/lib/types";

const ACTION_LABEL: Record<AuditAction, string> = {
  "meeting.created": "Reunión creada",
  "meeting.participants_confirmed": "Participantes confirmados",
  "consent.recorded": "Consentimiento registrado",
  "recording.started": "Grabación iniciada",
  "recording.stopped": "Grabación finalizada",
  "transcription.saved": "Transcripción guardada",
  "transcription.recovered": "Transcripción recuperada del audio",
  "speakers.mapped": "Hablantes asignados",
  "minutes.generated": "Borrador de acta generado",
  "minutes.edited": "Acta editada",
  "minutes.approved": "Acta aprobada",
  "minutes.signed": "Acta firmada",
  "document.generated": "PDF generado",
  "document.downloaded": "PDF descargado",
  "document.sent": "Acta enviada por correo",
  "google.synced": "Reuniones sincronizadas con Google Calendar",
};

export function AuditTrail({ entries }: { entries: AuditLog[] }) {
  if (entries.length === 0) {
    return <p className="text-sm text-ink-muted">Sin eventos registrados todavía.</p>;
  }

  return (
    <ol aria-label="Historial de auditoría" className="space-y-3">
      {entries.map((entry) => (
        <li key={entry.id} className="border-l-2 border-line pl-3">
          <p className="text-sm font-medium text-ink">{ACTION_LABEL[entry.action] ?? entry.action}</p>
          <p className="text-xs text-ink-subtle">{formatDateTime(entry.created_at)}</p>
        </li>
      ))}
    </ol>
  );
}
