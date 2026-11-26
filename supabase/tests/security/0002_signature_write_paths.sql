-- ACTA PRO · pruebas de seguridad: vias de escritura de firmas
--
-- Comprueba que la operacion transaccional no se puede eludir y que repetirla
-- con contenido distinto no devuelve exito. Revierte siempre.

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL client_min_messages TO WARNING;

CREATE TEMP TABLE results (
    id serial primary key,
    name text not null,
    passed boolean not null,
    detail text
) ON COMMIT DROP;

-- Parte de estas pruebas corre como `authenticated`, que necesita poder
-- anotar sus resultados en la tabla temporal.
GRANT ALL ON results TO authenticated;
GRANT ALL ON SEQUENCE results_id_seq TO authenticated;

CREATE FUNCTION pg_temp.expect_failure(test_name text, stmt text)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
    BEGIN
        EXECUTE stmt;
        INSERT INTO results (name, passed, detail)
        VALUES (test_name, false, 'deberia haber fallado y no fallo');
    EXCEPTION WHEN others THEN
        INSERT INTO results (name, passed, detail)
        VALUES (test_name, true, left(SQLERRM, 58));
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
        VALUES (test_name, false, left(SQLERRM, 58));
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
VALUES ('e1000000-0000-4000-8000-000000000001', 'docente2@test.invalid');

INSERT INTO public.institutions (id, name)
VALUES ('e1000000-0000-4000-8000-0000000000a1', 'Institucion dos');

INSERT INTO public.profiles (id, full_name, email, role, institution_id)
VALUES ('e1000000-0000-4000-8000-000000000001', 'Docente Dos',
        'docente2@test.invalid', 'teacher',
        'e1000000-0000-4000-8000-0000000000a1');

INSERT INTO public.students (id, institution_id, full_name)
VALUES ('e1000000-0000-4000-8000-0000000000b1',
        'e1000000-0000-4000-8000-0000000000a1', 'Estudiante Dos');

INSERT INTO public.meetings (id, institution_id, teacher_id, student_id, title, status)
VALUES ('e1000000-0000-4000-8000-0000000000c1','e1000000-0000-4000-8000-0000000000a1',
        'e1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-0000000000b1',
        'Vias de escritura','scheduled');

UPDATE public.meetings SET status='ready'      WHERE id='e1000000-0000-4000-8000-0000000000c1';
UPDATE public.meetings SET status='recording'  WHERE id='e1000000-0000-4000-8000-0000000000c1';
UPDATE public.meetings SET status='processing' WHERE id='e1000000-0000-4000-8000-0000000000c1';
UPDATE public.meetings SET status='draft'      WHERE id='e1000000-0000-4000-8000-0000000000c1';

INSERT INTO public.minutes (id, meeting_id, version, status, summary)
VALUES ('e1000000-0000-4000-8000-0000000000d1',
        'e1000000-0000-4000-8000-0000000000c1', 1, 'draft', 'Resumen');

UPDATE public.minutes  SET status='approved', approved_at=now()
  WHERE id='e1000000-0000-4000-8000-0000000000d1';
UPDATE public.meetings SET status='approved'
  WHERE id='e1000000-0000-4000-8000-0000000000c1';

-- ------------------------------------- E · la Data API no escribe firmas
-- El rol `authenticated` es el que recibe una peticion desde el navegador.

SET LOCAL request.jwt.claims =
  '{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT pg_temp.expect_failure('E1 INSERT directo en signatures',
  $q$INSERT INTO public.signatures
     (minutes_id, signer_name, signer_role, signature_path, acceptance_text_version)
     VALUES ('e1000000-0000-4000-8000-0000000000d1','Intruso','teacher','x','v1')$q$);

SELECT pg_temp.expect_failure('E2 UPDATE directo en signatures',
  $q$UPDATE public.signatures SET signer_name='Otro'
     WHERE minutes_id='e1000000-0000-4000-8000-0000000000d1'$q$);

SELECT pg_temp.expect_failure('E3 DELETE directo en signatures',
  $q$DELETE FROM public.signatures
     WHERE minutes_id='e1000000-0000-4000-8000-0000000000d1'$q$);

SELECT pg_temp.expect_success('E4 SELECT sobre firmas propias sigue permitido',
  $q$SELECT count(*) FROM public.signatures
     WHERE minutes_id='e1000000-0000-4000-8000-0000000000d1'$q$);

-- ------------------------------------- F · idempotencia honesta del RPC

SELECT pg_temp.expect_success('F1 sign_minutes firma por la via autorizada',
  $q$SELECT public.sign_minutes('e1000000-0000-4000-8000-0000000000d1',
      '[{"signer_name":"Docente","signer_role":"teacher","signature_path":"AAA"},
        {"signer_name":"Representante","signer_role":"representative","signature_path":"BBB"}]'::jsonb,
      'v1')$q$);

SELECT pg_temp.expect('F2 la reunion quedo firmada',
  (SELECT status='signed' FROM public.meetings
   WHERE id='e1000000-0000-4000-8000-0000000000c1'));

SELECT pg_temp.expect('F3 repetir identico es idempotente',
  ((SELECT public.sign_minutes('e1000000-0000-4000-8000-0000000000d1',
      '[{"signer_name":"Docente","signer_role":"teacher","signature_path":"AAA"},
        {"signer_name":"Representante","signer_role":"representative","signature_path":"BBB"}]'::jsonb,
      'v1'))->>'already_signed')::boolean);

SELECT pg_temp.expect('F4 el orden no afecta a la idempotencia',
  ((SELECT public.sign_minutes('e1000000-0000-4000-8000-0000000000d1',
      '[{"signer_name":"Representante","signer_role":"representative","signature_path":"BBB"},
        {"signer_name":"Docente","signer_role":"teacher","signature_path":"AAA"}]'::jsonb,
      'v1'))->>'already_signed')::boolean);

SELECT pg_temp.expect_failure('F5 repetir con contenido distinto se rechaza',
  $q$SELECT public.sign_minutes('e1000000-0000-4000-8000-0000000000d1',
      '[{"signer_name":"Docente","signer_role":"teacher","signature_path":"AAA"},
        {"signer_name":"Otro","signer_role":"representative","signature_path":"ZZZ"}]'::jsonb,
      'v1')$q$);

RESET ROLE;

SELECT pg_temp.expect('F6 el rechazo no altero la firma almacenada',
  (SELECT signature_path='BBB' FROM public.signatures
   WHERE minutes_id='e1000000-0000-4000-8000-0000000000d1'
     AND signer_role='representative'));

-- ---------------------------------------------------------------- informe

\echo ''
SELECT CASE WHEN passed THEN '  PASA  ' ELSE '  FALLA ' END
       || rpad(name, 44) || coalesce(detail, '') AS "vias de escritura de firmas"
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
