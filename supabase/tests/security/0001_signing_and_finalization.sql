-- ACTA PRO · pruebas de seguridad: firma atomica y finalizacion controlada
--
-- Se ejecuta dentro de una transaccion que SIEMPRE revierte, de modo que no
-- deja ningun registro residual. Todos los datos son ficticios.
--
-- Cubre los tres huecos que cerro la migracion 0006:
--   A. finalizar una reunion sin las firmas obligatorias
--   B. crear directamente una reunion en un estado avanzado
--   C. reutilizar firmas tras reabrir un acta aprobada
-- y el contrato transaccional de public.sign_minutes.

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL client_min_messages TO WARNING;

CREATE TEMP TABLE results (
    id serial primary key,
    name text not null,
    passed boolean not null,
    detail text
) ON COMMIT DROP;

CREATE FUNCTION pg_temp.expect_failure(test_name text, stmt text)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
    BEGIN
        EXECUTE stmt;
        INSERT INTO results (name, passed, detail)
        VALUES (test_name, false, 'deberia haber fallado y no fallo');
    EXCEPTION WHEN others THEN
        INSERT INTO results (name, passed, detail)
        VALUES (test_name, true, left(SQLERRM, 60));
    END;
END;
$fn$;

CREATE FUNCTION pg_temp.expect_success(test_name text, stmt text)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
    BEGIN
        EXECUTE stmt;
        INSERT INTO results (name, passed, detail) VALUES (test_name, true, 'ok');
    EXCEPTION WHEN others THEN
        INSERT INTO results (name, passed, detail)
        VALUES (test_name, false, left(SQLERRM, 60));
    END;
END;
$fn$;

CREATE FUNCTION pg_temp.expect(test_name text, condition boolean)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
    INSERT INTO results (name, passed, detail)
    VALUES (test_name, coalesce(condition, false), NULL);
END;
$fn$;

-- ------------------------------------------------------------ datos ficticios

INSERT INTO auth.users (id, email)
VALUES ('f0000000-0000-4000-8000-000000000001', 'docente@test.invalid');

INSERT INTO public.institutions (id, name)
VALUES ('f0000000-0000-4000-8000-0000000000a1', 'Institucion de prueba');

INSERT INTO public.profiles (id, full_name, email, role, institution_id)
VALUES ('f0000000-0000-4000-8000-000000000001', 'Docente Prueba',
        'docente@test.invalid', 'teacher',
        'f0000000-0000-4000-8000-0000000000a1');

INSERT INTO public.students (id, institution_id, full_name)
VALUES ('f0000000-0000-4000-8000-0000000000b1',
        'f0000000-0000-4000-8000-0000000000a1', 'Estudiante Prueba');

-- ------------------------------------------- B · creacion en estado avanzado

SELECT pg_temp.expect_failure('B1 crear reunion ya firmada',
  $q$INSERT INTO public.meetings (id, institution_id, teacher_id, student_id, title, status)
     VALUES ('f0000000-0000-4000-8000-0000000000c9','f0000000-0000-4000-8000-0000000000a1',
             'f0000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-0000000000b1',
             'Directa','signed')$q$);

SELECT pg_temp.expect_failure('B2 crear reunion ya aprobada',
  $q$INSERT INTO public.meetings (id, institution_id, teacher_id, student_id, title, status)
     VALUES ('f0000000-0000-4000-8000-0000000000ca','f0000000-0000-4000-8000-0000000000a1',
             'f0000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-0000000000b1',
             'Directa','approved')$q$);

SELECT pg_temp.expect_success('B3 crear reunion programada',
  $q$INSERT INTO public.meetings (id, institution_id, teacher_id, student_id, title, status)
     VALUES ('f0000000-0000-4000-8000-0000000000c1','f0000000-0000-4000-8000-0000000000a1',
             'f0000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-0000000000b1',
             'Reunion de prueba','scheduled')$q$);

UPDATE public.meetings SET status='ready'      WHERE id='f0000000-0000-4000-8000-0000000000c1';
UPDATE public.meetings SET status='recording'  WHERE id='f0000000-0000-4000-8000-0000000000c1';
UPDATE public.meetings SET status='processing' WHERE id='f0000000-0000-4000-8000-0000000000c1';
UPDATE public.meetings SET status='draft'      WHERE id='f0000000-0000-4000-8000-0000000000c1';

INSERT INTO public.minutes (id, meeting_id, version, status, summary)
VALUES ('f0000000-0000-4000-8000-0000000000d1',
        'f0000000-0000-4000-8000-0000000000c1', 1, 'draft', 'Resumen de prueba');

