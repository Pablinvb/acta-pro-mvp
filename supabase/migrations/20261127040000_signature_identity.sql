-- Ata cada firma a la sesion que la capturo y declara como se verifico.
--
-- Lo que esto cierra y lo que no. ACTA PRO ya impedia modificar una firma,
-- borrarla, insertarla saltandose la funcion transaccional, repetir el rol,
-- reutilizarla en otro texto y firmar un acta de otra institucion. Lo unico
-- que no acreditaba era **quien** dibujo el trazo: `signer_name` es un texto.
--
-- Esta migracion no resuelve esa pregunta del todo -no se resuelve con codigo
-- solo, ver docs/FIRMAS_E_IDENTIDAD.md-, pero deja de perder la informacion que
-- el sistema ya tiene:
--
--   signed_by             la sesion verificada que capturo la firma, de auth.uid()
--   verification_method   como se verifico a quien firma
--
-- `verification_method` admite tres valores y la diferencia importa:
--
--   sesion_verificada        la firma del personal docente que convoca, atada
--                            a su cuenta autenticada
--   presencial_atestiguada   capturada en el dispositivo de esa sesion, con la
--                            docente presente; es el caso del representante
--   codigo_correo            verificada con un codigo de un solo uso; todavia
--                            no implementado, el valor se reserva aqui para no
--                            tener que migrar otra vez cuando se decida
--
-- Que el acta pueda declarar **como** se verifico cada firma es, para una
-- institucion, mas util que fingir que todas se verificaron igual.
--
-- Las dos columnas quedan protegidas por el mismo disparador que el resto:
-- `protect_finalized_signatures` vigila INSERT, UPDATE y DELETE, de modo que
-- una firma finalizada no cambia de metodo de verificacion a posteriori.

ALTER TABLE public.signatures
    ADD COLUMN IF NOT EXISTS signed_by uuid REFERENCES public.profiles(id),
    ADD COLUMN IF NOT EXISTS verification_method text NOT NULL
        DEFAULT 'presencial_atestiguada';

-- Las firmas anteriores a esta migracion se quedan con el valor por defecto, y
-- es el correcto: se capturaron asi. No se reescribe el pasado para que encaje
-- con la regla nueva.

ALTER TABLE public.signatures
    DROP CONSTRAINT IF EXISTS signatures_verification_method_check;

ALTER TABLE public.signatures
    ADD CONSTRAINT signatures_verification_method_check
    CHECK (verification_method IN
        ('presencial_atestiguada', 'sesion_verificada', 'codigo_correo'));

CREATE OR REPLACE FUNCTION public.sign_minutes(p_minutes_id uuid, p_signatures jsonb, p_acceptance_text_version text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
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
            signature_path, acceptance_text_version,
            signed_by, verification_method
        )
        VALUES (
            p_minutes_id,
            v_item->>'signer_name',
            v_item->>'signer_role',
            v_item->>'signature_path',
            p_acceptance_text_version,
            -- Quien operaba la sesion que capturo la firma. Sale de auth.uid(),
            -- nunca de algo que mande el navegador.
            v_actor,
            -- Y como se verifico a quien firma. Solo la firma del personal
            -- docente que convoca la reunion queda atada a una sesion
            -- verificada; las demas se capturan en ese mismo dispositivo y lo
            -- honesto es decir que son presenciales atestiguadas.
            CASE
                WHEN v_item->>'signer_role' = 'teacher'
                     AND v_actor = (
                         SELECT m2.teacher_id FROM public.meetings m2
                         WHERE m2.id = v_meeting_id
                     )
                THEN 'sesion_verificada'
                ELSE 'presencial_atestiguada'
            END
        )
        ON CONFLICT (minutes_id, signer_role) DO UPDATE
        SET signer_name = EXCLUDED.signer_name,
            signature_path = EXCLUDED.signature_path,
            acceptance_text_version = EXCLUDED.acceptance_text_version,
            signed_by = EXCLUDED.signed_by,
            verification_method = EXCLUDED.verification_method,
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
            'acceptance_text_version', p_acceptance_text_version,
            'verification_methods', (
                SELECT jsonb_object_agg(s.signer_role, s.verification_method)
                FROM public.signatures s WHERE s.minutes_id = p_minutes_id
            )
        )
    );

    RETURN jsonb_build_object(
        'already_signed', false,
        'meeting_id', v_meeting_id,
        'signatures', v_count
    );

END;
$function$
