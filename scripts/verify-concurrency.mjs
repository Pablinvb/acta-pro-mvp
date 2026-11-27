#!/usr/bin/env node
/**
 * Pruebas de concurrencia contra Supabase **local**.
 *
 * Los demás archivos de prueba corren en una sola sesión, que es suficiente
 * para comprobar reglas pero no para comprobar carreras: un bloqueo solo se
 * puede medir con dos conexiones compitiendo de verdad. Aquí se abren dos
 * procesos `psql` -dos conexiones, dos transacciones, dos bloqueos- y se
 * observa qué ocurre cuando llegan a la vez.
 *
 * A diferencia del resto de la suite, estos escenarios **confirman** sus
 * transacciones: una carrera no se puede observar dentro de una transacción que
 * luego se revierte. Por eso el guion limpia sus propios datos al empezar y al
 * terminar, y usa identificadores fijos y reconocibles.
 */
import { readFileSync } from "node:fs";
import { delay, psql, psqlAsync, psqlScalar, resolveLocalContainer } from "./local-target.mjs";

const ID = {
  user: "c3000000-0000-4000-8000-000000000001",
  institution: "c3000000-0000-4000-8000-0000000000a1",
  student: "c3000000-0000-4000-8000-0000000000b1",
};

const SCENARIOS = ["firma", "reapertura", "firma-tardia", "pdf"];
const meeting = (n) => `c3000000-0000-4000-8000-0000000000c${n}`;
const minutes = (n) => `c3000000-0000-4000-8000-0000000000d${n}`;

const CLAIMS = `'{"sub":"${ID.user}","role":"authenticated"}'`;

const SIGNATURES = JSON.stringify([
  { signer_role: "teacher", signer_name: "Docente", signature_path: "data:image/png;base64,AA" },
  {
    signer_role: "representative",
    signer_name: "Representante",
    signature_path: "data:image/png;base64,BB",
  },
]);

const results = [];
const check = (name, passed, detail) => results.push({ name, passed, detail });

/** Sesión de usuario autenticado. Nada de estas pruebas corre como superusuario. */
const asTeacher = (body) => `
BEGIN;
SET LOCAL request.jwt.claims = ${CLAIMS};
SET LOCAL ROLE authenticated;
${body}
COMMIT;
`;

const signCall = (n) =>
  `SELECT public.sign_minutes('${minutes(n)}', $$${SIGNATURES}$$::jsonb, 'v1');`;

// --------------------------------------------------------------- escenario

function cleanup(container) {
  // Las actas y las firmas finalizadas no se pueden borrar, a proposito. Para
  // retirar los datos de prueba se desactivan esas guardas y se vuelven a
  // activar en la misma transaccion.
  psql(
    container,
    `
BEGIN;
ALTER TABLE public.signatures DISABLE TRIGGER protect_finalized_signatures_trigger;
ALTER TABLE public.minutes DISABLE TRIGGER protect_finalized_minutes_trigger;
DELETE FROM public.audit_logs WHERE institution_id = '${ID.institution}';
DELETE FROM public.meetings WHERE institution_id = '${ID.institution}';
DELETE FROM public.representatives WHERE id IN (${SCENARIOS.map((_,index)=>"'" + minutes(index+1) + "'").join(",")});
DELETE FROM public.students WHERE institution_id = '${ID.institution}';
DELETE FROM public.profiles WHERE institution_id = '${ID.institution}';
DELETE FROM public.institutions WHERE id = '${ID.institution}';
DELETE FROM auth.users WHERE id = '${ID.user}';
ALTER TABLE public.signatures ENABLE TRIGGER protect_finalized_signatures_trigger;
ALTER TABLE public.minutes ENABLE TRIGGER protect_finalized_minutes_trigger;
COMMIT;
`,
  );
}

