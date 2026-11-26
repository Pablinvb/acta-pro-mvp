-- ACTA PRO
-- Migration 0007: endurecimiento de la escritura de firmas
--
-- Tres correcciones sobre la migracion anterior:
--
-- 1. `sign_minutes` devolvia exito ante cualquier repeticion sobre un acta ya
--    firmada, incluso si el contenido enviado era distinto. Una segunda
--    llamada con otras firmas recibia `already_signed` y el cliente creia que
--    se habian registrado. Ahora solo es idempotente cuando el contenido
--    coincide; si difiere, falla.
--
-- 2. La politica de `signatures` permitia escritura directa a `authenticated`.
--    Los triggers impedian el peor resultado, pero no obligaban a pasar por la
--    operacion transaccional. Las firmas pasan a ser de solo lectura para la
--    Data API: solo las funciones SECURITY DEFINER de este esquema las
--    escriben.
--
-- 3. Al dejar de poder borrar firmas, el trigger de reapertura necesita
--    privilegios propios.


-- ---------------------------------------------------------------------------
-- 1. Reapertura con privilegios propios.
-- ---------------------------------------------------------------------------

BEGIN;

CREATE OR REPLACE FUNCTION acta_private.revoke_approval_on_reopen()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
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

    DELETE FROM public.signatures s WHERE s.minutes_id = v_minutes_id;
    GET DIAGNOSTICS v_removed = ROW_COUNT;

    UPDATE public.minutes a
    SET status = 'draft', approved_at = NULL
    WHERE a.id = v_minutes_id AND a.status <> 'draft';

    INSERT INTO public.audit_logs (
        institution_id, actor_id, meeting_id, action, metadata_json
    )
    VALUES (
        NEW.institution_id, auth.uid(), NEW.id, 'minutes.reopened',
        jsonb_build_object('minutes_id', v_minutes_id,
                           'revoked_signatures', v_removed)
    );

    RETURN NEW;

END;
$function$;

REVOKE ALL ON FUNCTION acta_private.revoke_approval_on_reopen()
FROM PUBLIC, anon, authenticated;

COMMIT;


-- ---------------------------------------------------------------------------
-- 2. Las firmas dejan de escribirse desde la Data API.
--
-- `authenticated` conserva la lectura, que la interfaz necesita para mostrar
-- quien firmo. Toda escritura pasa por `public.sign_minutes` o por el trigger
-- de reapertura, ambos SECURITY DEFINER y con autorizacion propia.
-- ---------------------------------------------------------------------------

BEGIN;

DROP POLICY IF EXISTS signatures_all ON public.signatures;

CREATE POLICY signatures_read
ON public.signatures
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.minutes m
        WHERE m.id = signatures.minutes_id
          AND acta_private.can_access_meeting(m.meeting_id)
    )
);

REVOKE INSERT, UPDATE, DELETE ON public.signatures FROM authenticated, anon;

COMMIT;


-- ---------------------------------------------------------------------------
-- 3. Idempotencia honesta.
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
    v_submitted       jsonb;
    v_stored          jsonb;
BEGIN

    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
    END IF;

    IF jsonb_typeof(p_signatures) <> 'array'
       OR jsonb_array_length(p_signatures) = 0
    THEN
        RAISE EXCEPTION 'At least one signature is required.'
            USING ERRCODE = '22023';
    END IF;

    -- Bloquea la reunion durante toda la transaccion: dos solicitudes
    -- concurrentes se serializan aqui en lugar de competir.
    SELECT m.id, m.status, m.institution_id, a.status, a.version
      INTO v_meeting_id, v_meeting_status, v_institution,
           v_minutes_status, v_version
    FROM public.minutes a
    JOIN public.meetings m ON m.id = a.meeting_id
    WHERE a.id = p_minutes_id
    FOR UPDATE OF m;

    IF v_meeting_id IS NULL THEN
        RAISE EXCEPTION 'Minutes unavailable.' USING ERRCODE = '42501';
    END IF;

    IF NOT acta_private.can_access_meeting(v_meeting_id) THEN
        RAISE EXCEPTION 'Minutes unavailable.' USING ERRCODE = '42501';
    END IF;

    -- Repeticion sobre un acta ya firmada: solo es idempotente si lo enviado
    -- coincide exactamente con lo almacenado. Si difiere, se rechaza, porque
    -- devolver exito haria creer que se registro algo que no se registro.
    IF v_meeting_status IN ('signed', 'sent') THEN

        SELECT jsonb_agg(x ORDER BY x->>'signer_role')
          INTO v_submitted
        FROM (
            SELECT jsonb_build_object(
                       'signer_role', value->>'signer_role',
                       'signer_name', value->>'signer_name',
                       'signature_path', value->>'signature_path'
                   ) AS x
            FROM jsonb_array_elements(p_signatures) AS value
        ) submitted;

        SELECT jsonb_agg(y ORDER BY y->>'signer_role')
          INTO v_stored
        FROM (
            SELECT jsonb_build_object(
                       'signer_role', s.signer_role,
                       'signer_name', s.signer_name,
                       'signature_path', s.signature_path
                   ) AS y
            FROM public.signatures s
            WHERE s.minutes_id = p_minutes_id
        ) stored;

        IF v_submitted IS DISTINCT FROM v_stored THEN
            RAISE EXCEPTION
                'These minutes are already signed with different content.'
                USING ERRCODE = '23514';
        END IF;

        RETURN jsonb_build_object(
            'already_signed', true,
            'meeting_id', v_meeting_id,
            'signatures', jsonb_array_length(coalesce(v_stored, '[]'::jsonb))
        );
    END IF;

    SELECT max(a.version) INTO v_latest_version
    FROM public.minutes a WHERE a.meeting_id = v_meeting_id;

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

    SELECT array_agg(DISTINCT value->>'signer_role') INTO v_roles
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

    UPDATE public.meetings m SET status = 'signed' WHERE m.id = v_meeting_id;

    INSERT INTO public.audit_logs (
        institution_id, actor_id, meeting_id, action, metadata_json
    )
    VALUES (
        v_institution, v_actor, v_meeting_id, 'minutes.signed',
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

REVOKE ALL ON FUNCTION public.sign_minutes(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sign_minutes(uuid, jsonb, text)
TO authenticated, service_role;

COMMIT;
