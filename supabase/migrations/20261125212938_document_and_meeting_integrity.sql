
-- ACTA PRO
-- Migration 0005: Document and meeting integrity
-- Phase 1: Referential integrity

BEGIN;

-- 1. Integridad institucional y documental.
-- Con guardas: la migracion debe poder reaplicarse sobre una base que ya
-- recibio estos objetos a mano, sin fallar con 42P07.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_id_institution_unique') THEN
        ALTER TABLE public.profiles ADD CONSTRAINT profiles_id_institution_unique
        UNIQUE (id, institution_id);
    END IF;
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'students_id_institution_unique') THEN
        ALTER TABLE public.students ADD CONSTRAINT students_id_institution_unique
        UNIQUE (id, institution_id);
    END IF;
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meetings_teacher_institution_fk') THEN
        ALTER TABLE public.meetings ADD CONSTRAINT meetings_teacher_institution_fk
        FOREIGN KEY (teacher_id, institution_id) REFERENCES public.profiles (id, institution_id) ON DELETE RESTRICT;
    END IF;
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meetings_student_institution_fk') THEN
        ALTER TABLE public.meetings ADD CONSTRAINT meetings_student_institution_fk
        FOREIGN KEY (student_id, institution_id) REFERENCES public.students (id, institution_id) ON DELETE RESTRICT;
    END IF;
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'minutes_document_reference_unique') THEN
        ALTER TABLE public.minutes ADD CONSTRAINT minutes_document_reference_unique
        UNIQUE (id, meeting_id, version);
    END IF;
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'documents_minutes_reference_fk') THEN
        ALTER TABLE public.documents ADD CONSTRAINT documents_minutes_reference_fk
        FOREIGN KEY (minutes_id, meeting_id, version) REFERENCES public.minutes (id, meeting_id, version) ON DELETE CASCADE;
    END IF;
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'documents_sha256_format_check') THEN
        ALTER TABLE public.documents ADD CONSTRAINT documents_sha256_format_check
        CHECK (sha256 ~ '^[a-f0-9]{64}$');
    END IF;
END;
$$;

COMMIT;


BEGIN;

CREATE OR REPLACE FUNCTION acta_private.protect_meeting_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN

    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.institution_id IS DISTINCT FROM OLD.institution_id
       OR NEW.teacher_id IS DISTINCT FROM OLD.teacher_id
       OR NEW.student_id IS DISTINCT FROM OLD.student_id
    THEN
        RAISE EXCEPTION
            'Meeting identity fields cannot be modified.'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;

END;
$function$;

REVOKE ALL ON FUNCTION
    acta_private.protect_meeting_identity()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS protect_meeting_identity_trigger ON public.meetings;

CREATE TRIGGER protect_meeting_identity_trigger
BEFORE UPDATE ON public.meetings
FOR EACH ROW
EXECUTE FUNCTION acta_private.protect_meeting_identity();

COMMIT;



BEGIN;

CREATE OR REPLACE FUNCTION acta_private.protect_meeting_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
    valid_transition boolean;
BEGIN

    IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
        RETURN NEW;
    END IF;

    valid_transition := CASE OLD.status

        WHEN 'scheduled' THEN
            NEW.status IN ('ready')

        WHEN 'ready' THEN
            NEW.status IN ('recording')

        WHEN 'recording' THEN
            NEW.status IN ('processing', 'ready')

        WHEN 'processing' THEN
            NEW.status IN ('draft', 'ready')

        WHEN 'draft' THEN
            NEW.status IN ('processing', 'approved')

        WHEN 'approved' THEN
            NEW.status IN ('signed', 'draft')

        WHEN 'signed' THEN
            NEW.status IN ('sent')

        WHEN 'sent' THEN
            false

        ELSE false

    END;

    IF valid_transition IS NOT TRUE THEN
        RAISE EXCEPTION
            'Invalid meeting status transition: % -> %',
            OLD.status,
            NEW.status
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;

END;
$function$;

REVOKE ALL ON FUNCTION
    acta_private.protect_meeting_status()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS protect_meeting_status_trigger ON public.meetings;

CREATE TRIGGER protect_meeting_status_trigger
BEFORE UPDATE OF status ON public.meetings
FOR EACH ROW
EXECUTE FUNCTION acta_private.protect_meeting_status();

COMMIT;



BEGIN;

