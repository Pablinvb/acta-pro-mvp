-- Cierra la puerta de atrás de la firma: el disparador pasa a fallar cerrado.
--
-- Ejecutar **después** de 0002 y de comprobar que la versión promovida firma
-- correctamente. No antes: mientras la versión en producción llame a
-- `sign_minutes` directamente, esto la dejaría sin poder firmar.
--
-- ## Por qué hace falta
--
-- Hoy `acta_private.require_signing_proof()` falla **abierto**: si no encuentra
-- un desafío verificado, solo rechaza cuando alguien activó el indicador
-- `acta.require_verified_signing`, cosa que únicamente hace
-- `sign_minutes_verified`. Es deliberado durante la transición —permite que la
-- versión antigua siga firmando— pero tiene una consecuencia incómoda: **toda
-- la verificación descansa sobre la retirada del permiso de 0002**. Si alguien
-- volviera a conceder `EXECUTE` sobre `sign_minutes`, la verificación
-- desaparecería sin que ninguna prueba lo notara.
--
-- Y esa es precisamente la tentación de una recuperación de urgencia: algo
-- falla tras promover, alguien devuelve el permiso para «desbloquear la firma»
-- y, sin querer, reabre la vía sin verificar.
--
-- Con este archivo aplicado, devolver el permiso ya no reabre nada: sin desafío
-- verificado no se firma, venga la llamada por donde venga. La recuperación
-- segura deja de depender de que nadie se equivoque.
--
-- ## Qué cambia exactamente
--
-- Una sola línea del disparador: la condición que decide qué hacer cuando no
-- hay prueba de verificación. Pasa de «rechaza solo si el indicador está
-- activo» a «rechaza siempre». El resto de la función no se toca.

BEGIN;

CREATE OR REPLACE FUNCTION acta_private.require_signing_proof() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE teacher_name text; rep_name text;
BEGIN
  IF NEW.signer_role NOT IN ('teacher','representative') THEN RETURN NEW; END IF;
  SELECT p.full_name,r.full_name INTO teacher_name,rep_name
    FROM public.signing_challenges c
    JOIN public.minutes a ON a.id=c.minutes_id AND a.version=c.version
    JOIN public.meetings m ON m.id=a.meeting_id AND m.teacher_id=c.actor_id
    JOIN public.profiles p ON p.id=c.actor_id AND p.institution_id=m.institution_id
    JOIN public.student_representatives sr ON sr.student_id=m.student_id AND sr.representative_id=c.representative_id
    JOIN public.representatives r ON r.id=sr.representative_id AND lower(trim(r.email))=c.email
    JOIN public.meeting_participants mp ON mp.meeting_id=m.id AND mp.participant_type='representative' AND mp.participant_ref_id=r.id
    WHERE c.minutes_id=NEW.minutes_id AND c.actor_id=auth.uid() AND c.verified AND c.expires_at>now()
    FOR UPDATE OF c;
  IF NOT FOUND THEN
    -- Falla cerrado. Antes esto dependia del indicador
    -- `acta.require_verified_signing`; ahora no depende de nada que el
    -- llamante pueda omitir.
    RAISE EXCEPTION 'Se requiere verificar a ambos firmantes.' USING ERRCODE='42501';
  END IF;
  IF NEW.signer_role='teacher' THEN
    NEW.signer_name=teacher_name;
    NEW.verification_method='docente_reautenticado';
  ELSE
    NEW.signer_name=rep_name;
    NEW.verification_method='codigo_correo';
  END IF;
  RETURN NEW;
END;
$$;

-- Comprobación: ninguna firma nueva puede entrar sin desafío verificado, ni
-- siquiera con los privilegios del dueño de la tabla. Si esto no lanzara
-- excepción, el archivo no habría hecho su trabajo y no se confirma.
DO $$
DECLARE v_minutes uuid; v_motivo text;
BEGIN
    -- Un acta sin firmar: si se usara una ya firmada, la negativa vendria de
    -- `protect_finalized_signatures` y la comprobacion aprobaria por el motivo
    -- equivocado, que es peor que no comprobar nada.
    SELECT a.id INTO v_minutes
      FROM public.minutes a
     WHERE NOT EXISTS (SELECT 1 FROM public.signatures s WHERE s.minutes_id = a.id)
     LIMIT 1;

    IF v_minutes IS NULL THEN
        RAISE NOTICE 'Sin actas sin firmar: la comprobacion automatica se omite.';
        RAISE NOTICE 'Compruebelo a mano antes de dar la transicion por buena.';
        RETURN;
    END IF;

    BEGIN
        INSERT INTO public.signatures
            (minutes_id, signer_name, signer_role, signature_path, acceptance_text_version)
        VALUES (v_minutes, 'Comprobacion', 'teacher', 'X', 'v1');
        RAISE EXCEPTION 'El disparador sigue dejando pasar firmas sin verificar';
    EXCEPTION WHEN others THEN
        v_motivo := SQLERRM;
    END;

    -- Y se exige que la negativa sea **la correcta**, no cualquiera.
    IF v_motivo IS DISTINCT FROM 'Se requiere verificar a ambos firmantes.' THEN
        RAISE EXCEPTION 'La negativa no vino de la verificacion sino de: %', v_motivo;
    END IF;
END;
$$;

COMMIT;
