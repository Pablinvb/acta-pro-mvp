-- ACTA PRO
-- Migration 0006: atomic signing and controlled finalization
--
-- The previous migration validates *transitions* but not *preconditions*:
-- `approved -> signed` succeeded with zero signatures. The status trigger is
-- also BEFORE UPDATE only, so a direct INSERT with status 'signed' bypassed
-- every check. Finally, reopening an approved minutes left its signatures in
-- place, where they could be reused against different content.
--
-- This migration closes those three gaps and adds a transactional signing
-- entry point so signatures and the meeting status can no longer drift apart.


-- ---------------------------------------------------------------------------
-- 1. One signature per role per minutes version.
-- ---------------------------------------------------------------------------

BEGIN;

-- Defensive de-duplication: keep the most recent signature per role so the
-- constraint can be added to databases that already hold test data.
DELETE FROM public.signatures s
USING public.signatures newer
WHERE s.minutes_id = newer.minutes_id
  AND s.signer_role = newer.signer_role
  AND (newer.signed_at, newer.id) > (s.signed_at, s.id);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'signatures_minutes_role_unique'
    ) THEN
        ALTER TABLE public.signatures
        ADD CONSTRAINT signatures_minutes_role_unique
        UNIQUE (minutes_id, signer_role);
    END IF;
END;
$$;

COMMIT;


-- ---------------------------------------------------------------------------
-- 2. Can this meeting legitimately reach `signed`?
--
-- A meeting may only be finalized when the newest minutes version exists, is
-- approved, and carries both mandatory signatures. Requiring the signatures to
-- hang off that newest version is what stops a signature collected before an
-- edit from finalizing the corrected document.
-- ---------------------------------------------------------------------------

BEGIN;

