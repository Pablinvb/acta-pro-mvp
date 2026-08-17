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

/** Lunes de la semana de `value`, en UTC, como YYYY-MM-DD. */
export function startOfWeek(value: Date | string): string {
  const date = typeof value === "string" ? new Date(`${value}T00:00:00Z`) : new Date(value);
  const day = date.getUTCDay();
  // getUTCDay(): 0 es domingo; se desplaza para que la semana empiece el lunes.
  const offset = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

/** Las `count` semanas consecutivas a partir de la semana de `from`. */
export function weekRange(from: Date, count: number): string[] {
  const first = new Date(`${startOfWeek(from)}T00:00:00Z`);
  return Array.from({ length: count }, (_, index) => {
    const week = new Date(first);
    week.setUTCDate(week.getUTCDate() + index * 7);
    return week.toISOString().slice(0, 10);
  });
}

export function shortDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short", timeZone: "UTC" }).format(date);
}

export function shortHash(hash: string, size = 12) {
  if (hash.length <= size * 2) return hash;
  return `${hash.slice(0, size)}…${hash.slice(-size)}`;
}
