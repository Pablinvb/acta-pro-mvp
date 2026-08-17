import type { MeetingStatus } from "@/lib/types";

/**
 * Máquina de estados de la reunión.
 * Se aplica en la interfaz y, de nuevo, en el servidor: la interfaz solo
 * oculta acciones, el servidor las rechaza.
 */
export const MEETING_FLOW: MeetingStatus[] = [
  "scheduled",
  "ready",
  "recording",
  "processing",
  "draft",
  "approved",
  "signed",
  "sent",
];

const TRANSITIONS: Record<MeetingStatus, MeetingStatus[]> = {
  scheduled: ["ready"],
  // Se puede abortar una grabación sin audio y volver a la sala de espera.
  ready: ["recording"],
  recording: ["processing", "ready"],
  // Si la transcripción falla se regresa a `ready` para reintentar.
  processing: ["draft", "ready"],
  // `processing` permite regenerar el borrador; `draft` es el estado de trabajo.
  draft: ["processing", "approved"],
  // Se puede reabrir la edición mientras no existan firmas.
  approved: ["signed", "draft"],
  signed: ["sent"],
  sent: [],
};

export function canTransition(from: MeetingStatus, to: MeetingStatus): boolean {
  if (from === to) return true;
  return TRANSITIONS[from].includes(to);
}

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: MeetingStatus,
    readonly to: MeetingStatus,
  ) {
    super(`Transición inválida: ${from} → ${to}.`);
    this.name = "InvalidTransitionError";
  }
}

export function assertTransition(from: MeetingStatus, to: MeetingStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

export function statusIndex(status: MeetingStatus) {
  return MEETING_FLOW.indexOf(status);
}

/** ¿La reunión alcanzó al menos este estado? Útil para habilitar navegación. */
export function hasReached(status: MeetingStatus, target: MeetingStatus) {
  return statusIndex(status) >= statusIndex(target);
}

export const STATUS_LABEL: Record<MeetingStatus, string> = {
  scheduled: "Programada",
  ready: "Lista para grabar",
  recording: "Grabando",
  processing: "Procesando",
  draft: "Borrador",
  approved: "Aprobada",
  signed: "Firmada",
  sent: "Enviada",
};

export const STATUS_TONE: Record<MeetingStatus, "neutral" | "info" | "review" | "verified"> = {
  scheduled: "neutral",
  ready: "info",
  recording: "review",
  processing: "review",
  draft: "review",
  approved: "info",
  signed: "verified",
  sent: "verified",
};
