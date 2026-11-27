-- ACTA PRO · pruebas de seguridad: privilegios y auditoria
--
-- El hallazgo que motiva este archivo es que TRUNCATE no pasa por RLS: con el
-- privilegio concedido, unas politicas correctas no impedian vaciar la tabla.
-- Estas pruebas fijan el minimo privilegio para que no se reintroduzca.

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL client_min_messages TO WARNING;

CREATE TEMP TABLE results (
    id serial primary key,
    name text not null,
    passed boolean not null,
    detail text
) ON COMMIT DROP;

GRANT ALL ON results TO authenticated, anon;
GRANT ALL ON SEQUENCE results_id_seq TO authenticated, anon;

CREATE FUNCTION pg_temp.expect_failure(test_name text, stmt text)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
    BEGIN
        EXECUTE stmt;
        INSERT INTO results (name, passed, detail)
        VALUES (test_name, false, 'deberia haber fallado y no fallo');
    EXCEPTION WHEN others THEN
        INSERT INTO results (name, passed, detail)
        VALUES (test_name, true, left(SQLERRM, 56));
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
        VALUES (test_name, false, left(SQLERRM, 56));
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

INSERT INTO auth.users (id, email) VALUES
  ('d1000000-0000-4000-8000-000000000001', 'propia@test.invalid'),
  ('d1000000-0000-4000-8000-000000000002', 'ajena@test.invalid');

INSERT INTO public.institutions (id, name) VALUES
  ('d1000000-0000-4000-8000-0000000000a1', 'Institucion propia'),
  ('d1000000-0000-4000-8000-0000000000a2', 'Institucion ajena');

INSERT INTO public.profiles (id, full_name, email, role, institution_id) VALUES
  ('d1000000-0000-4000-8000-000000000001','Docente Propia','propia@test.invalid',
   'teacher','d1000000-0000-4000-8000-0000000000a1'),
  ('d1000000-0000-4000-8000-000000000002','Docente Ajena','ajena@test.invalid',
   'teacher','d1000000-0000-4000-8000-0000000000a2');

INSERT INTO public.students (id, institution_id, full_name) VALUES
  ('d1000000-0000-4000-8000-0000000000b1','d1000000-0000-4000-8000-0000000000a1','Alumna Propia'),
  ('d1000000-0000-4000-8000-0000000000b2','d1000000-0000-4000-8000-0000000000a2','Alumna Ajena');

INSERT INTO public.meetings (id, institution_id, teacher_id, student_id, title, status) VALUES
  ('d1000000-0000-4000-8000-0000000000c1','d1000000-0000-4000-8000-0000000000a1',
   'd1000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-0000000000b1','Propia','scheduled'),
  ('d1000000-0000-4000-8000-0000000000c2','d1000000-0000-4000-8000-0000000000a2',
   'd1000000-0000-4000-8000-000000000002','d1000000-0000-4000-8000-0000000000b2','Ajena','scheduled');

-- ------------------------------------------------- G · privilegios de tabla

SET LOCAL request.jwt.claims =
  '{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}';
SET LOCAL ROLE authenticated;

-- TRUNCATE no pasa por RLS: el unico freno es no tener el privilegio.
SELECT pg_temp.expect_failure('G1 TRUNCATE sobre audit_logs',
  $q$TRUNCATE public.audit_logs$q$);
SELECT pg_temp.expect_failure('G2 TRUNCATE sobre meetings',
  $q$TRUNCATE public.meetings$q$);
SELECT pg_temp.expect_failure('G3 TRUNCATE sobre minutes',
  $q$TRUNCATE public.minutes$q$);

-- Las tres anteriores no bastan, y conviene decir por que. `meetings` y
-- `minutes` estan referenciadas por claves foraneas, de modo que su TRUNCATE
-- falla por eso aunque el privilegio estuviera concedido: pasarian igual. Se
-- comprobo devolviendo el privilegio en la base local y repitiendo la suite,
-- y solo G1 -sobre una tabla sin referencias- lo delato.
--
-- La comprobacion que no admite falsos aprobados es mirar el privilegio en si.
SELECT pg_temp.expect('G6 authenticated no tiene TRUNCATE en ninguna tabla',
  (SELECT count(*) = 0
   FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace
     AND c.relkind = 'r'
     AND has_table_privilege('authenticated', c.oid, 'TRUNCATE')));

SELECT pg_temp.expect('G7 anon no tiene ningun privilegio en public',
  (SELECT count(*) = 0
   FROM information_schema.role_table_grants
   WHERE grantee = 'anon' AND table_schema = 'public'));

