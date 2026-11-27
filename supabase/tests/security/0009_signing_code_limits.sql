-- ACTA PRO · pruebas de seguridad: limites del codigo de firma
--
-- `public.verify_signing_code` concentra tres protecciones en una sola
-- clausula: `expires_at > now()`, `NOT verified` y `attempts < 5`. La prueba de
-- integracion ya cubre que un codigo usado no se puede reutilizar; aqui se
-- cubren las otras dos, que no estaban probadas: **la caducidad** y **el tope
-- de cinco intentos**.
--
-- No hace falta conocer el codigo real: la funcion compara cadenas, de modo que
-- se insertan desafios con un hash conocido y se verifica el comportamiento.
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

CREATE FUNCTION pg_temp.expect(test_name text, condition boolean)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
    INSERT INTO results (name, passed, detail)
    VALUES (test_name, coalesce(condition, false), NULL);
END;
$fn$;

-- ------------------------------------------------------------ datos ficticios

INSERT INTO auth.users (id, email)
VALUES ('c9000000-0000-4000-8000-000000000001', 'docente.cod@test.invalid');

INSERT INTO public.institutions (id, name)
VALUES ('c9000000-0000-4000-8000-0000000000a1', 'Institucion de codigos');

INSERT INTO public.profiles (id, full_name, email, role, institution_id)
VALUES ('c9000000-0000-4000-8000-000000000001', 'Docente Codigo',
        'docente.cod@test.invalid', 'teacher',
        'c9000000-0000-4000-8000-0000000000a1');

INSERT INTO public.students (id, institution_id, full_name)
VALUES ('c9000000-0000-4000-8000-0000000000b1',
        'c9000000-0000-4000-8000-0000000000a1', 'Estudiante Codigo');

INSERT INTO public.representatives (id, full_name, email)
VALUES ('c9000000-0000-4000-8000-0000000000e1', 'Madre Codigo',
        'madre.codigo@test.invalid');

INSERT INTO public.student_representatives (student_id, representative_id, relationship)
VALUES ('c9000000-0000-4000-8000-0000000000b1',
        'c9000000-0000-4000-8000-0000000000e1', 'madre');

INSERT INTO public.meetings (id, institution_id, teacher_id, student_id, title, status)
VALUES ('c9000000-0000-4000-8000-0000000000c1','c9000000-0000-4000-8000-0000000000a1',
        'c9000000-0000-4000-8000-000000000001','c9000000-0000-4000-8000-0000000000b1',
        'Codigos de firma','scheduled');

-- `signing_challenges` tiene su clave primaria en `minutes_id`: un desafio
-- vivo por acta, de modo que pedir un codigo nuevo reemplaza al anterior en
-- lugar de acumularlos. Por eso los tres casos necesitan tres actas.
INSERT INTO public.minutes (id, meeting_id, version, status, summary)
VALUES ('c9000000-0000-4000-8000-0000000000d1',
        'c9000000-0000-4000-8000-0000000000c1', 1, 'draft', 'Vigente'),
       ('c9000000-0000-4000-8000-0000000000d2',
        'c9000000-0000-4000-8000-0000000000c1', 2, 'draft', 'Caducado'),
       ('c9000000-0000-4000-8000-0000000000d3',
        'c9000000-0000-4000-8000-0000000000c1', 3, 'draft', 'Agotado');

-- Tres desafios: uno vigente, uno caducado y uno al borde del tope.
INSERT INTO public.signing_challenges
    (minutes_id, version, actor_id, representative_id, email, salt, code_hash,
     expires_at, attempts, verified)
VALUES
    ('c9000000-0000-4000-8000-0000000000d1', 1,
     'c9000000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-0000000000e1',
     'madre.codigo@test.invalid', '11111111-1111-4111-8111-111111111111',
     'HASH-VIGENTE', now() + interval '10 minutes', 0, false),
    ('c9000000-0000-4000-8000-0000000000d2', 2,
     'c9000000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-0000000000e1',
     'madre.codigo@test.invalid', '22222222-2222-4222-8222-222222222222',
     'HASH-CADUCADO', now() - interval '1 minute', 0, false),
    ('c9000000-0000-4000-8000-0000000000d3', 3,
     'c9000000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-0000000000e1',
     'madre.codigo@test.invalid', '33333333-3333-4333-8333-333333333333',
     'HASH-AGOTADO', now() + interval '10 minutes', 5, false);

