-- ACTA PRO · pruebas de seguridad: la maquina de estados, entera
--
-- La interfaz oculta las acciones que no corresponden, y el servidor las
-- rechaza. Pero quien tiene una sesion valida puede escribir contra la API de
-- datos sin pasar por ninguna de las dos. La ultima palabra la tiene la base.
--
-- Aqui no se prueban unas pocas transiciones representativas: se prueban las
-- 64 combinaciones posibles entre los 8 estados, una por una. Las 8 identidades
-- (un estado hacia si mismo) se permiten porque guardar un cambio que no toca
-- el estado no es una transicion. De las 56 restantes, solo 11 son legitimas.
--
-- La matriz esperada se escribe aqui de forma independiente del disparador.
-- Si alguien altera el disparador, estas pruebas lo dicen.

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

CREATE FUNCTION pg_temp.expect(test_name text, condition boolean)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
    INSERT INTO results (name, passed, detail)
    VALUES (test_name, coalesce(condition, false), NULL);
END;
$fn$;

-- Matriz esperada, escrita a mano a partir del modelo de la aplicacion
-- (`src/lib/meeting-state.ts`), no leida del disparador.
CREATE FUNCTION pg_temp.allowed(from_status text, to_status text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $fn$
    SELECT CASE
        WHEN from_status = to_status THEN true
        WHEN from_status = 'scheduled'  THEN to_status = 'ready'
        WHEN from_status = 'ready'      THEN to_status = 'recording'
        WHEN from_status = 'recording'  THEN to_status IN ('processing', 'ready')
        WHEN from_status = 'processing' THEN to_status IN ('draft', 'ready')
        WHEN from_status = 'draft'      THEN to_status IN ('processing', 'approved')
        WHEN from_status = 'approved'   THEN to_status IN ('signed', 'draft')
        WHEN from_status = 'signed'     THEN to_status = 'sent'
        ELSE false
    END;
$fn$;

-- ------------------------------------------------------------ datos ficticios

INSERT INTO auth.users (id, email) VALUES
  ('a2000000-0000-4000-8000-000000000001', 'docente@test.invalid');

INSERT INTO public.institutions (id, name) VALUES
  ('a2000000-0000-4000-8000-0000000000a1', 'Institucion de prueba');

INSERT INTO public.profiles (id, full_name, email, role, institution_id) VALUES
  ('a2000000-0000-4000-8000-000000000001','Docente','docente@test.invalid',
   'teacher','a2000000-0000-4000-8000-0000000000a1');

INSERT INTO public.students (id, institution_id, full_name) VALUES
  ('a2000000-0000-4000-8000-0000000000b1','a2000000-0000-4000-8000-0000000000a1','Alumna');

-- Una reunion por cada par (origen, destino). Se crean con el estado de origen
-- ya puesto, lo que exige desactivar la guarda de creacion: esa guarda vigila
-- las altas de la aplicacion, no el montaje de un escenario de prueba.
-- Las firmas solo pueden anotarse sobre una reunion aprobada, asi que cada
-- escenario se monta en `approved` y despues se lleva al estado de origen. Eso
-- obliga a desactivar temporalmente las tres guardas que vigilan el alta y el
-- cambio de estado: vigilan lo que hace la aplicacion, no el montaje de un
-- escenario. Se vuelven a activar antes de medir nada.
ALTER TABLE public.meetings
    DISABLE TRIGGER protect_meeting_creation_trigger,
    DISABLE TRIGGER protect_meeting_status_trigger,
    DISABLE TRIGGER revoke_approval_on_reopen_trigger;

ALTER TABLE public.signatures DISABLE TRIGGER verify_identity;
DO $fixture$
DECLARE
    states text[] := ARRAY['scheduled','ready','recording','processing',
                           'draft','approved','signed','sent'];
    origen text;
    destino text;
    i integer;
    j integer;
    meeting_id uuid;
    minutes_id uuid;
BEGIN
    FOR i IN 1..8 LOOP
        FOR j IN 1..8 LOOP
            origen  := states[i];
            destino := states[j];
            meeting_id := ('a2000000-0000-4000-8000-1' || lpad(i::text,3,'0')
                           || lpad(j::text,8,'0'))::uuid;
            minutes_id := ('a2000000-0000-4000-8000-2' || lpad(i::text,3,'0')
                           || lpad(j::text,8,'0'))::uuid;

            INSERT INTO public.meetings
              (id, institution_id, teacher_id, student_id, title, status)
            VALUES (meeting_id, 'a2000000-0000-4000-8000-0000000000a1',
                    'a2000000-0000-4000-8000-000000000001',
                    'a2000000-0000-4000-8000-0000000000b1',
                    origen || ' -> ' || destino, 'approved');

            -- Cada reunion lleva un acta aprobada con las dos firmas
            -- obligatorias. Asi la condicion de finalizacion se cumple siempre
            -- y lo unico que se mide en esta matriz es la legalidad de la
            -- transicion. La condicion en si se prueba aparte, en 0001.
            INSERT INTO public.minutes (id, meeting_id, version, status, summary, approved_at)
            VALUES (minutes_id, meeting_id, 1, 'approved', 'Resumen', now());

            INSERT INTO public.signatures
              (minutes_id, signer_name, signer_role, signature_path, acceptance_text_version)
            VALUES (minutes_id, 'Docente', 'teacher', 'data:image/png;base64,AA', 'v1'),
                   (minutes_id, 'Representante', 'representative', 'data:image/png;base64,BB', 'v1');

            -- Ya firmada, se coloca en el estado de origen del escenario.
            UPDATE public.meetings SET status = origen WHERE id = meeting_id;
        END LOOP;
    END LOOP;
END;
$fixture$;
ALTER TABLE public.signatures ENABLE TRIGGER verify_identity;

ALTER TABLE public.meetings
    ENABLE TRIGGER protect_meeting_creation_trigger,
    ENABLE TRIGGER protect_meeting_status_trigger,
    ENABLE TRIGGER revoke_approval_on_reopen_trigger;

-- --------------------------------------------- O · las 64 transiciones

SET LOCAL request.jwt.claims =
  '{"sub":"a2000000-0000-4000-8000-000000000001","role":"authenticated"}';
SET LOCAL ROLE authenticated;

DO $matrix$
DECLARE
    states text[] := ARRAY['scheduled','ready','recording','processing',
                           'draft','approved','signed','sent'];
    origen text;
    destino text;
    i integer;
    j integer;
    meeting_id uuid;
    esperado boolean;
    ocurrio boolean;
    motivo text;
BEGIN
    FOR i IN 1..8 LOOP
        FOR j IN 1..8 LOOP
            origen  := states[i];
            destino := states[j];
            meeting_id := ('a2000000-0000-4000-8000-1' || lpad(i::text,3,'0')
                           || lpad(j::text,8,'0'))::uuid;
            esperado := pg_temp.allowed(origen, destino);
            motivo := NULL;

            BEGIN
                UPDATE public.meetings SET status = destino WHERE id = meeting_id;
                -- Que no lance no basta: RLS puede no alcanzar ninguna fila.
                ocurrio := EXISTS (
                    SELECT 1 FROM public.meetings
                    WHERE id = meeting_id AND status = destino
                );
                IF NOT ocurrio THEN
                    motivo := 'ninguna fila afectada';
                END IF;
            EXCEPTION WHEN others THEN
                ocurrio := false;
                motivo := left(SQLERRM, 40);
            END;

            INSERT INTO results (name, passed, detail)
            VALUES (
                'O ' || rpad(origen, 11) || ' -> ' || rpad(destino, 11)
                     || CASE WHEN esperado THEN '[permitida]' ELSE '[denegada] ' END,
                ocurrio = esperado,
                CASE
                    WHEN ocurrio = esperado THEN NULL
                    WHEN esperado THEN 'deberia haberse permitido: ' || coalesce(motivo, '?')
                    ELSE 'deberia haberse denegado'
                END
            );
        END LOOP;
    END LOOP;
END;
$matrix$;

RESET ROLE;

-- Comprobacion del propio recuento: 8 identidades + 11 avances legitimos.
SELECT pg_temp.expect('P1 la matriz cubre las 64 combinaciones',
  (SELECT count(*) = 64 FROM results WHERE name LIKE 'O %'));

SELECT pg_temp.expect('P2 solo 19 de las 64 estan permitidas',
  (SELECT count(*) = 19 FROM (
      SELECT unnest(ARRAY['scheduled','ready','recording','processing',
                          'draft','approved','signed','sent']) AS a
   ) x, (
      SELECT unnest(ARRAY['scheduled','ready','recording','processing',
                          'draft','approved','signed','sent']) AS b
   ) y
   WHERE pg_temp.allowed(x.a, y.b)));

SELECT pg_temp.expect('P3 sent es terminal salvo consigo misma',
  (SELECT count(*) = 1 FROM (
      SELECT unnest(ARRAY['scheduled','ready','recording','processing',
                          'draft','approved','signed','sent']) AS b
   ) y WHERE pg_temp.allowed('sent', y.b)));

-- ---------------------------------------------------------------- informe

\echo ''
SELECT CASE WHEN passed THEN '  PASA  ' ELSE '  FALLA ' END
       || rpad(name, 46) || coalesce(detail, '') AS "maquina de estados"
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