function setup(container) {
  const meetings = SCENARIOS.map(
    (_, index) => `
  ('${meeting(index + 1)}', '${ID.institution}', '${ID.user}', '${ID.student}',
   'Escenario ${SCENARIOS[index]}', 'approved')`,
  ).join(",");

  const minutesRows = SCENARIOS.map(
    (_, index) => `
  ('${minutes(index + 1)}', '${meeting(index + 1)}', 1, 'approved', 'Resumen', now())`,
  ).join(",");

  psql(
    container,
    `
BEGIN;
INSERT INTO auth.users (id, email) VALUES ('${ID.user}', 'concurrencia@test.invalid');
INSERT INTO public.institutions (id, name) VALUES ('${ID.institution}', 'Institucion concurrencia');
INSERT INTO public.profiles (id, full_name, email, role, institution_id)
VALUES ('${ID.user}', 'Docente', 'concurrencia@test.invalid', 'teacher', '${ID.institution}');
INSERT INTO public.students (id, institution_id, full_name)
VALUES ('${ID.student}', '${ID.institution}', 'Alumna');

-- Las reuniones nacen en 'ready' porque la guarda de creacion solo admite eso,
-- y se llevan a 'approved' por el camino legitimo.
INSERT INTO public.meetings (id, institution_id, teacher_id, student_id, title, status)
SELECT v.id::uuid, v.inst::uuid, v.teacher::uuid, v.student::uuid, v.title, 'ready'
FROM (VALUES ${meetings}) AS v(id, inst, teacher, student, title, estado);

UPDATE public.meetings SET status = 'recording'  WHERE institution_id = '${ID.institution}';
UPDATE public.meetings SET status = 'processing' WHERE institution_id = '${ID.institution}';
UPDATE public.meetings SET status = 'draft'      WHERE institution_id = '${ID.institution}';
UPDATE public.meetings SET status = 'approved'   WHERE institution_id = '${ID.institution}';

INSERT INTO public.minutes (id, meeting_id, version, status, summary, approved_at)
VALUES ${minutesRows};
${readFileSync("tests/integration/signing-fixture.sql","utf8")}
SELECT pg_temp.prepare_signing_fixture(a.id,'Representante') FROM public.minutes a
JOIN public.meetings m ON m.id=a.meeting_id WHERE m.institution_id='${ID.institution}';
COMMIT;
`,
  );
}

const scalar = (container, sql) => psqlScalar(container, sql);

// ------------------------------------------------------------- escenarios

/**
 * Dos sesiones firman la misma acta al mismo tiempo. El resultado correcto no
 * es que una falle: es que una firme y la otra reconozca que ya estaba firmada,
 * sin duplicar firmas ni anotaciones de auditoria.
 */
async function dosFirmasALaVez(container) {
  const lenta = psqlAsync(
    container,
    asTeacher(`${signCall(1)}
SELECT pg_sleep(2);`),
  );
  await delay(500);
  const rapida = await psqlAsync(container, asTeacher(signCall(1)));
  const primera = await lenta;

  check("Q1 la primera sesion firma", primera.ok, primera.ok ? "" : firstError(primera));
  check("Q2 la segunda sesion no falla", rapida.ok, rapida.ok ? "" : firstError(rapida));
  check(
    "Q3 la segunda reconoce que ya estaba firmada",
    /"already_signed"\s*:\s*true/.test(rapida.stdout),
    "",
  );
  check(
    "Q4 hay exactamente dos firmas",
    scalar(container, `SELECT count(*) FROM public.signatures WHERE minutes_id = '${minutes(1)}';`) ===
      "2",
    "",
  );
  check(
    "Q5 la reunion quedo firmada",
    scalar(container, `SELECT status FROM public.meetings WHERE id = '${meeting(1)}';`) === "signed",
    "",
  );
  check(
    "Q6 la firma se auditó una sola vez",
    scalar(
      container,
      `SELECT count(*) FROM public.audit_logs
       WHERE meeting_id = '${meeting(1)}' AND action = 'minutes.signed';`,
    ) === "1",
    "",
  );
}

/**
 * Una sesión firma mientras otra intenta reabrir la edición. Si la reapertura
 * se colara después de la firma, quedaría un acta firmada que alguien puede
 * seguir editando.
 */
async function firmaContraReapertura(container) {
  const firma = psqlAsync(
    container,
    asTeacher(`${signCall(2)}
SELECT pg_sleep(2);`),
  );
  await delay(500);
  const reapertura = await psqlAsync(
    container,
    asTeacher(`UPDATE public.meetings SET status = 'draft' WHERE id = '${meeting(2)}';`),
  );
  const firmada = await firma;

  check("R1 la firma se completa", firmada.ok, firmada.ok ? "" : firstError(firmada));
  check("R2 la reapertura simultanea se rechaza", !reapertura.ok, "");
  check(
    "R3 la reunion sigue firmada",
    scalar(container, `SELECT status FROM public.meetings WHERE id = '${meeting(2)}';`) === "signed",
    "",
  );
  check(
    "R4 las dos firmas siguen ahi",
    scalar(container, `SELECT count(*) FROM public.signatures WHERE minutes_id = '${minutes(2)}';`) ===
      "2",
    "",
  );
}

