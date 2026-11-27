-- ACTA PRO · pruebas de seguridad: identidad de quien firma
--
-- La migracion 20261127040000 ato cada firma a la sesion que la capturo
-- (`signed_by`) y declaro como se verifico a quien firma
-- (`verification_method`). Estas pruebas comprueban que los dos valores los
-- pone la base a partir de `auth.uid()` -no el navegador-, que distinguen el
-- caso de la docente del caso del representante, y que no se pueden cambiar
-- despues.
--
-- Revierte siempre.

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL client_min_messages TO WARNING;

CREATE TEMP TABLE results (
    id serial primary key,
    name text not null,
    passed boolean not null,
    detail text
) ON COMMIT DROP;

GRANT ALL ON results TO authenticated;
GRANT ALL ON SEQUENCE results_id_seq TO authenticated;

CREATE FUNCTION pg_temp.expect(test_name text, condition boolean)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
    INSERT INTO results (name, passed, detail)
    VALUES (test_name, coalesce(condition, false), NULL);
END;
$fn$;

CREATE FUNCTION pg_temp.expect_failure(test_name text, stmt text)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
    BEGIN
        EXECUTE stmt;
        INSERT INTO results (name, passed, detail)
        VALUES (test_name, false, 'deberia haber fallado y no fallo');
    EXCEPTION WHEN others THEN
        INSERT INTO results (name, passed, detail)
        VALUES (test_name, true, left(SQLERRM, 46));
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
        VALUES (test_name, false, left(SQLERRM, 46));
    END;
END;
$fn$;

-- ------------------------------------------------------------ datos ficticios

INSERT INTO auth.users (id, email)
VALUES ('a7000000-0000-4000-8000-000000000001', 'docente.firma@test.invalid');

INSERT INTO public.institutions (id, name)
VALUES ('a7000000-0000-4000-8000-0000000000a1', 'Institucion de firmas');

INSERT INTO public.profiles (id, full_name, email, role, institution_id)
VALUES ('a7000000-0000-4000-8000-000000000001', 'Docente Firma',
        'docente.firma@test.invalid', 'teacher',
        'a7000000-0000-4000-8000-0000000000a1');

INSERT INTO public.students (id, institution_id, full_name)
VALUES ('a7000000-0000-4000-8000-0000000000b1',
        'a7000000-0000-4000-8000-0000000000a1', 'Estudiante Firma');

INSERT INTO public.meetings (id, institution_id, teacher_id, student_id, title, status)
VALUES ('a7000000-0000-4000-8000-0000000000c1','a7000000-0000-4000-8000-0000000000a1',
        'a7000000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-0000000000b1',
        'Identidad de firmas','scheduled');

UPDATE public.meetings SET status='ready'      WHERE id='a7000000-0000-4000-8000-0000000000c1';
UPDATE public.meetings SET status='recording'  WHERE id='a7000000-0000-4000-8000-0000000000c1';
UPDATE public.meetings SET status='processing' WHERE id='a7000000-0000-4000-8000-0000000000c1';
UPDATE public.meetings SET status='draft'      WHERE id='a7000000-0000-4000-8000-0000000000c1';

INSERT INTO public.minutes (id, meeting_id, version, status, summary)
VALUES ('a7000000-0000-4000-8000-0000000000d1',
        'a7000000-0000-4000-8000-0000000000c1', 1, 'draft', 'Resumen');

UPDATE public.minutes SET status='approved', approved_at=now()
 WHERE id='a7000000-0000-4000-8000-0000000000d1';
UPDATE public.meetings SET status='approved'
 WHERE id='a7000000-0000-4000-8000-0000000000c1';

-- --------------------------------- W · lo que queda registrado al firmar

SELECT pg_temp.prepare_signing_fixture('a7000000-0000-4000-8000-0000000000d1','Madre');
SET LOCAL request.jwt.claims =
  '{"sub":"a7000000-0000-4000-8000-000000000001","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT pg_temp.expect_success('W1 la firma por la via autorizada funciona',
  $q$SELECT public.sign_minutes('a7000000-0000-4000-8000-0000000000d1',
      '[{"signer_name":"Docente Firma","signer_role":"teacher","signature_path":"AAA"},
        {"signer_name":"Madre","signer_role":"representative","signature_path":"BBB"}]'::jsonb,
      'aceptacion-v1')$q$);

