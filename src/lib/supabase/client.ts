"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Cliente de navegador. Solo recibe la URL y la clave publicable; nunca la
 * service role key ni ninguna clave de proveedor externo.
 */
export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase no está configurado en el cliente.");
  }
  return createBrowserClient(url, key);
}
