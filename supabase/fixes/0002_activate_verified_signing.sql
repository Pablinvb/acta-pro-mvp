-- Ejecutar al promover la versión verificada, con el remitente de Resend operativo.
BEGIN;
REVOKE EXECUTE ON FUNCTION public.sign_minutes(uuid,jsonb,text) FROM PUBLIC,anon,authenticated;
DO $$
BEGIN
  IF has_function_privilege('authenticated','public.sign_minutes(uuid,jsonb,text)','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.sign_minutes_verified(uuid,jsonb,text)','EXECUTE')
  THEN RAISE EXCEPTION 'La activación no completó el cambio de permisos'; END IF;
END;
$$;
COMMIT;
