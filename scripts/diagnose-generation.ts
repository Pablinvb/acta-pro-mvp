/**
 * Mide cuánto tarda de verdad la generación del borrador, y si lo que devuelve
 * el modelo valida.
 *
 * Existe porque el límite de ejecución de la plataforma mata la función sin
 * decir por qué: lo único que queda es `Duration: 30000 ms` y un 502 genérico.
 * Para saber si el problema es el plazo o la generación hay que cronometrarla
 * donde nadie la interrumpa.
 *
 * Lee la reunión del proyecto configurado en `.env.local` **sin escribir nada**:
 * no crea el acta, solo genera y descarta. Consume una llamada a Anthropic.
 *
 *   npx tsx scripts/diagnose-generation.ts <id-de-la-reunion> [tokens-maximos]
 */
import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

import { generateMinutesWithAnthropic } from "@/lib/anthropic/generate-minutes";
import { SupabaseRepository } from "@/lib/data/supabase-repository";
import { getEnv } from "@/lib/env";

// Fuera de Next nadie carga `.env.local`, y sin él `getEnv()` no encuentra
// nada. Se lee aquí y no se imprime ningún valor.
for (const linea of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  if (!linea.includes("=") || linea.trimStart().startsWith("#")) continue;
  const nombre = linea.slice(0, linea.indexOf("=")).trim();
  if (!process.env[nombre]) process.env[nombre] = linea.slice(linea.indexOf("=") + 1).trim();
}

const meetingId = process.argv[2];
if (!meetingId) {
  console.error("Uso: npx tsx scripts/diagnose-generation.ts <id-de-la-reunion> [tokens-maximos]");
  process.exit(2);
}
if (process.argv[3]) process.env.ANTHROPIC_MAX_TOKENS = process.argv[3];

async function main() {
  const env = getEnv();
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const repository = new SupabaseRepository(admin, admin);

  const detail = await repository.getMeetingDetail(meetingId);
  if (!detail) throw new Error("La reunión no existe en el proyecto configurado.");
  const segments = await repository.listSegments(meetingId);

  const speakerNames = Object.fromEntries(
    detail.participants
      .filter((participant) => participant.speaker_label)
      .map((participant) => [participant.speaker_label!, participant.display_name]),
  );

  const palabras = segments.reduce((total, segmento) => total + segmento.text.split(/\s+/).length, 0);
  console.log(`\nReunión: ${detail.meeting.title}`);
  console.log(`Transcripción: ${segments.length} intervención(es), ~${palabras} palabras`);
  console.log(`Modelo: ${env.ANTHROPIC_MODEL}`);
  console.log(`Tokens máximos: ${env.ANTHROPIC_MAX_TOKENS}`);
  console.log(`Plazo configurado: ${env.ANTHROPIC_TIMEOUT_MS} ms\n`);

  const inicio = Date.now();
  try {
    const { minutes, model } = await generateMinutesWithAnthropic(detail, segments, speakerNames);
    const segundos = (Date.now() - inicio) / 1000;
    console.log(`  OK     Generado en ${segundos.toFixed(1)} s con ${model}`);
    console.log(`         Resumen: ${minutes.summary.length} caracteres`);
    console.log(`         Acuerdos: ${minutes.agreements.length} · Compromisos: ${minutes.commitments.length}`);
    console.log(`         Advertencias de lenguaje: ${minutes.language_flags.length}`);
    console.log(`\n  El contenido validó contra el esquema y no cita segmentos inexistentes.`);
    console.log(`  Nada se escribió en la base: esto solo genera y descarta.\n`);
    if (segundos > 25) {
      console.log(`  AVISO  ${segundos.toFixed(1)} s no cabe en una función de 30 s con el resto de la petición.`);
    }
  } catch (error) {
    const segundos = (Date.now() - inicio) / 1000;
    console.log(`  FALLA  Tras ${segundos.toFixed(1)} s`);
    console.log(`         ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
    process.exitCode = 1;
  }
}

void main();
