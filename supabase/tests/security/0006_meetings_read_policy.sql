-- ACTA PRO · pruebas de seguridad: politica de lectura de reuniones
--
-- La migracion 20261127030000 reescribio `meetings_read` para que mire las
-- columnas de la fila en lugar de volver a consultar la tabla. El objetivo era
-- que `INSERT ... RETURNING` funcionara; el riesgo, conceder de mas sin darse
-- cuenta. Estas pruebas comprueban las dos cosas: que ahora se puede crear una
-- reunion y recibirla de vuelta, y que **el conjunto de lo visible no crecio**.
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

-- ------------------------------------------------------------ datos ficticios
-- Dos instituciones. En la primera, dos docentes y una administradora.

INSERT INTO auth.users (id, email) VALUES
  ('f1000000-0000-4000-8000-000000000001', 'docente.a@test.invalid'),
  ('f1000000-0000-4000-8000-000000000002', 'colega.a@test.invalid'),
  ('f1000000-0000-4000-8000-000000000003', 'admin.a@test.invalid'),
  ('f1000000-0000-4000-8000-000000000004', 'docente.b@test.invalid');

INSERT INTO public.institutions (id, name) VALUES
  ('f1000000-0000-4000-8000-0000000000a1', 'Institucion A'),
  ('f1000000-0000-4000-8000-0000000000a2', 'Institucion B');

INSERT INTO public.profiles (id, full_name, email, role, institution_id) VALUES
  ('f1000000-0000-4000-8000-000000000001', 'Docente A', 'docente.a@test.invalid', 'teacher',
   'f1000000-0000-4000-8000-0000000000a1'),
  ('f1000000-0000-4000-8000-000000000002', 'Colega A', 'colega.a@test.invalid', 'teacher',
   'f1000000-0000-4000-8000-0000000000a1'),
  ('f1000000-0000-4000-8000-000000000003', 'Admin A', 'admin.a@test.invalid', 'admin',
   'f1000000-0000-4000-8000-0000000000a1'),
  ('f1000000-0000-4000-8000-000000000004', 'Docente B', 'docente.b@test.invalid', 'teacher',
   'f1000000-0000-4000-8000-0000000000a2');

INSERT INTO public.students (id, institution_id, full_name) VALUES
  ('f1000000-0000-4000-8000-0000000000b1', 'f1000000-0000-4000-8000-0000000000a1', 'Estudiante A'),
  ('f1000000-0000-4000-8000-0000000000b2', 'f1000000-0000-4000-8000-0000000000a2', 'Estudiante B');

-- Una reunion de cada docente.
INSERT INTO public.meetings (id, institution_id, teacher_id, student_id, title, status) VALUES
  ('f1000000-0000-4000-8000-0000000000c1', 'f1000000-0000-4000-8000-0000000000a1',
   'f1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-0000000000b1', 'Propia de A', 'scheduled'),
  ('f1000000-0000-4000-8000-0000000000c2', 'f1000000-0000-4000-8000-0000000000a1',
   'f1000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-0000000000b1', 'De la colega', 'scheduled'),
  ('f1000000-0000-4000-8000-0000000000c3', 'f1000000-0000-4000-8000-0000000000a2',
   'f1000000-0000-4000-8000-000000000004', 'f1000000-0000-4000-8000-0000000000b2', 'De la otra institucion', 'scheduled');

-- ------------------------------------------- S · lo que ve una docente normal

SET LOCAL request.jwt.claims =
  '{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT pg_temp.expect('S1 la docente ve su propia reunion',
  (SELECT count(*) = 1 FROM public.meetings
    WHERE id = 'f1000000-0000-4000-8000-0000000000c1'));

SELECT pg_temp.expect('S2 no ve la reunion de otra institucion',
  (SELECT count(*) = 0 FROM public.meetings
    WHERE id = 'f1000000-0000-4000-8000-0000000000c3'));

SELECT pg_temp.expect('S3 no ve la reunion de una colega',
  (SELECT count(*) = 0 FROM public.meetings
    WHERE id = 'f1000000-0000-4000-8000-0000000000c2'));

SELECT pg_temp.expect('S4 ve exactamente una reunion en total',
  (SELECT count(*) = 1 FROM public.meetings));

-- -------------------------------------- T · el INSERT ... RETURNING funciona
-- Es el fallo que motivo la migracion: la fila cumple la politica pero no
-- podia verse a si misma dentro de la misma sentencia.

SELECT pg_temp.expect_success('T1 crear una reunion y recibirla de vuelta',
  $q$WITH nueva AS (
       INSERT INTO public.meetings (institution_id, teacher_id, student_id, title, status)
       VALUES ('f1000000-0000-4000-8000-0000000000a1',
               'f1000000-0000-4000-8000-000000000001',
               'f1000000-0000-4000-8000-0000000000b1', 'Creada con RETURNING', 'scheduled')
       RETURNING id
     )
     SELECT 1 FROM nueva$q$);

SELECT pg_temp.expect('T2 la reunion creada existe y es suya',
  (SELECT count(*) = 1 FROM public.meetings WHERE title = 'Creada con RETURNING'));

SELECT pg_temp.expect('T3 sigue sin ver nada ajeno despues de crear',
  (SELECT count(*) = 0 FROM public.meetings
    WHERE institution_id = 'f1000000-0000-4000-8000-0000000000a2'));

RESET ROLE;

-- ------------------------------------------------- U · lo que ve una admin
-- La politica conserva la excepcion de administracion, ni mas ni menos.

SET LOCAL request.jwt.claims =
  '{"sub":"f1000000-0000-4000-8000-000000000003","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT pg_temp.expect('U1 la admin ve la reunion de la colega',
  (SELECT count(*) = 1 FROM public.meetings
    WHERE id = 'f1000000-0000-4000-8000-0000000000c2'));

SELECT pg_temp.expect('U2 la admin no ve la otra institucion',
  (SELECT count(*) = 0 FROM public.meetings
    WHERE institution_id = 'f1000000-0000-4000-8000-0000000000a2'));

RESET ROLE;

-- ------------------------------------------------- V · forma de la politica

SELECT pg_temp.expect('V1 hay una sola politica de lectura en meetings',
  (SELECT count(*) = 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'meetings' AND cmd = 'SELECT'));

SELECT pg_temp.expect('V2 la politica ya no reconsulta la tabla meetings',
  (SELECT qual NOT LIKE '%can_access_meeting%' FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'meetings' AND cmd = 'SELECT'));

SELECT pg_temp.expect('V3 can_access_meeting sigue existiendo para las hijas',
  (SELECT count(*) = 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'acta_private' AND p.proname = 'can_access_meeting'));

\echo ''
SELECT CASE WHEN passed THEN '  PASA  ' ELSE '  FALLA ' END
       || rpad(name, 44) || coalesce(detail, '') AS "politica de lectura de reuniones"
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
