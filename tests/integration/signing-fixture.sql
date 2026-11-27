-- Solo datos ficticios del acta indicada. Verifica un código mediante la misma RPC del servidor.
CREATE OR REPLACE FUNCTION pg_temp.prepare_signing_fixture(target uuid, rep_name text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE m public.meetings; a public.minutes; nonce uuid := gen_random_uuid();
BEGIN
  SELECT * INTO STRICT a FROM public.minutes WHERE id=target;
  SELECT * INTO STRICT m FROM public.meetings WHERE id=a.meeting_id;
  INSERT INTO public.representatives(id,full_name,email) VALUES(target,rep_name,'rep@example.invalid');
  INSERT INTO public.student_representatives(student_id,representative_id) VALUES(m.student_id,target);
  INSERT INTO public.meeting_participants(meeting_id,participant_type,participant_ref_id,display_name)
    VALUES(m.id,'representative',target,rep_name);
  INSERT INTO public.signing_challenges(minutes_id,version,actor_id,representative_id,email,salt,code_hash,expires_at)
    VALUES(target,a.version,m.teacher_id,target,'rep@example.invalid',nonce,'fixture-digest',now()+interval '10 minutes');
  IF public.verify_signing_code(target,m.teacher_id,nonce,'incorrect') OR
    NOT public.verify_signing_code(target,m.teacher_id,nonce,'fixture-digest') OR
    public.verify_signing_code(target,m.teacher_id,nonce,'fixture-digest')
  THEN RAISE EXCEPTION 'Fallo en el consumo de un solo uso'; END IF;
END;
$$;