SELECT pg_temp.expect('W2 signed_by es la sesion que firmo, no un texto enviado',
  (SELECT count(*) = 2 FROM public.signatures
    WHERE minutes_id = 'a7000000-0000-4000-8000-0000000000d1'
      AND signed_by = 'a7000000-0000-4000-8000-000000000001'));

SELECT pg_temp.expect('W3 la firma docente queda como docente reautenticado',
  (SELECT verification_method = 'docente_reautenticado' FROM public.signatures
    WHERE minutes_id = 'a7000000-0000-4000-8000-0000000000d1'
      AND signer_role = 'teacher'));

SELECT pg_temp.expect('W4 la del representante, codigo por correo',
  (SELECT verification_method = 'codigo_correo' FROM public.signatures
    WHERE minutes_id = 'a7000000-0000-4000-8000-0000000000d1'
      AND signer_role = 'representative'));

-- --------------------------------- X · no se puede reescribir a posteriori

-- Desde la Data API no hay ni privilegio: `authenticated` no tiene UPDATE
-- sobre `signatures`. Se comprueba, pero se nombra por lo que es, porque esta
-- negativa no demuestra nada sobre el disparador.
SELECT pg_temp.expect_failure('X1 authenticated no tiene UPDATE sobre signatures',
  $q$UPDATE public.signatures SET verification_method = 'codigo_correo'
     WHERE minutes_id = 'a7000000-0000-4000-8000-0000000000d1'
       AND signer_role = 'representative'$q$);

RESET ROLE;

-- Y ahora lo que de verdad interesa: con todos los privilegios del dueno de la
-- tabla, el disparador sigue negandose. Si esto pasara por falta de permiso
-- seria un aprobado por el motivo equivocado; aqui no hay permiso que falte.
SELECT pg_temp.expect_failure('X2 ni el dueno cambia el metodo de verificacion',
  $q$UPDATE public.signatures SET verification_method = 'codigo_correo'
     WHERE minutes_id = 'a7000000-0000-4000-8000-0000000000d1'
       AND signer_role = 'representative'$q$);

SELECT pg_temp.expect_failure('X2b ni el dueno cambia la sesion que firmo',
  $q$UPDATE public.signatures SET signed_by = NULL
     WHERE minutes_id = 'a7000000-0000-4000-8000-0000000000d1'$q$);

SELECT pg_temp.expect('X3 tras los intentos, los valores siguen intactos',
  (SELECT count(*) = 1 FROM public.signatures
    WHERE minutes_id = 'a7000000-0000-4000-8000-0000000000d1'
      AND signer_role = 'representative'
      AND verification_method = 'codigo_correo'
      AND signed_by = 'a7000000-0000-4000-8000-000000000001'));

-- --------------------------------- Y · el dominio de valores esta acotado

SELECT pg_temp.expect_failure('Y1 un metodo desconocido se rechaza',
  $q$INSERT INTO public.signatures
       (minutes_id, signer_name, signer_role, signature_path,
        acceptance_text_version, verification_method)
     VALUES ('a7000000-0000-4000-8000-0000000000d1', 'Otro', 'other', 'CCC',
             'aceptacion-v1', 'confianza_ciega')$q$);

SELECT pg_temp.expect('Y2 el valor por defecto no presume verificacion',
  (SELECT column_default = '''no_registrado''::text'
     FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'signatures'
      AND column_name = 'verification_method'));

SELECT pg_temp.expect('Y3 codigo_correo esta permitido',
  (SELECT pg_get_constraintdef(oid) LIKE '%codigo_correo%'
     FROM pg_constraint
    WHERE conrelid = 'public.signatures'::regclass
      AND conname = 'signatures_verification_method_check'));

-- --------------------------------- Z · la auditoria lo deja por escrito

SELECT pg_temp.expect('Z1 la auditoria registra como se verifico cada firma',
  (SELECT metadata_json->'verification_methods'->>'teacher' = 'docente_reautenticado'
     FROM public.audit_logs
    WHERE meeting_id = 'a7000000-0000-4000-8000-0000000000c1'
      AND action = 'minutes.signed'
    LIMIT 1));

\echo ''
SELECT CASE WHEN passed THEN '  PASA  ' ELSE '  FALLA ' END
       || rpad(name, 48) || coalesce(detail, '') AS "identidad de quien firma"
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
