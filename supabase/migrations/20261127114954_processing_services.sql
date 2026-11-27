CREATE TABLE acta_private.request_windows (
  actor uuid NOT NULL REFERENCES public.profiles ON DELETE CASCADE,
  operation text NOT NULL,
  expires_at timestamptz NOT NULL,
  requests integer NOT NULL,
  PRIMARY KEY (actor, operation)
);
REVOKE ALL ON acta_private.request_windows FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.consume_request(p_actor uuid, p_operation text, p_limit integer)
RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  WITH consumed AS (
    INSERT INTO acta_private.request_windows AS w VALUES
      (p_actor, p_operation, now() + interval '1 minute', 1)
    ON CONFLICT (actor, operation) DO UPDATE SET
      requests = CASE WHEN w.expires_at <= now() THEN 1 ELSE w.requests + 1 END,
      expires_at = CASE WHEN w.expires_at <= now() THEN excluded.expires_at ELSE w.expires_at END
    WHERE w.expires_at <= now() OR w.requests < p_limit
    RETURNING 1
  ) SELECT EXISTS (SELECT FROM consumed);
$$;
GRANT USAGE ON SCHEMA acta_private TO service_role;
GRANT SELECT, INSERT, UPDATE ON acta_private.request_windows TO service_role;
REVOKE ALL ON FUNCTION public.consume_request(uuid,text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_request(uuid,text,integer) TO service_role;

CREATE TABLE public.generation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES public.meetings ON DELETE CASCADE,
  institution_id uuid NOT NULL REFERENCES public.institutions ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES public.profiles ON DELETE CASCADE,
  fingerprint text NOT NULL,
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','reserved','running','generated','completed','failed','uncertain')),
  result jsonb,
  model text,
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  touched_at timestamptz NOT NULL DEFAULT now(),
  minutes_id uuid REFERENCES public.minutes,
  UNIQUE(meeting_id, fingerprint)
);
ALTER TABLE public.generation_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.generation_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT,INSERT,UPDATE ON public.generation_jobs TO service_role;
CREATE INDEX generation_jobs_waiting ON public.generation_jobs(available_at) WHERE state='queued';

CREATE FUNCTION public.claim_generation(p_id uuid)
RETURNS SETOF public.generation_jobs LANGUAGE sql SET search_path='' AS $$
  UPDATE public.generation_jobs j SET state='reserved', attempts=attempts+1,touched_at=now()
  FROM public.meetings m JOIN public.profiles p ON p.institution_id=m.institution_id
  WHERE j.id=p_id AND j.meeting_id=m.id AND j.institution_id=m.institution_id
    AND p.id=j.actor_id AND (p.id=m.teacher_id OR p.role='admin')
    AND m.status IN ('processing','draft') AND j.state='queued' AND j.available_at<=now() AND attempts<3
  RETURNING j.*;
$$;

CREATE FUNCTION public.finish_generation(p_id uuid)
RETURNS uuid LANGUAGE plpgsql SET search_path='' AS $$
DECLARE
  j public.generation_jobs;
  m public.meetings;
  result_id uuid;
  p_content jsonb;
  draft_version integer;
