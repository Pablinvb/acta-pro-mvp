-- ACTA PRO · pruebas de seguridad: idempotencia documental
--
-- Antes, cada solicitud al generador creaba una fila y un archivo nuevos aunque
-- nada hubiera cambiado: el PDF incrustaba la fecha del reloj, de modo que los
-- bytes -y con ellos el hash y la ruta- diferian siempre. El resultado eran
-- varios "documentos" distintos de la misma acta, cada uno con su SHA-256, lo
-- que vacia de sentido la verificacion de integridad.
--
-- Estas pruebas fijan la regla en la base de datos, no solo en la aplicacion:
-- una huella de generacion por acta, y metadatos inmutables.

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
  ('e1000000-0000-4000-8000-000000000001', 'docente@test.invalid');

INSERT INTO public.institutions (id, name) VALUES
  ('e1000000-0000-4000-8000-0000000000a1', 'Institucion de prueba');

INSERT INTO public.profiles (id, full_name, email, role, institution_id) VALUES
  ('e1000000-0000-4000-8000-000000000001','Docente','docente@test.invalid',
   'teacher','e1000000-0000-4000-8000-0000000000a1');

INSERT INTO public.students (id, institution_id, full_name) VALUES
  ('e1000000-0000-4000-8000-0000000000b1','e1000000-0000-4000-8000-0000000000a1','Alumna');

INSERT INTO public.meetings (id, institution_id, teacher_id, student_id, title, status) VALUES
  ('e1000000-0000-4000-8000-0000000000c1','e1000000-0000-4000-8000-0000000000a1',
   'e1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-0000000000b1',
   'Reunion de prueba','scheduled');

INSERT INTO public.minutes (id, meeting_id, version, status, summary) VALUES
  ('e1000000-0000-4000-8000-0000000000d1','e1000000-0000-4000-8000-0000000000c1',
   1,'approved','Resumen');

-- ------------------------------------------------- K · una huella por acta

SET LOCAL request.jwt.claims =
  '{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT pg_temp.expect_success('K1 registrar un documento con huella',
  $q$INSERT INTO public.documents
       (id, minutes_id, meeting_id, storage_path, sha256, document_code, version,
        generation_fingerprint, kind)
     VALUES ('e1000000-0000-4000-8000-0000000000f1',
             'e1000000-0000-4000-8000-0000000000d1',
             'e1000000-0000-4000-8000-0000000000c1',
             'inst/alumna/acta-v1-aaa.pdf', repeat('a',64),
             'ACTA-2026-TEST0001-v1', 1, repeat('1',64), 'final')$q$);

-- Esta es la prueba central: el duplicado no depende de que la aplicacion se
-- acuerde de comprobarlo.
SELECT pg_temp.expect_failure('K2 repetir la misma huella en la misma acta',
  $q$INSERT INTO public.documents
       (minutes_id, meeting_id, storage_path, sha256, document_code, version,
        generation_fingerprint, kind)
     VALUES ('e1000000-0000-4000-8000-0000000000d1',
             'e1000000-0000-4000-8000-0000000000c1',
             'inst/alumna/acta-v1-bbb.pdf', repeat('b',64),
             'ACTA-2026-TEST0001-v1', 1, repeat('1',64), 'final')$q$);

-- Datos distintos, huella distinta: la vista previa de un borrador y el acta
-- definitiva pueden convivir.
SELECT pg_temp.expect_success('K3 otra huella para la misma acta',
  $q$INSERT INTO public.documents
       (minutes_id, meeting_id, storage_path, sha256, document_code, version,
        generation_fingerprint, kind)
     VALUES ('e1000000-0000-4000-8000-0000000000d1',
             'e1000000-0000-4000-8000-0000000000c1',
             'inst/alumna/acta-v1-ccc.pdf', repeat('c',64),
             'ACTA-2026-TEST0001-v1', 1, repeat('2',64), 'preview')$q$);

SELECT pg_temp.expect_failure('K4 huella con formato invalido',
  $q$INSERT INTO public.documents
       (minutes_id, meeting_id, storage_path, sha256, document_code, version,
        generation_fingerprint)
     VALUES ('e1000000-0000-4000-8000-0000000000d1',
             'e1000000-0000-4000-8000-0000000000c1',
             'inst/alumna/acta-v1-ddd.pdf', repeat('d',64),
             'ACTA-2026-TEST0001-v1', 1, 'no-es-un-sha256')$q$);