/**
 * El orden inverso: se reabre primero y la firma llega tarde. Debe fallar, y no
 * dejar firmas sueltas sobre un acta que volvio a ser borrador.
 */
async function reaperturaContraFirma(container) {
  const reapertura = psqlAsync(
    container,
    asTeacher(`UPDATE public.meetings SET status = 'draft' WHERE id = '${meeting(3)}';
SELECT pg_sleep(2);`),
  );
  await delay(500);
  const firma = await psqlAsync(container, asTeacher(signCall(3)));
  const reabierta = await reapertura;

  check("S1 la reapertura se completa", reabierta.ok, reabierta.ok ? "" : firstError(reabierta));
  check("S2 la firma tardia se rechaza", !firma.ok, "");
  check(
    "S3 no quedo ninguna firma",
    scalar(container, `SELECT count(*) FROM public.signatures WHERE minutes_id = '${minutes(3)}';`) ===
      "0",
    "",
  );
  check(
    "S4 la reunion quedo en borrador",
    scalar(container, `SELECT status FROM public.meetings WHERE id = '${meeting(3)}';`) === "draft",
    "",
  );
}

/**
 * Dos generaciones de PDF simultáneas con los mismos datos. El índice único es
 * lo que decide: una gana y la otra reutiliza, sin que queden dos documentos de
 * la misma acta con hashes distintos.
 */
async function pdfConcurrente(container) {
  const fingerprint = "a".repeat(64);
  const insert = (hash, suffix) => `
INSERT INTO public.documents
  (minutes_id, meeting_id, storage_path, sha256, document_code, version,
   generation_fingerprint, kind)
VALUES ('${minutes(4)}', '${meeting(4)}', 'inst/alumna/acta-${suffix}.pdf',
        '${hash.repeat(64).slice(0, 64)}', 'ACTA-2026-CONC0001-v1', 1,
        '${fingerprint}', 'final');`;

  const lenta = psqlAsync(
    container,
    asTeacher(`${insert("1", "uno")}
SELECT pg_sleep(2);`),
  );
  await delay(500);
  const rapida = await psqlAsync(container, asTeacher(insert("2", "dos")));
  const primera = await lenta;

  check("T1 la primera generacion registra el documento", primera.ok, primera.ok ? "" : firstError(primera));
  check("T2 la segunda choca con el indice unico", !rapida.ok, "");
  check(
    "T3 el rechazo es por clave duplicada",
    /duplicate key|unique constraint/i.test(rapida.stderr),
    firstError(rapida),
  );
  check(
    "T4 solo hay un documento para esa huella",
    scalar(
      container,
      `SELECT count(*) FROM public.documents
       WHERE minutes_id = '${minutes(4)}' AND generation_fingerprint = '${fingerprint}';`,
    ) === "1",
    "",
  );
}

function firstError(result) {
  return String(result.stderr || result.stdout)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /ERROR|FATAL/.test(line))
    ?.slice(0, 70) ?? "";
}

// ------------------------------------------------------------------ informe

async function main() {
  const container = resolveLocalContainer();
  console.log(`Destino: ${container} · Supabase local\n`);

  cleanup(container);
  try {
    setup(container);
    await dosFirmasALaVez(container);
    await firmaContraReapertura(container);
    await reaperturaContraFirma(container);
    await pdfConcurrente(container);
  } finally {
    cleanup(container);
  }

  for (const { name, passed, detail } of results) {
    console.log(`  ${passed ? "PASA " : "FALLA"}  ${name.padEnd(46)}${detail ?? ""}`);
  }

  const passed = results.filter((r) => r.passed).length;
  console.log(`\n  ${passed} / ${results.length} superadas\n`);

  if (passed !== results.length) {
    console.error(`${results.length - passed} prueba(s) de concurrencia con fallos.`);
    process.exit(1);
  }
  console.log("Todas las pruebas de concurrencia pasaron.");
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
