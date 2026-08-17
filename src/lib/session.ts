import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getRepository } from "@/lib/data";
import type { Repository } from "@/lib/data/repository";
import { getEnv, isSupabaseConfigured } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DEMO_TEACHER_ID } from "@/lib/demo/seed-data";
import type { Institution, Profile } from "@/lib/types";

export const DEMO_SESSION_COOKIE = "actapro_demo_session";

export interface Session {
  profile: Profile;
  institution: Institution;
  /** `demo` indica sesión sin proveedor de identidad real. */
  mode: "demo" | "supabase";
  repository: Repository;
}

async function resolveProfileId(): Promise<{ id: string; mode: Session["mode"] } | null> {
  if (isSupabaseConfigured()) {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    if (!data.user) return null;
    return { id: data.user.id, mode: "supabase" };
  }

  if (!getEnv().DEMO_MODE) return null;
  const store = await cookies();
  const value = store.get(DEMO_SESSION_COOKIE)?.value;
  if (!value) return null;
  return { id: value, mode: "demo" };
}

export async function getSession(): Promise<Session | null> {
  const resolved = await resolveProfileId();
  if (!resolved) return null;

  const repository = await getRepository();
  const profile = await repository.getProfile(resolved.id);
  if (!profile) return null;
  const institution = await repository.getInstitution(profile.institution_id);
  if (!institution) return null;

  return { profile, institution, mode: resolved.mode, repository };
}

/** Para páginas: redirige a /login cuando no hay sesión. */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

export class UnauthorizedError extends Error {
  constructor(message = "Se requiere iniciar sesión.") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/** Para rutas de API: lanza en vez de redirigir. */
export async function requireApiSession(): Promise<Session> {
  const session = await getSession();
  if (!session) throw new UnauthorizedError();
  return session;
}

/**
 * Verifica que la reunión pertenezca a la institución de quien consulta y que
 * la persona sea la docente responsable o una administradora.
 */
export async function requireMeetingAccess(session: Session, meetingId: string) {
  const meeting = await session.repository.getMeeting(meetingId);
  if (!meeting) throw new UnauthorizedError("La reunión no existe o no está disponible.");
  const sameInstitution = meeting.institution_id === session.profile.institution_id;
  const isOwner = meeting.teacher_id === session.profile.id;
  if (!sameInstitution || (!isOwner && session.profile.role !== "admin")) {
    throw new UnauthorizedError("No tiene acceso a esta reunión.");
  }
  return meeting;
}

export const DEMO_LOGIN_PROFILE_ID = DEMO_TEACHER_ID;