SELECT pg_temp.expect_failure('G4 escribir en profiles',
  $q$UPDATE public.profiles SET role='admin'
     WHERE id='d1000000-0000-4000-8000-000000000001'$q$);

SELECT pg_temp.expect_failure('G5 leer credenciales de Google',
  $q$SELECT count(*) FROM public.google_credentials$q$);

-- ------------------------------------------------------ H · auditoria fiable

SELECT pg_temp.expect_failure('H1 suplantar al actor',
  $q$INSERT INTO public.audit_logs (institution_id, actor_id, meeting_id, action)
     VALUES ('d1000000-0000-4000-8000-0000000000a1',
             'd1000000-0000-4000-8000-000000000002',
             'd1000000-0000-4000-8000-0000000000c1','meeting.created')$q$);

SELECT pg_temp.expect_failure('H2 anotar en otra institucion',
  $q$INSERT INTO public.audit_logs (institution_id, actor_id, meeting_id, action)
     VALUES ('d1000000-0000-4000-8000-0000000000a2',
             'd1000000-0000-4000-8000-000000000001',
             NULL,'meeting.created')$q$);

SELECT pg_temp.expect_failure('H3 anotar sobre una reunion ajena',
  $q$INSERT INTO public.audit_logs (institution_id, actor_id, meeting_id, action)
     VALUES ('d1000000-0000-4000-8000-0000000000a1',
             'd1000000-0000-4000-8000-000000000001',
             'd1000000-0000-4000-8000-0000000000c2','meeting.created')$q$);

SELECT pg_temp.expect_failure('H4 fabricar un evento de firma',
  $q$INSERT INTO public.audit_logs (institution_id, actor_id, meeting_id, action)
     VALUES ('d1000000-0000-4000-8000-0000000000a1',
             'd1000000-0000-4000-8000-000000000001',
             'd1000000-0000-4000-8000-0000000000c1','minutes.signed')$q$);

SELECT pg_temp.expect_failure('H5 fabricar una reapertura',
  $q$INSERT INTO public.audit_logs (institution_id, actor_id, meeting_id, action)
     VALUES ('d1000000-0000-4000-8000-0000000000a1',
             'd1000000-0000-4000-8000-000000000001',
             'd1000000-0000-4000-8000-0000000000c1','minutes.reopened')$q$);

SELECT pg_temp.expect_success('H6 anotar un evento legitimo propio',
  $q$INSERT INTO public.audit_logs (institution_id, actor_id, meeting_id, action)
     VALUES ('d1000000-0000-4000-8000-0000000000a1',
             'd1000000-0000-4000-8000-000000000001',
             'd1000000-0000-4000-8000-0000000000c1','meeting.created')$q$);

SELECT pg_temp.expect_failure('H7 reescribir una anotacion',
  $q$UPDATE public.audit_logs SET action='otra'
     WHERE meeting_id='d1000000-0000-4000-8000-0000000000c1'$q$);

SELECT pg_temp.expect_failure('H8 borrar una anotacion',
  $q$DELETE FROM public.audit_logs
     WHERE meeting_id='d1000000-0000-4000-8000-0000000000c1'$q$);

-- ------------------------------------------- I · aislamiento institucional

SELECT pg_temp.expect('I1 no se ve la reunion de otra institucion',
  (SELECT count(*) = 0 FROM public.meetings
   WHERE id='d1000000-0000-4000-8000-0000000000c2'));

SELECT pg_temp.expect('I2 si se ve la reunion propia',
  (SELECT count(*) = 1 FROM public.meetings
   WHERE id='d1000000-0000-4000-8000-0000000000c1'));

RESET ROLE;

-- --------------------------------------------------------- J · rol anonimo

SET LOCAL request.jwt.claims = '{"role":"anon"}';
SET LOCAL ROLE anon;

SELECT pg_temp.expect_failure('J1 anon no lee reuniones',
  $q$SELECT count(*) FROM public.meetings$q$);
SELECT pg_temp.expect_failure('J2 anon no lee la auditoria',
  $q$SELECT count(*) FROM public.audit_logs$q$);
SELECT pg_temp.expect_failure('J3 anon no puede vaciar tablas',
  $q$TRUNCATE public.audit_logs$q$);

RESET ROLE;

-- ---------------------------------------------------------------- informe

\echo ''
SELECT CASE WHEN passed THEN '  PASA  ' ELSE '  FALLA ' END
       || rpad(name, 44) || coalesce(detail, '') AS "privilegios y auditoria"
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
