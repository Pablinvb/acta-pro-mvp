import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const TIME_ZONE = "America/Guayaquil";
const LOCALE = "es-EC";

export function formatDateTime(value: string | Date | null | undefined) {
  if (!value) return "No consta";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "No consta";
  return new Intl.DateTimeFormat(LOCALE, {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: TIME_ZONE,
  }).format(date);
}

export function formatDate(value: string | Date | null | undefined) {
  if (!value) return "No consta";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "No consta";
  return new Intl.DateTimeFormat(LOCALE, {
    dateStyle: "long",
    timeZone: TIME_ZONE,
  }).format(date);
}

/** Segundos -> mm:ss, para el cronómetro y las marcas de la transcripción. */
export function formatClock(totalSeconds: number) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function shortHash(hash: string, size = 12) {
  if (hash.length <= size * 2) return hash;
  return `${hash.slice(0, size)}…${hash.slice(-size)}`;
}
