
-- ACTA PRO
-- Security hardening migration
-- Preserve existing data and authorization policies.

BEGIN;

-- 1. Create private security schema.

CREATE SCHEMA IF NOT EXISTS acta_private;

REVOKE ALL ON SCHEMA acta_private
FROM PUBLIC, anon, authenticated;

GRANT USAGE ON SCHEMA acta_private
TO authenticated, service_role;


-- 2. Protect the legacy meetings view.
-- Fresh installations may not contain this view.

DO $$
BEGIN
    IF to_regclass('public.meetings_read') IS NOT NULL THEN

        ALTER VIEW public.meetings_read
        SET (security_invoker = true);

        REVOKE ALL PRIVILEGES
        ON public.meetings_read
        FROM PUBLIC, anon, authenticated, service_role;

        CREATE SCHEMA IF NOT EXISTS acta_legacy_20261124;

        REVOKE ALL ON SCHEMA acta_legacy_20261124
        FROM PUBLIC, anon, authenticated, service_role;

        ALTER VIEW public.meetings_read
        SET SCHEMA acta_legacy_20261124;

    END IF;

    IF to_regclass(
        'acta_legacy_20261124.meetings_read'
    ) IS NOT NULL THEN

        ALTER VIEW acta_legacy_20261124.meetings_read
        SET (security_invoker = true);

        REVOKE ALL PRIVILEGES
        ON acta_legacy_20261124.meetings_read
        FROM PUBLIC, anon, authenticated, service_role;

    END IF;
END;
$$;


-- 3. Move authorization functions into the private schema.
-- Preserve dependencies used by existing RLS policies.

DO $$
BEGIN
    IF to_regprocedure(
        'public.can_access_meeting(uuid)'
    ) IS NOT NULL THEN

        ALTER FUNCTION public.can_access_meeting(uuid)
        SET SCHEMA acta_private;

    END IF;

    IF to_regprocedure(
        'public.current_institution_id()'
    ) IS NOT NULL THEN

        ALTER FUNCTION public.current_institution_id()
        SET SCHEMA acta_private;

    END IF;
END;
$$;


-- 4. Secure meeting authorization.

CREATE OR REPLACE FUNCTION
acta_private.can_access_meeting(target_meeting uuid)

RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''

AS $function$

    SELECT EXISTS (
        SELECT 1
        FROM public.meetings m
        JOIN public.profiles p
            ON p.id = auth.uid()
        WHERE m.id = target_meeting
          AND m.institution_id = p.institution_id
          AND (
              m.teacher_id = p.id
              OR p.role = 'admin'
          )
    );

$function$;


-- 5. Secure institution authorization.

CREATE OR REPLACE FUNCTION
acta_private.current_institution_id()

RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''

AS $function$

    SELECT institution_id
    FROM public.profiles
    WHERE id = auth.uid();

$function$;


-- 6. Restrict function execution.

REVOKE ALL ON FUNCTION
acta_private.can_access_meeting(uuid)
FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION
acta_private.current_institution_id()
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
acta_private.can_access_meeting(uuid)
TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION
acta_private.current_institution_id()
TO authenticated, service_role;


-- 7. Restrict meeting visibility to owners
-- and administrators of the same institution.

ALTER TABLE public.meetings
ENABLE ROW LEVEL SECURITY;

ALTER POLICY meetings_read
ON public.meetings
TO authenticated
USING (
    acta_private.can_access_meeting(id)
);

COMMIT;
