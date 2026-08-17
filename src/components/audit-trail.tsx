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
  "commitment.status_changed": "Estado de compromiso actualizado",
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
    <ol aria-label="Historial de auditoría" className="relative space-y-4">
      {/* Línea vertical que une los hitos del expediente. */}
      <span aria-hidden className="absolute left-[5px] top-2 bottom-2 w-px bg-line" />
      {entries.map((entry) => (
        <li key={entry.id} className="relative pl-6">
          <span
            aria-hidden
            className="absolute left-0 top-1.5 size-[11px] rounded-full border-2 border-brand-400 bg-canvas-deep"
          />
          <p className="text-sm font-medium text-ink">{ACTION_LABEL[entry.action] ?? entry.action}</p>
          <p className="text-xs text-ink-subtle">{formatDateTime(entry.created_at)}</p>
        </li>
      ))}
    </ol>
  );
}