UPDATE public.minutes  SET status='approved', approved_at=now()
  WHERE id='f0000000-0000-4000-8000-0000000000d1';
UPDATE public.meetings SET status='approved'
  WHERE id='f0000000-0000-4000-8000-0000000000c1';

-- ------------------------------------------------- A · firmas obligatorias

SELECT pg_temp.expect_failure('A1 finalizar sin ninguna firma',
  $q$UPDATE public.meetings SET status='signed'
     WHERE id='f0000000-0000-4000-8000-0000000000c1'$q$);

INSERT INTO public.signatures
  (minutes_id, signer_name, signer_role, signature_path, acceptance_text_version)
VALUES ('f0000000-0000-4000-8000-0000000000d1','Docente Prueba','teacher',
        'data:image/png;base64,AAA','v1');

SELECT pg_temp.expect_failure('A2 finalizar solo con la firma docente',
  $q$UPDATE public.meetings SET status='signed'
     WHERE id='f0000000-0000-4000-8000-0000000000c1'$q$);

INSERT INTO public.signatures
  (minutes_id, signer_name, signer_role, signature_path, acceptance_text_version)
VALUES ('f0000000-0000-4000-8000-0000000000d1','Representante Prueba','representative',
        'data:image/png;base64,BBB','v1');

SELECT pg_temp.expect_success('A3 finalizar con ambas firmas',
  $q$UPDATE public.meetings SET status='signed'
     WHERE id='f0000000-0000-4000-8000-0000000000c1'$q$);

SELECT pg_temp.expect_failure('A4 duplicar la firma de un rol',
  $q$INSERT INTO public.signatures
     (minutes_id, signer_name, signer_role, signature_path, acceptance_text_version)
     VALUES ('f0000000-0000-4000-8000-0000000000d1','Otro','teacher',
             'data:image/png;base64,CCC','v1')$q$);

SELECT pg_temp.expect_failure('A5 modificar un acta ya firmada',
  $q$UPDATE public.minutes SET summary='alterado'
     WHERE id='f0000000-0000-4000-8000-0000000000d1'$q$);

SELECT pg_temp.expect_failure('A6 retroceder de signed a draft',
  $q$UPDATE public.meetings SET status='draft'
     WHERE id='f0000000-0000-4000-8000-0000000000c1'$q$);

-- -------------------------------------------------- C · reapertura controlada

INSERT INTO public.meetings (id, institution_id, teacher_id, student_id, title, status)
VALUES ('f0000000-0000-4000-8000-0000000000c2','f0000000-0000-4000-8000-0000000000a1',
        'f0000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-0000000000b1',
        'Reapertura','scheduled');

UPDATE public.meetings SET status='ready'      WHERE id='f0000000-0000-4000-8000-0000000000c2';
UPDATE public.meetings SET status='recording'  WHERE id='f0000000-0000-4000-8000-0000000000c2';
UPDATE public.meetings SET status='processing' WHERE id='f0000000-0000-4000-8000-0000000000c2';
UPDATE public.meetings SET status='draft'      WHERE id='f0000000-0000-4000-8000-0000000000c2';

INSERT INTO public.minutes (id, meeting_id, version, status, summary)
VALUES ('f0000000-0000-4000-8000-0000000000d2',
        'f0000000-0000-4000-8000-0000000000c2', 1, 'draft', 'Para reabrir');

UPDATE public.minutes  SET status='approved', approved_at=now()
  WHERE id='f0000000-0000-4000-8000-0000000000d2';
UPDATE public.meetings SET status='approved'
  WHERE id='f0000000-0000-4000-8000-0000000000c2';

INSERT INTO public.signatures
  (minutes_id, signer_name, signer_role, signature_path, acceptance_text_version)
VALUES ('f0000000-0000-4000-8000-0000000000d2','Docente','teacher',
        'data:image/png;base64,AAA','v1');

UPDATE public.meetings SET status='draft' WHERE id='f0000000-0000-4000-8000-0000000000c2';

SELECT pg_temp.expect('C1 reabrir elimina las firmas previas',
  (SELECT count(*) = 0 FROM public.signatures
   WHERE minutes_id='f0000000-0000-4000-8000-0000000000d2'));

SELECT pg_temp.expect('C2 reabrir revoca la aprobacion',
  (SELECT status='draft' AND approved_at IS NULL FROM public.minutes
   WHERE id='f0000000-0000-4000-8000-0000000000d2'));

SELECT pg_temp.expect('C3 la reapertura queda auditada',
  (SELECT count(*) = 1 FROM public.audit_logs
   WHERE meeting_id='f0000000-0000-4000-8000-0000000000c2'
     AND action='minutes.reopened'));

