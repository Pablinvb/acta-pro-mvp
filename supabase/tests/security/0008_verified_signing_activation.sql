-- ACTA PRO · pruebas de seguridad: activación de la firma verificada
--
-- `supabase/fixes/0002_activate_verified_signing.sql` retira el permiso de
-- ejecución de `public.sign_minutes` para dejar `sign_minutes_verified` como
-- única entrada. Estas pruebas ensayan **el estado posterior a esa retirada**
-- dentro de una transacción que se revierte, y comprueban lo que de verdad
-- importa: que no quede otra via de firmar sin verificar desde el navegador.
--
-- Comprueban tambien, a proposito, el limite del diseño: el disparador
-- `require_signing_proof` **falla abierto** si nadie activo el indicador
-- `acta.require_verified_signing`. Eso es deliberado durante la transicion
-- -la version en produccion todavia firma por la via antigua- pero significa
-- que toda la proteccion descansa sobre la retirada del permiso. Conviene que
-- este escrito y probado, no supuesto.
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
        VALUES (test_name, true, left(SQLERRM, 44));
    END;
END;
$fn$;

-- ------------------------------------------------------------ datos ficticios

INSERT INTO auth.users (id, email)
VALUES ('b8000000-0000-4000-8000-000000000001', 'docente.act@test.invalid');

INSERT INTO public.institutions (id, name)
VALUES ('b8000000-0000-4000-8000-0000000000a1', 'Institucion de activacion');

INSERT INTO public.profiles (id, full_name, email, role, institution_id)
VALUES ('b8000000-0000-4000-8000-000000000001', 'Docente Activacion',
        'docente.act@test.invalid', 'teacher',
        'b8000000-0000-4000-8000-0000000000a1');

INSERT INTO public.students (id, institution_id, full_name)
VALUES ('b8000000-0000-4000-8000-0000000000b1',
        'b8000000-0000-4000-8000-0000000000a1', 'Estudiante Activacion');

INSERT INTO public.meetings (id, institution_id, teacher_id, student_id, title, status)
VALUES ('b8000000-0000-4000-8000-0000000000c1','b8000000-0000-4000-8000-0000000000a1',
        'b8000000-0000-4000-8000-000000000001','b8000000-0000-4000-8000-0000000000b1',
        'Activacion de firma','scheduled');

UPDATE public.meetings SET status='ready'      WHERE id='b8000000-0000-4000-8000-0000000000c1';
UPDATE public.meetings SET status='recording'  WHERE id='b8000000-0000-4000-8000-0000000000c1';
UPDATE public.meetings SET status='processing' WHERE id='b8000000-0000-4000-8000-0000000000c1';
UPDATE public.meetings SET status='draft'      WHERE id='b8000000-0000-4000-8000-0000000000c1';

INSERT INTO public.minutes (id, meeting_id, version, status, summary)
VALUES ('b8000000-0000-4000-8000-0000000000d1',
        'b8000000-0000-4000-8000-0000000000c1', 1, 'draft', 'Resumen');

UPDATE public.minutes SET status='approved', approved_at=now()
 WHERE id='b8000000-0000-4000-8000-0000000000d1';
UPDATE public.meetings SET status='approved'
 WHERE id='b8000000-0000-4000-8000-0000000000c1';

-- --------------------- AA · estado de partida, antes de activar

SELECT pg_temp.expect('AA1 hoy authenticated todavia puede llamar a sign_minutes',
  has_function_privilege('authenticated',
    'public.sign_minutes(uuid,jsonb,text)', 'EXECUTE'));

SELECT pg_temp.expect('AA2 y tambien a sign_minutes_verified',
  has_function_privilege('authenticated',
    'public.sign_minutes_verified(uuid,jsonb,text)', 'EXECUTE'));

SELECT pg_temp.expect('AA3 anon no puede llamar a ninguna de las dos',
  NOT has_function_privilege('anon', 'public.sign_minutes(uuid,jsonb,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon',
    'public.sign_minutes_verified(uuid,jsonb,text)', 'EXECUTE'));

-- ------------------- BB · se ensaya la retirada, dentro de esta transaccion

REVOKE EXECUTE ON FUNCTION public.sign_minutes(uuid,jsonb,text)
  FROM PUBLIC, anon, authenticated;

SELECT pg_temp.expect('BB1 tras retirar, authenticated no ejecuta sign_minutes',
  NOT has_function_privilege('authenticated',
    'public.sign_minutes(uuid,jsonb,text)', 'EXECUTE'));

