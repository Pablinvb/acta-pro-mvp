"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getEnv } from "@/lib/env";
import { resolveDataMode } from "@/lib/data/mode";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DEMO_SESSION_COOKIE } from "@/lib/session";
import { DEMO_TEACHER_EMAIL, DEMO_TEACHER_ID, DEMO_TEACHER_PASSWORD } from "@/lib/demo/seed-data";

export interface LoginState {
  error?: string;
}

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 8,
};

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Ingrese correo y contraseña." };
  }

  const { mode, supabaseUnreachable } = await resolveDataMode();

  if (mode === "supabase") {
    if (supabaseUnreachable) {
      // Distinguir red de credenciales evita mandar a alguien a revisar una
      // contraseña correcta cuando el proyecto de Supabase no responde.
      return {
        error:
          "No se pudo contactar con Supabase. Compruebe que el proyecto existe y está activo, o revise NEXT_PUBLIC_SUPABASE_URL.",
      };
    }

    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      // No se refleja el detalle del proveedor para no filtrar qué correos existen.
      return { error: "No se pudo iniciar sesión. Revise sus credenciales." };
    }
    redirect("/dashboard");
  }

  if (!getEnv().DEMO_MODE) {
    return { error: "La autenticación no está configurada y el modo demostración está desactivado." };
  }

  if (email !== DEMO_TEACHER_EMAIL || password !== DEMO_TEACHER_PASSWORD) {
    return { error: "Credenciales de demostración inválidas." };
  }

  const store = await cookies();
  store.set(DEMO_SESSION_COOKIE, DEMO_TEACHER_ID, COOKIE_OPTIONS);
  redirect("/dashboard");
}

export async function logout() {
  if ((await resolveDataMode()).mode === "supabase") {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }
  const store = await cookies();
  store.delete(DEMO_SESSION_COOKIE);
  redirect("/login");
}
