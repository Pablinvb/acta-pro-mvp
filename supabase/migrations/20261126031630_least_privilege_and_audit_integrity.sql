-- ACTA PRO
-- Migration 0008: minimo privilegio e integridad de la auditoria
--
-- Hallazgo principal: cada tabla de `public` concedia TRUNCATE a `anon` y a
-- `authenticated`. TRUNCATE **no pasa por Row Level Security**, de modo que
-- cualquier sesion autenticada -y, con la clave publicable, una anonima- podia
-- vaciar cualquier tabla, incluida `audit_logs`. Las politicas RLS eran
-- correctas y aun asi el historial era borrable.
--
-- Procede de la exposicion automatica de tablas nuevas de Supabase, que replica
-- el comportamiento de la nube. Esta migracion recorta los privilegios a lo que
-- la aplicacion usa realmente.


-- ---------------------------------------------------------------------------
-- 1. `anon` no tiene ninguna superficie en esta aplicacion.
--
-- Todo el producto exige sesion: no hay ni una pantalla ni una ruta que lea o
-- escriba como anonimo.
-- ---------------------------------------------------------------------------

BEGIN;

DO $$
DECLARE t record;
BEGIN
    FOR t IN
        SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    LOOP
        EXECUTE format('REVOKE ALL ON public.%I FROM anon', t.tablename);
    END LOOP;
END;
$$;

COMMIT;


-- ---------------------------------------------------------------------------
-- 2. `authenticated` pierde TRUNCATE, REFERENCES y TRIGGER en todo `public`.
--
-- Ninguno de los tres lo usa la aplicacion, y TRUNCATE es el que esquiva RLS.
-- ---------------------------------------------------------------------------

BEGIN;

DO $$
DECLARE t record;
BEGIN
    FOR t IN
        SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    LOOP
        EXECUTE format(
            'REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM authenticated',
            t.tablename);
    END LOOP;
END;
$$;

COMMIT;


-- ---------------------------------------------------------------------------
-- 3. Catalogos de solo lectura.
--
-- Instituciones, perfiles, estudiantes y representantes los alimenta la
-- institucion por via administrativa, nunca la sesion de una docente. Las
-- credenciales de Google solo las toca el servidor con la service role key.
-- ---------------------------------------------------------------------------

BEGIN;

REVOKE INSERT, UPDATE, DELETE ON public.institutions            FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.profiles                FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.students                FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.representatives         FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.student_representatives FROM authenticated;
REVOKE ALL                     ON public.google_credentials     FROM authenticated;

COMMIT;


-- ---------------------------------------------------------------------------
-- 4. La auditoria se escribe, no se reescribe.
-- ---------------------------------------------------------------------------

BEGIN;

REVOKE UPDATE, DELETE ON public.audit_logs FROM authenticated;

-- Una entrada no puede atribuirse a otra persona, a otra institucion ni a una
-- reunion ajena. Y las acciones que nacen de una operacion privilegiada no se
-- pueden fabricar desde el cliente: solo las escriben las funciones SECURITY
-- DEFINER, que actuan como propietarias y no pasan por esta politica.
DROP POLICY IF EXISTS audit_insert ON public.audit_logs;

CREATE POLICY audit_insert
ON public.audit_logs
FOR INSERT
TO authenticated
WITH CHECK (
    institution_id = acta_private.current_institution_id()
    AND actor_id = auth.uid()
    AND (
        meeting_id IS NULL
        OR acta_private.can_access_meeting(meeting_id)
    )
    AND action NOT IN ('minutes.signed', 'minutes.reopened')
);

COMMIT;