BEGIN
  SELECT * INTO STRICT j FROM public.generation_jobs WHERE id=p_id FOR UPDATE;
  IF j.state='completed' THEN RETURN j.minutes_id; END IF;
  SELECT * INTO STRICT m FROM public.meetings WHERE id=j.meeting_id FOR UPDATE;
  p_content := j.result;
  IF j.state <> 'generated' OR m.status NOT IN ('processing','draft') OR m.institution_id<>j.institution_id OR
     NOT EXISTS(SELECT FROM public.profiles p WHERE p.id=j.actor_id AND p.institution_id=m.institution_id AND (p.role='admin' OR p.id=m.teacher_id))
  THEN RAISE EXCEPTION 'Job unavailable'; END IF;
  SELECT coalesce(max(version),0)+1 INTO draft_version FROM public.minutes WHERE meeting_id=m.id;
  INSERT INTO public.minutes(meeting_id,version,status,generator,model,summary,meeting_reason,topics_json,facts_json,
    agreements_json,commitments_json,follow_up_json,pending_items_json,contradictions_json,language_flags_json,review_warnings_json)
  VALUES(m.id,draft_version,'draft','anthropic',j.model,p_content->>'summary',p_content->>'meeting_reason',
    p_content->'topics',p_content->'facts',p_content->'agreements',p_content->'commitments',p_content->'follow_up',
    p_content->'pending_items',p_content->'contradictions',p_content->'language_flags',p_content->'review_warnings') RETURNING id INTO result_id;
  UPDATE public.meetings SET status='draft' WHERE id=m.id AND status='processing';
  UPDATE public.generation_jobs SET state='completed',result=NULL,minutes_id=result_id,touched_at=now() WHERE id=j.id;
  INSERT INTO public.audit_logs(institution_id,meeting_id,actor_id,action,metadata_json)
    VALUES(m.institution_id,m.id,j.actor_id,'minutes.generated',jsonb_build_object('version',draft_version,'job_id',j.id));
  RETURN result_id;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_generation(uuid),public.finish_generation(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_generation(uuid),public.finish_generation(uuid) TO service_role;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('acta-audio-recovery','acta-audio-recovery',false,52428800,
  ARRAY['audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/wav']);

CREATE TABLE public.signing_challenges (
  minutes_id uuid PRIMARY KEY REFERENCES public.minutes ON DELETE CASCADE,
  version integer NOT NULL,
  actor_id uuid NOT NULL REFERENCES public.profiles ON DELETE CASCADE,
  representative_id uuid NOT NULL REFERENCES public.representatives ON DELETE CASCADE,
  email text NOT NULL,
  salt uuid NOT NULL,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  verified boolean NOT NULL DEFAULT false
);
ALTER TABLE public.signing_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.signing_challenges FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.signing_challenges TO service_role;

CREATE FUNCTION public.verify_signing_code(p_minutes uuid,p_actor uuid,p_salt uuid,p_hash text)
RETURNS boolean LANGUAGE sql SET search_path='' AS $$
  WITH changed AS (
    UPDATE public.signing_challenges SET attempts=attempts+1, verified=(code_hash=p_hash)
    WHERE minutes_id=p_minutes AND actor_id=p_actor AND salt=p_salt AND expires_at>now()
      AND NOT verified AND attempts<5
    RETURNING verified
  ) SELECT coalesce((SELECT verified FROM changed),false)
$$;
REVOKE ALL ON FUNCTION public.verify_signing_code(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.verify_signing_code(uuid,uuid,uuid,text) TO service_role;

ALTER TABLE public.signatures DROP CONSTRAINT signatures_verification_method_check;
ALTER TABLE public.signatures ADD CONSTRAINT signatures_verification_method_check CHECK
  (verification_method IN ('no_registrado','sesion_verificada','presencial_atestiguada','codigo_correo','docente_reautenticado'));

CREATE FUNCTION acta_private.require_signing_proof() RETURNS trigger
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
    -- Solo la operación anterior al despliegue admite firma presencial.
    -- La entrada nueva comprueba y bloquea la evidencia antes de llamar al núcleo.
    IF current_setting('acta.require_verified_signing', true) = 'on' THEN
      RAISE EXCEPTION 'Se requiere verificar a ambos firmantes.' USING ERRCODE='42501';
    END IF;
    RETURN NEW;
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
-- El cliente no elige el método ni controla la exigencia de la entrada nueva.
CREATE FUNCTION public.sign_minutes_verified(p_minutes_id uuid,p_signatures jsonb,p_acceptance_text_version text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM set_config('acta.require_verified_signing','on',true);
  RETURN public.sign_minutes(p_minutes_id,p_signatures,p_acceptance_text_version);
END;
$$;
REVOKE ALL ON FUNCTION public.sign_minutes_verified(uuid,jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sign_minutes_verified(uuid,jsonb,text) TO authenticated;

CREATE TRIGGER verify_identity BEFORE INSERT ON public.signatures FOR EACH ROW EXECUTE FUNCTION acta_private.require_signing_proof();
CREATE FUNCTION acta_private.clear_signing_proof() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  DELETE FROM public.signing_challenges c USING public.minutes a WHERE c.minutes_id=a.id AND a.meeting_id=NEW.id;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION acta_private.clear_signing_proof() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER consume_identity AFTER UPDATE OF status ON public.meetings FOR EACH ROW
  WHEN (OLD.status='approved' AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION acta_private.clear_signing_proof();

CREATE TABLE public.recovery_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  object_path text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL DEFAULT now()+interval '2 hours 5 minutes'
);
ALTER TABLE public.recovery_uploads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.recovery_uploads FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,DELETE ON public.recovery_uploads TO service_role;
CREATE INDEX recovery_upload_expiry ON public.recovery_uploads(expires_at);