SELECT pg_temp.expect('BB2 sign_minutes_verified sigue disponible',
  has_function_privilege('authenticated',
    'public.sign_minutes_verified(uuid,jsonb,text)', 'EXECUTE'));

SELECT pg_temp.expect('BB3 la comprobacion del propio archivo de activacion pasa',
  NOT has_function_privilege('authenticated',
      'public.sign_minutes(uuid,jsonb,text)', 'EXECUTE')
  AND has_function_privilege('authenticated',
      'public.sign_minutes_verified(uuid,jsonb,text)', 'EXECUTE'));

-- ------------------- CC · no queda otra via desde el navegador

SELECT pg_temp.expect('CC1 authenticated no tiene INSERT sobre signatures',
  NOT has_table_privilege('authenticated', 'public.signatures', 'INSERT'));

SELECT pg_temp.expect('CC2 tampoco UPDATE ni DELETE sobre signatures',
  NOT has_table_privilege('authenticated', 'public.signatures', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.signatures', 'DELETE'));

SELECT pg_temp.expect('CC3 authenticated no escribe en signing_challenges',
  NOT has_table_privilege('authenticated', 'public.signing_challenges', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.signing_challenges', 'UPDATE'));

SELECT pg_temp.expect('CC4 no hay otra sobrecarga de sign_minutes sin retirar',
  (SELECT count(*) = 0 FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'sign_minutes'
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')));

-- ------------------- DD · la via verificada exige la prueba

SET LOCAL request.jwt.claims =
  '{"sub":"b8000000-0000-4000-8000-000000000001","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT pg_temp.expect_failure('DD1 firmar sin desafio verificado se rechaza',
  $q$SELECT public.sign_minutes_verified('b8000000-0000-4000-8000-0000000000d1',
      '[{"signer_name":"Docente","signer_role":"teacher","signature_path":"AAA"},
        {"signer_name":"Madre","signer_role":"representative","signature_path":"BBB"}]'::jsonb,
      'aceptacion-v1')$q$);

SELECT pg_temp.expect_failure('DD2 y sign_minutes ya no esta al alcance',
  $q$SELECT public.sign_minutes('b8000000-0000-4000-8000-0000000000d1',
      '[{"signer_name":"Docente","signer_role":"teacher","signature_path":"AAA"},
        {"signer_name":"Madre","signer_role":"representative","signature_path":"BBB"}]'::jsonb,
      'aceptacion-v1')$q$);

RESET ROLE;

SELECT pg_temp.expect('DD3 ninguno de los intentos dejo firma',
  (SELECT count(*) = 0 FROM public.signatures
    WHERE minutes_id = 'b8000000-0000-4000-8000-0000000000d1'));

-- ------------------- EE · el limite del diseño, probado y no supuesto

-- Sin el indicador, el disparador **deja pasar**. Es lo que permite que la
-- version en produccion siga firmando mientras dura la transicion, y es la
-- razon por la que la retirada del permiso no es opcional: es la unica pieza
-- que sostiene la verificacion.
SELECT pg_temp.expect('EE1 el indicador no esta activo en esta transaccion',
  (SELECT coalesce(current_setting('acta.require_verified_signing', true), '')
          IS DISTINCT FROM 'on'));

INSERT INTO public.signatures
    (minutes_id, signer_name, signer_role, signature_path, acceptance_text_version)
VALUES ('b8000000-0000-4000-8000-0000000000d1', 'Sin verificar', 'teacher',
        'ZZZ', 'aceptacion-v1');

SELECT pg_temp.expect('EE2 un rol con INSERT directo firma sin verificacion',
  (SELECT count(*) = 1 FROM public.signatures
    WHERE minutes_id = 'b8000000-0000-4000-8000-0000000000d1'
      AND signer_name = 'Sin verificar'));

-- Que eso sea posible para `postgres` y `service_role` no es un agujero desde
-- el navegador -ninguno de los dos llega alli-, pero si una condicion que hay
-- que mantener: ningun camino del servidor debe insertar firmas por su cuenta
-- ni llamar a `sign_minutes` sin pasar por la entrada verificada.
SELECT pg_temp.expect('EE3 solo postgres y service_role tienen esa via',
  (SELECT count(*) = 0 FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name = 'signatures'
      AND privilege_type = 'INSERT'
      AND grantee NOT IN ('postgres', 'service_role')));

\echo ''
SELECT CASE WHEN passed THEN '  PASA  ' ELSE '  FALLA ' END
       || rpad(name, 52) || coalesce(detail, '') AS "activacion de la firma verificada"
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
