-- ACTA PRO
-- Migration 0009: idempotencia de la generacion documental
--
-- Cada POST al generador creaba una fila nueva en `documents`, incluso cuando
-- nada habia cambiado. La causa de fondo es que el PDF incrusta la fecha de
-- generacion tomada del reloj, de modo que los bytes -y por tanto el hash y la
-- ruta de almacenamiento- diferian en cada llamada. Pulsar dos veces dejaba
-- dos registros y dos archivos del mismo acta.
--
-- La solucion no es comparar bytes, que nunca coincidiran, sino una huella
-- determinista de **los datos de entrada** de la generacion. Si la huella ya
-- existe, se reutiliza el documento en lugar de fabricar otro.
--
-- Se distingue ademas la vista previa del documento definitivo: una previa de
-- un borrador no es evidencia y no debe confundirse con el acta firmada.

BEGIN;

ALTER TABLE public.documents
    ADD COLUMN IF NOT EXISTS generation_fingerprint text,
    ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'final';

-- `preview` sale de un acta que aun no esta aprobada y lleva la banda
-- BORRADOR; `final`, de una aprobada.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'documents_kind_check'
    ) THEN
        ALTER TABLE public.documents
        ADD CONSTRAINT documents_kind_check
        CHECK (kind IN ('preview', 'final'));
    END IF;
END;
$$;

-- La huella es hexadecimal de 64 caracteres cuando esta presente. Los
-- documentos historicos la tienen a NULL y siguen siendo validos: no se
-- reescribe el pasado para que encaje con la regla nueva.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'documents_generation_fingerprint_format_check'
    ) THEN
        ALTER TABLE public.documents
        ADD CONSTRAINT documents_generation_fingerprint_format_check
        CHECK (
            generation_fingerprint IS NULL
            OR generation_fingerprint ~ '^[a-f0-9]{64}$'
        );
    END IF;
END;
$$;

-- Esta es la pieza que impide el duplicado, y tambien la que resuelve la
-- carrera: dos solicitudes simultaneas con la misma huella chocan aqui y la
-- segunda reutiliza la fila de la primera en lugar de crear otra.
CREATE UNIQUE INDEX IF NOT EXISTS documents_minutes_fingerprint_unique
ON public.documents (minutes_id, generation_fingerprint)
WHERE generation_fingerprint IS NOT NULL;

COMMIT;


-- ---------------------------------------------------------------------------
-- Los metadatos del documento ya eran inmutables, pero el trigger se escribio
-- antes de que existieran estas dos columnas. Se amplia para que tampoco se
-- puedan alterar.
-- ---------------------------------------------------------------------------

BEGIN;

CREATE OR REPLACE FUNCTION acta_private.protect_document_metadata()
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
       OR NEW.kind IS DISTINCT FROM OLD.kind
       OR NEW.generation_fingerprint IS DISTINCT FROM OLD.generation_fingerprint
    THEN
        RAISE EXCEPTION 'Document metadata cannot be modified.'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;

END;
$function$;

REVOKE ALL ON FUNCTION acta_private.protect_document_metadata()
FROM PUBLIC, anon, authenticated;

COMMIT;