CREATE OR REPLACE FUNCTION
    acta_private.protect_document_metadata()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN

    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.minutes_id IS DISTINCT FROM OLD.minutes_id
       OR NEW.meeting_id IS DISTINCT FROM OLD.meeting_id
       OR NEW.storage_path IS DISTINCT FROM OLD.storage_path
       OR NEW.sha256 IS DISTINCT FROM OLD.sha256
       OR NEW.document_code IS DISTINCT FROM OLD.document_code
       OR NEW.version IS DISTINCT FROM OLD.version
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
        RAISE EXCEPTION
            'Document metadata cannot be modified.'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;

END;
$function$;

REVOKE ALL ON FUNCTION
    acta_private.protect_document_metadata()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS protect_document_metadata_trigger ON public.documents;

CREATE TRIGGER protect_document_metadata_trigger
BEFORE UPDATE ON public.documents
FOR EACH ROW
EXECUTE FUNCTION acta_private.protect_document_metadata();

COMMIT;



BEGIN;

CREATE OR REPLACE FUNCTION
    acta_private.protect_finalized_minutes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
    target_meeting uuid;
    meeting_status text;
BEGIN

    IF TG_OP = 'UPDATE' THEN

        IF NEW.id IS DISTINCT FROM OLD.id
           OR NEW.meeting_id IS DISTINCT FROM OLD.meeting_id
           OR NEW.version IS DISTINCT FROM OLD.version
        THEN
            RAISE EXCEPTION
                'Minutes identity cannot be modified.'
                USING ERRCODE = '23514';
        END IF;

    END IF;

    IF TG_OP = 'INSERT' THEN
        target_meeting := NEW.meeting_id;
    ELSE
        target_meeting := OLD.meeting_id;
    END IF;

    SELECT m.status
    INTO meeting_status
    FROM public.meetings m
    WHERE m.id = target_meeting
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Parent meeting unavailable.'
            USING ERRCODE = '23514';
    END IF;

    IF meeting_status IN ('signed', 'sent') THEN
        RAISE EXCEPTION
            'Finalized minutes cannot be modified.'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;

    RETURN NEW;

END;
$function$;

REVOKE ALL ON FUNCTION
    acta_private.protect_finalized_minutes()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS protect_finalized_minutes_trigger ON public.minutes;

CREATE TRIGGER protect_finalized_minutes_trigger
BEFORE INSERT OR UPDATE OR DELETE
ON public.minutes
FOR EACH ROW
EXECUTE FUNCTION
    acta_private.protect_finalized_minutes();

COMMIT;



BEGIN;

CREATE OR REPLACE FUNCTION
    acta_private.protect_finalized_signatures()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
    target_minutes uuid;
    meeting_status text;
    minutes_status text;
BEGIN

    -- Protect signature identity.

    IF TG_OP = 'UPDATE' THEN
        IF NEW.id IS DISTINCT FROM OLD.id
           OR NEW.minutes_id IS DISTINCT FROM OLD.minutes_id
        THEN
            RAISE EXCEPTION
                'Signature identity cannot be modified.'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    -- Identify the parent minutes.

    IF TG_OP = 'INSERT' THEN
        target_minutes := NEW.minutes_id;
    ELSE
        target_minutes := OLD.minutes_id;
    END IF;

    -- Lock the parent meeting.

    SELECT m.status
    INTO meeting_status
    FROM public.meetings m
    JOIN public.minutes a ON a.meeting_id = m.id
    WHERE a.id = target_minutes
    FOR UPDATE OF m;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Parent minutes unavailable.'
            USING ERRCODE = '23514';
    END IF;

    -- Prevent modifications after finalization.

    IF meeting_status IN ('signed', 'sent') THEN
        RAISE EXCEPTION
            'Finalized signatures cannot be modified.'
            USING ERRCODE = '23514';
    END IF;

    -- Require approval before adding or editing signatures.

    IF TG_OP IN ('INSERT', 'UPDATE') THEN

        SELECT a.status
        INTO minutes_status
        FROM public.minutes a
        WHERE a.id = target_minutes;

        IF minutes_status IS DISTINCT FROM 'approved'
           OR meeting_status IS DISTINCT FROM 'approved'
        THEN
            RAISE EXCEPTION
                'Minutes must be approved before signing.'
                USING ERRCODE = '23514';
        END IF;

    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;

    RETURN NEW;

END;
$function$;

REVOKE ALL ON FUNCTION
    acta_private.protect_finalized_signatures()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS protect_finalized_signatures_trigger ON public.signatures;

CREATE TRIGGER protect_finalized_signatures_trigger
BEFORE INSERT OR UPDATE OR DELETE
ON public.signatures
FOR EACH ROW
EXECUTE FUNCTION
    acta_private.protect_finalized_signatures();

COMMIT;