-- ------------------------------------------------ D · sign_minutes atomico

INSERT INTO public.meetings (id, institution_id, teacher_id, student_id, title, status)
VALUES ('f0000000-0000-4000-8000-0000000000c3','f0000000-0000-4000-8000-0000000000a1',
        'f0000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-0000000000b1',
        'RPC','scheduled');

UPDATE public.meetings SET status='ready'      WHERE id='f0000000-0000-4000-8000-0000000000c3';
UPDATE public.meetings SET status='recording'  WHERE id='f0000000-0000-4000-8000-0000000000c3';
UPDATE public.meetings SET status='processing' WHERE id='f0000000-0000-4000-8000-0000000000c3';
UPDATE public.meetings SET status='draft'      WHERE id='f0000000-0000-4000-8000-0000000000c3';

INSERT INTO public.minutes (id, meeting_id, version, status, summary)
VALUES ('f0000000-0000-4000-8000-0000000000d3',
        'f0000000-0000-4000-8000-0000000000c3', 1, 'draft', 'Para firmar por RPC');

UPDATE public.minutes  SET status='approved', approved_at=now()
  WHERE id='f0000000-0000-4000-8000-0000000000d3';
UPDATE public.meetings SET status='approved'
  WHERE id='f0000000-0000-4000-8000-0000000000c3';

-- A partir de aqui se actua como el docente autenticado.
SET LOCAL request.jwt.claims =
  '{"sub":"f0000000-0000-4000-8000-000000000001","role":"authenticated"}';

SELECT pg_temp.expect_failure('D1 sign_minutes rechaza una sola firma',
  $q$SELECT public.sign_minutes('f0000000-0000-4000-8000-0000000000d3',
      '[{"signer_name":"Docente","signer_role":"teacher","signature_path":"x"}]'::jsonb,
      'v1')$q$);

SELECT pg_temp.expect('D2 el rechazo no dejo firmas parciales',
  (SELECT count(*) = 0 FROM public.signatures
   WHERE minutes_id='f0000000-0000-4000-8000-0000000000d3'));

SELECT pg_temp.expect('D3 el rechazo no movio el estado',
  (SELECT status='approved' FROM public.meetings
   WHERE id='f0000000-0000-4000-8000-0000000000c3'));

SELECT pg_temp.expect_success('D4 sign_minutes firma y finaliza',
  $q$SELECT public.sign_minutes('f0000000-0000-4000-8000-0000000000d3',
      '[{"signer_name":"Docente","signer_role":"teacher","signature_path":"x"},
        {"signer_name":"Representante","signer_role":"representative","signature_path":"y"}]'::jsonb,
      'v1')$q$);

SELECT pg_temp.expect('D5 la reunion quedo firmada',
  (SELECT status='signed' FROM public.meetings
   WHERE id='f0000000-0000-4000-8000-0000000000c3'));

SELECT pg_temp.expect('D6 se registraron las dos firmas',
  (SELECT count(*) = 2 FROM public.signatures
   WHERE minutes_id='f0000000-0000-4000-8000-0000000000d3'));

SELECT pg_temp.expect('D7 la firma quedo auditada',
  (SELECT count(*) >= 1 FROM public.audit_logs
   WHERE meeting_id='f0000000-0000-4000-8000-0000000000c3'
     AND action='minutes.signed'));

SELECT pg_temp.expect('D8 repetir la llamada es idempotente',
  ((SELECT public.sign_minutes('f0000000-0000-4000-8000-0000000000d3',
      '[{"signer_name":"Docente","signer_role":"teacher","signature_path":"x"},
        {"signer_name":"Representante","signer_role":"representative","signature_path":"y"}]'::jsonb,
      'v1'))->>'already_signed')::boolean);

RESET request.jwt.claims;

-- ---------------------------------------------------------------- informe

\echo ''
SELECT CASE WHEN passed THEN '  PASA  ' ELSE '  FALLA ' END
       || rpad(name, 44) || coalesce(detail, '') AS "pruebas de seguridad"
FROM results ORDER BY id;

\echo ''
SELECT count(*) FILTER (WHERE passed) || ' / ' || count(*) || ' superadas'
  AS "total" FROM results;

DO $chk$
DECLARE failed integer;
BEGIN
    SELECT count(*) INTO failed FROM results WHERE NOT passed;
    IF failed > 0 THEN
        RAISE EXCEPTION 'Fallaron % prueba(s) de seguridad', failed;
    END IF;
END;
$chk$;

ROLLBACK;