-- ------------------------------------------- FF · caducidad

SELECT pg_temp.expect('FF1 un codigo caducado no verifica, aunque sea el correcto',
  public.verify_signing_code(
    'c9000000-0000-4000-8000-0000000000d2',
    'c9000000-0000-4000-8000-000000000001',
    '22222222-2222-4222-8222-222222222222', 'HASH-CADUCADO') = false);

SELECT pg_temp.expect('FF2 el desafio caducado ni siquiera cuenta el intento',
  (SELECT attempts = 0 FROM public.signing_challenges
    WHERE salt = '22222222-2222-4222-8222-222222222222'));

-- ------------------------------------------- GG · tope de cinco intentos

SELECT pg_temp.expect('GG1 con cinco intentos gastados, el correcto ya no sirve',
  public.verify_signing_code(
    'c9000000-0000-4000-8000-0000000000d3',
    'c9000000-0000-4000-8000-000000000001',
    '33333333-3333-4333-8333-333333333333', 'HASH-AGOTADO') = false);

SELECT pg_temp.expect('GG2 y el contador no pasa de cinco',
  (SELECT attempts = 5 FROM public.signing_challenges
    WHERE salt = '33333333-3333-4333-8333-333333333333'));

-- ------------------------------------------- HH · el camino correcto

SELECT pg_temp.expect('HH1 un codigo erroneo no verifica pero gasta intento',
  public.verify_signing_code(
    'c9000000-0000-4000-8000-0000000000d1',
    'c9000000-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111', 'HASH-EQUIVOCADO') = false);

SELECT pg_temp.expect('HH2 el intento quedo contado',
  (SELECT attempts = 1 FROM public.signing_challenges
    WHERE salt = '11111111-1111-4111-8111-111111111111'));

SELECT pg_temp.expect('HH3 el codigo correcto verifica',
  public.verify_signing_code(
    'c9000000-0000-4000-8000-0000000000d1',
    'c9000000-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111', 'HASH-VIGENTE') = true);

SELECT pg_temp.expect('HH4 reutilizar el mismo codigo ya no verifica',
  public.verify_signing_code(
    'c9000000-0000-4000-8000-0000000000d1',
    'c9000000-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111', 'HASH-VIGENTE') = false);

-- ------------------------------------------- II · a quien esta atado

SELECT pg_temp.expect('II1 el desafio queda atado al acta, su version y el representante',
  (SELECT minutes_id = 'c9000000-0000-4000-8000-0000000000d1'
      AND version = 1
      AND representative_id = 'c9000000-0000-4000-8000-0000000000e1'
      AND actor_id = 'c9000000-0000-4000-8000-000000000001'
     FROM public.signing_challenges
    WHERE salt = '11111111-1111-4111-8111-111111111111'));

SELECT pg_temp.expect('II2 otro actor no puede consumir el desafio ajeno',
  public.verify_signing_code(
    'c9000000-0000-4000-8000-0000000000d3',
    'c9000000-0000-4000-8000-000000000999'::uuid,
    '33333333-3333-4333-8333-333333333333', 'HASH-AGOTADO') = false);

-- ------------------------------------------- JJ · nada de esto llega al navegador

SELECT pg_temp.expect('JJ1 authenticated no ejecuta verify_signing_code',
  NOT has_function_privilege('authenticated',
    'public.verify_signing_code(uuid,uuid,uuid,text)', 'EXECUTE'));

SELECT pg_temp.expect('JJ2 authenticated no lee ni escribe signing_challenges',
  NOT has_table_privilege('authenticated', 'public.signing_challenges', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.signing_challenges', 'UPDATE'));

SELECT pg_temp.expect('JJ3 anon tampoco',
  NOT has_function_privilege('anon',
    'public.verify_signing_code(uuid,uuid,uuid,text)', 'EXECUTE')
  AND NOT has_table_privilege('anon', 'public.signing_challenges', 'SELECT'));

\echo ''
SELECT CASE WHEN passed THEN '  PASA  ' ELSE '  FALLA ' END
       || rpad(name, 56) || coalesce(detail, '') AS "limites del codigo de firma"
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