CREATE OR REPLACE FUNCTION acta_private.meeting_can_be_signed(
    target_meeting uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
    WITH latest AS (
        SELECT a.id, a.status
        FROM public.minutes a
        WHERE a.meeting_id = target_meeting
        ORDER BY a.version DESC
        LIMIT 1
    )
    SELECT EXISTS (
        SELECT 1
        FROM latest
        WHERE latest.status = 'approved'
          AND EXISTS (
              SELECT 1 FROM public.signatures s
              WHERE s.minutes_id = latest.id
                AND s.signer_role = 'teacher'
          )
          AND EXISTS (
              SELECT 1 FROM public.signatures s
              WHERE s.minutes_id = latest.id
                AND s.signer_role = 'representative'
          )
    );
$function$;

REVOKE ALL ON FUNCTION acta_private.meeting_can_be_signed(uuid)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION acta_private.meeting_can_be_signed(uuid)
TO authenticated, service_role;

COMMIT;


-- ---------------------------------------------------------------------------
-- 3. Enforce the preconditions on the transition itself.
--
-- Replaces the function the previous migration installed; the trigger already
-- points at this name, so no trigger is recreated here.
-- ---------------------------------------------------------------------------

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
        WHEN 'scheduled'  THEN NEW.status IN ('ready')
        WHEN 'ready'      THEN NEW.status IN ('recording')
        WHEN 'recording'  THEN NEW.status IN ('processing', 'ready')
        WHEN 'processing' THEN NEW.status IN ('draft', 'ready')
        WHEN 'draft'      THEN NEW.status IN ('processing', 'approved')
        WHEN 'approved'   THEN NEW.status IN ('signed', 'draft')
        WHEN 'signed'     THEN NEW.status IN ('sent')
        WHEN 'sent'       THEN false
        ELSE false
    END;

    IF valid_transition IS NOT TRUE THEN
        RAISE EXCEPTION
            'Invalid meeting status transition: % -> %',
            OLD.status, NEW.status
            USING ERRCODE = '23514';
    END IF;

    -- A legal transition is not necessarily a legitimate one: finalizing
    -- demands an approved newest version carrying both mandatory signatures.
    IF NEW.status = 'signed'
       AND NOT acta_private.meeting_can_be_signed(NEW.id)
    THEN
        RAISE EXCEPTION
            'A meeting cannot be signed without an approved current version '
            'carrying the teacher and representative signatures.'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;

END;
$function$;

REVOKE ALL ON FUNCTION acta_private.protect_meeting_status()
FROM PUBLIC, anon, authenticated;

COMMIT;


-- ---------------------------------------------------------------------------
-- 4. Close the INSERT path.
--
-- Every status beyond `ready` implies artefacts -- a transcript, minutes,
-- signatures -- that cannot exist for a row being created, so a new meeting
-- may only be born scheduled or ready.
-- ---------------------------------------------------------------------------

BEGIN;

CREATE OR REPLACE FUNCTION acta_private.protect_meeting_creation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN

    IF NEW.status NOT IN ('scheduled', 'ready') THEN
        RAISE EXCEPTION
            'A meeting cannot be created in status %. '
            'Advanced states must be reached through the documented flow.',
            NEW.status
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;

END;
$function$;

REVOKE ALL ON FUNCTION acta_private.protect_meeting_creation()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS protect_meeting_creation_trigger ON public.meetings;

CREATE TRIGGER protect_meeting_creation_trigger
BEFORE INSERT ON public.meetings
FOR EACH ROW
EXECUTE FUNCTION acta_private.protect_meeting_creation();

COMMIT;


-- ---------------------------------------------------------------------------
-- 5. Controlled reopening.
--
-- Returning an approved meeting to `draft` revokes the approval of its newest
-- version and discards the signatures collected for it. Keeping them would let
-- a signature gathered for one text finalize another.
-- ---------------------------------------------------------------------------

BEGIN;

CREATE OR REPLACE FUNCTION acta_private.revoke_approval_on_reopen()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
    v_minutes_id uuid;
    v_removed integer := 0;
BEGIN

    IF OLD.status <> 'approved' OR NEW.status <> 'draft' THEN
        RETURN NEW;
    END IF;

    SELECT a.id INTO v_minutes_id
    FROM public.minutes a
    WHERE a.meeting_id = NEW.id
    ORDER BY a.version DESC
    LIMIT 1;

    IF v_minutes_id IS NULL THEN
        RETURN NEW;
    END IF;

    DELETE FROM public.signatures s
    WHERE s.minutes_id = v_minutes_id;

    GET DIAGNOSTICS v_removed = ROW_COUNT;

    UPDATE public.minutes a
    SET status = 'draft',
        approved_at = NULL
    WHERE a.id = v_minutes_id
      AND a.status <> 'draft';

    -- The audit trail keeps the revocation visible; it is never rewritten.
    INSERT INTO public.audit_logs (
        institution_id, actor_id, meeting_id, action, metadata_json
    )
    VALUES (
        NEW.institution_id,
        auth.uid(),
        NEW.id,
        'minutes.reopened',
        jsonb_build_object(
            'minutes_id', v_minutes_id,
            'revoked_signatures', v_removed
        )
    );

    RETURN NEW;

END;
$function$;

REVOKE ALL ON FUNCTION acta_private.revoke_approval_on_reopen()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS revoke_approval_on_reopen_trigger ON public.meetings;

CREATE TRIGGER revoke_approval_on_reopen_trigger
AFTER UPDATE OF status ON public.meetings
FOR EACH ROW
EXECUTE FUNCTION acta_private.revoke_approval_on_reopen();

COMMIT;


-- ---------------------------------------------------------------------------
-- 6. Atomic signing.
--
-- Recording the signatures and finalizing the meeting used to be separate
-- round trips from the application, which could leave signatures stored
-- against a meeting that never reached `signed`. This entry point performs
-- authorization, locking, validation, insertion, finalization and audit inside
-- a single transaction: either all of it happens, or none of it does.
--
-- SECURITY DEFINER is required to write the audit row and to read the parent
-- meeting while holding its lock, so the function checks authorization itself
-- through `can_access_meeting` and is never granted to anon.
-- ---------------------------------------------------------------------------

BEGIN;

CREATE OR REPLACE FUNCTION public.sign_minutes(
    p_minutes_id uuid,
    p_signatures jsonb,
    p_acceptance_text_version text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_actor           uuid := auth.uid();
    v_meeting_id      uuid;
    v_meeting_status  text;
    v_institution     uuid;
    v_minutes_status  text;
    v_version         integer;
    v_latest_version  integer;
    v_roles           text[];
    v_item            jsonb;
    v_count           integer := 0;
BEGIN

    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Authentication required.'
            USING ERRCODE = '42501';
    END IF;

    IF jsonb_typeof(p_signatures) <> 'array'
       OR jsonb_array_length(p_signatures) = 0
    THEN
        RAISE EXCEPTION 'At least one signature is required.'
            USING ERRCODE = '22023';
    END IF;

    -- Lock the parent meeting for the whole transaction. Two concurrent
    -- requests therefore serialize here instead of racing each other.
    SELECT m.id, m.status, m.institution_id, a.status, a.version
      INTO v_meeting_id, v_meeting_status, v_institution,
           v_minutes_status, v_version
    FROM public.minutes a
    JOIN public.meetings m ON m.id = a.meeting_id
    WHERE a.id = p_minutes_id
    FOR UPDATE OF m;

    IF v_meeting_id IS NULL THEN
        -- Same answer as "not authorized": do not reveal which rows exist.
        RAISE EXCEPTION 'Minutes unavailable.'
            USING ERRCODE = '42501';
    END IF;

    IF NOT acta_private.can_access_meeting(v_meeting_id) THEN
        RAISE EXCEPTION 'Minutes unavailable.'
            USING ERRCODE = '42501';
    END IF;

    -- Idempotent repeat: the meeting is already finalized on this very
    -- version, so the caller gets success instead of a duplicate failure.
    IF v_meeting_status IN ('signed', 'sent')
       AND acta_private.meeting_can_be_signed(v_meeting_id)
    THEN
        RETURN jsonb_build_object(
            'already_signed', true,
            'meeting_id', v_meeting_id,
            'signatures', (
                SELECT count(*) FROM public.signatures s
                WHERE s.minutes_id = p_minutes_id
            )
        );
    END IF;

    SELECT max(a.version) INTO v_latest_version
    FROM public.minutes a
    WHERE a.meeting_id = v_meeting_id;

    IF v_version IS DISTINCT FROM v_latest_version THEN
        RAISE EXCEPTION
            'A newer version of these minutes exists. Reload before signing.'
            USING ERRCODE = '23514';
    END IF;

    IF v_minutes_status IS DISTINCT FROM 'approved' THEN
        RAISE EXCEPTION 'The minutes must be approved before signing.'
            USING ERRCODE = '23514';
    END IF;

    IF v_meeting_status IS DISTINCT FROM 'approved' THEN
        RAISE EXCEPTION
            'The meeting is in status % and cannot be signed.', v_meeting_status
            USING ERRCODE = '23514';
    END IF;

    SELECT array_agg(DISTINCT value->>'signer_role')
      INTO v_roles
    FROM jsonb_array_elements(p_signatures) AS value;

    IF NOT ('teacher' = ANY(v_roles))
       OR NOT ('representative' = ANY(v_roles))
    THEN
        RAISE EXCEPTION
            'The teacher and representative signatures are both required.'
            USING ERRCODE = '23514';
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_signatures)
    LOOP
        IF coalesce(v_item->>'signer_name', '') = ''
           OR coalesce(v_item->>'signature_path', '') = ''
        THEN
            RAISE EXCEPTION 'Every signature needs a name and an image.'
                USING ERRCODE = '22023';
        END IF;

        IF v_item->>'signer_role' NOT IN
           ('teacher', 'representative', 'student', 'other')
        THEN
            RAISE EXCEPTION 'Unknown signer role: %', v_item->>'signer_role'
                USING ERRCODE = '22023';
        END IF;

        INSERT INTO public.signatures (
            minutes_id, signer_name, signer_role,
            signature_path, acceptance_text_version
        )
        VALUES (
            p_minutes_id,
            v_item->>'signer_name',
            v_item->>'signer_role',
            v_item->>'signature_path',
            p_acceptance_text_version
        )
        ON CONFLICT (minutes_id, signer_role) DO UPDATE
        SET signer_name = EXCLUDED.signer_name,
            signature_path = EXCLUDED.signature_path,
            acceptance_text_version = EXCLUDED.acceptance_text_version,
            signed_at = now();

        v_count := v_count + 1;
    END LOOP;

    -- Finalize. The status trigger re-checks the preconditions, so this fails
    -- if anything above left the meeting in an inconsistent shape.
    UPDATE public.meetings m
    SET status = 'signed'
    WHERE m.id = v_meeting_id;

    INSERT INTO public.audit_logs (
        institution_id, actor_id, meeting_id, action, metadata_json
    )
    VALUES (
        v_institution,
        v_actor,
        v_meeting_id,
        'minutes.signed',
        jsonb_build_object(
            'minutes_id', p_minutes_id,
            'version', v_version,
            'roles', to_jsonb(v_roles),
            'acceptance_text_version', p_acceptance_text_version
        )
    );

    RETURN jsonb_build_object(
        'already_signed', false,
        'meeting_id', v_meeting_id,
        'signatures', v_count
    );

END;
$function$;

REVOKE ALL ON FUNCTION
    public.sign_minutes(uuid, jsonb, text)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
    public.sign_minutes(uuid, jsonb, text)
TO authenticated, service_role;

COMMIT;
