import { NextResponse } from "next/server";
import { google } from "googleapis";

import { requireApiSession } from "@/lib/session";
import { ApiError, checkRateLimit, toErrorResponse } from "@/lib/api/http";
import { getEnv, isGoogleConfigured } from "@/lib/env";
import { decryptToken } from "@/lib/crypto/tokens";
import { getGoogleCredentials } from "@/lib/google/credentials";

export const runtime = "nodejs";

const MAX_EVENTS = 25;
const TITLE_PREFIX = "ACTA PRO:";

/**
 * Importa únicamente los eventos marcados explícitamente para ACTA PRO.
 * No se copian descripciones completas ni eventos personales: solo el título
 * (sin el prefijo), la fecha y el identificador del evento.
 */
export async function POST() {
  try {
    const session = await requireApiSession();
    const env = getEnv();
    checkRateLimit(`google-sync:${session.profile.id}`, 6, 60_000);

    if (!isGoogleConfigured(env)) throw new ApiError(503, "Google Calendar no está configurado.");

    const stored = await getGoogleCredentials(session.profile.id);
    if (!stored) throw new ApiError(409, "Conecte su cuenta de Google antes de sincronizar.");

    const client = new google.auth.OAuth2(
      env.GOOGLE_CLIENT_ID,
      env.GOOGLE_CLIENT_SECRET,
      env.GOOGLE_REDIRECT_URI,
    );
    client.setCredentials({
      access_token: decryptToken(stored.access_token_encrypted),
      refresh_token: stored.refresh_token_encrypted ? decryptToken(stored.refresh_token_encrypted) : undefined,
      expiry_date: stored.expiry_date ?? undefined,
    });

    const calendar = google.calendar({ version: "v3", auth: client });
    const { data } = await calendar.events.list({
      calendarId: env.GOOGLE_CALENDAR_ID,
      timeMin: new Date().toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: MAX_EVENTS,
    });

    const students = await session.repository.listStudents(session.institution.id);
    let imported = 0;
    let updated = 0;
    let skipped = 0;

    for (const event of data.items ?? []) {
      const title = event.summary ?? "";
      const marked =
        title.startsWith(TITLE_PREFIX) || event.extendedProperties?.private?.actaPro === "true";
      if (!marked || !event.id) {
        skipped += 1;
        continue;
      }

      const cleanTitle = title.startsWith(TITLE_PREFIX) ? title.slice(TITLE_PREFIX.length).trim() : title.trim();
      const startsAt = event.start?.dateTime ?? (event.start?.date ? `${event.start.date}T00:00:00Z` : null);

      // La correspondencia con el estudiante se infiere del nombre en el
      // título; si no hay coincidencia, la reunión no se importa.
      const student = students.find((candidate) =>
        cleanTitle.toLowerCase().includes(candidate.full_name.toLowerCase().split(" ").slice(0, 2).join(" ")),
      );
      if (!student) {
        skipped += 1;
        continue;
      }

      const existing = await session.repository.findMeetingByGoogleEventId(session.institution.id, event.id);
      if (existing) {
        await session.repository.updateMeeting(existing.id, {
          title: cleanTitle || existing.title,
          scheduled_at: startsAt ?? existing.scheduled_at,
        });
        updated += 1;
        continue;
      }

      await session.repository.createMeeting({
        institution_id: session.institution.id,
        teacher_id: session.profile.id,
        student_id: student.id,
        title: cleanTitle || "Reunión importada de Google Calendar",
        reason: null,
        scheduled_at: startsAt,
        source: "google_calendar",
        google_event_id: event.id,
      });
      imported += 1;
    }

    await session.repository.appendAudit({
      institution_id: session.institution.id,
      actor_id: session.profile.id,
      meeting_id: null,
      action: "google.synced",
      metadata_json: { imported, updated, skipped },
    });

    return NextResponse.json({ imported, updated, skipped });
  } catch (error) {
    return toErrorResponse(error);
  }
}