SELECT pg_temp.expect_failure('K5 kind fuera de los dos valores',
  $q$INSERT INTO public.documents
       (minutes_id, meeting_id, storage_path, sha256, document_code, version,
        generation_fingerprint, kind)
     VALUES ('e1000000-0000-4000-8000-0000000000d1',
             'e1000000-0000-4000-8000-0000000000c1',
             'inst/alumna/acta-v1-eee.pdf', repeat('e',64),
             'ACTA-2026-TEST0001-v1', 1, repeat('3',64), 'definitivo')$q$);

-- ------------------------------------------- L · compatibilidad historica

-- Los documentos anteriores a esta regla tienen la huella a NULL y siguen
-- siendo validos. El indice es parcial justamente para no invalidarlos.
SELECT pg_temp.expect_success('L1 documento historico sin huella',
  $q$INSERT INTO public.documents
       (minutes_id, meeting_id, storage_path, sha256, document_code, version)
     VALUES ('e1000000-0000-4000-8000-0000000000d1',
             'e1000000-0000-4000-8000-0000000000c1',
             'inst/alumna/acta-v1-fff.pdf', repeat('f',64),
             'ACTA-2026-TEST0001-v1', 1)$q$);

SELECT pg_temp.expect_success('L2 dos historicos sin huella conviven',
  $q$INSERT INTO public.documents
       (minutes_id, meeting_id, storage_path, sha256, document_code, version)
     VALUES ('e1000000-0000-4000-8000-0000000000d1',
             'e1000000-0000-4000-8000-0000000000c1',
             'inst/alumna/acta-v1-000.pdf', repeat('0',64),
             'ACTA-2026-TEST0001-v1', 1)$q$);

SELECT pg_temp.expect('L3 el historico recibe kind final por omision',
  (SELECT bool_and(kind = 'final') FROM public.documents
   WHERE generation_fingerprint IS NULL));

-- ------------------------------------------------- M · metadatos inmutables

SELECT pg_temp.expect_failure('M1 reescribir la huella de un documento',
  $q$UPDATE public.documents SET generation_fingerprint = repeat('9',64)
     WHERE id = 'e1000000-0000-4000-8000-0000000000f1'$q$);

SELECT pg_temp.expect_failure('M2 convertir una previa en definitiva',
  $q$UPDATE public.documents SET kind = 'preview'
     WHERE id = 'e1000000-0000-4000-8000-0000000000f1'$q$);

SELECT pg_temp.expect_failure('M3 reescribir el SHA-256 del archivo',
  $q$UPDATE public.documents SET sha256 = repeat('7',64)
     WHERE id = 'e1000000-0000-4000-8000-0000000000f1'$q$);

SELECT pg_temp.expect_failure('M4 reapuntar la ruta de almacenamiento',
  $q$UPDATE public.documents SET storage_path = 'otra/ruta.pdf'
     WHERE id = 'e1000000-0000-4000-8000-0000000000f1'$q$);

-- Lo que si debe poder actualizarse: el acuse de envio.
SELECT pg_temp.expect_success('M5 registrar el envio sigue permitido',
  $q$UPDATE public.documents SET sent_at = now(), provider_message_id = 'msg-1'
     WHERE id = 'e1000000-0000-4000-8000-0000000000f1'$q$);

-- ------------------------------------- N · el documento no se puede borrar

-- `documents` no tiene politica de DELETE a proposito: la evidencia no se
-- retira desde la aplicacion. Sin politica, RLS no lanza error, simplemente no
-- alcanza ninguna fila; por eso aqui se cuenta, no se espera una excepcion.
DELETE FROM public.documents WHERE id = 'e1000000-0000-4000-8000-0000000000f1';

SELECT pg_temp.expect('N1 el documento sigue estando tras el DELETE',
  EXISTS (SELECT 1 FROM public.documents
          WHERE id = 'e1000000-0000-4000-8000-0000000000f1'));

SELECT pg_temp.expect('N2 authenticated no tiene politica de DELETE',
  NOT EXISTS (SELECT 1 FROM pg_policy p
              JOIN pg_class c ON c.oid = p.polrelid
              WHERE c.relname = 'documents' AND p.polcmd = 'd'));

RESET ROLE;

-- ---------------------------------------------------------------- informe

\echo ''
SELECT CASE WHEN passed THEN '  PASA  ' ELSE '  FALLA ' END
       || rpad(name, 48) || coalesce(detail, '') AS "idempotencia documental"
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
