-- Reescribe la política de lectura de `meetings` para que mire las columnas de
-- la fila en lugar de volver a consultar la tabla.
--
-- El problema que resuelve: `acta_private.can_access_meeting(id)` es `STABLE` y
-- consulta `public.meetings` por su cuenta. Dentro de un `INSERT ... RETURNING`
-- -que es lo que pide PostgREST cuando se inserta con `.select()`- esa consulta
-- no ve la fila que se está insertando, devuelve falso, y PostgreSQL rechaza la
-- operación entera con «new row violates row-level security policy». La fila
-- cumple la política; lo que no puede es verse a sí misma todavía. El efecto
-- práctico fue que **crear una reunión dejó de funcionar**.
--
-- La condición de aquí es equivalente, y se puede comprobar término a término
-- contra el cuerpo de `can_access_meeting`:
--
--     m.institution_id = p.institution_id   ->  p.institution_id = meetings.institution_id
--     m.teacher_id = p.id                   ->  p.id = meetings.teacher_id
--     p.role = 'admin'                      ->  p.role = 'admin'
--     JOIN profiles p ON p.id = auth.uid()  ->  WHERE p.id = (SELECT auth.uid())
--
-- No concede nada nuevo: el conjunto de reuniones visibles es el mismo. Lo que
-- cambia es de dónde salen los valores -de la fila candidata en vez de una
-- segunda lectura de la tabla-, y eso es justo lo que permite que el
-- `RETURNING` funcione.
--
-- `auth.uid()` va envuelto en un `SELECT` a propósito: así PostgreSQL lo evalúa
-- una vez por consulta en lugar de una vez por fila, que es lo que recomienda
-- Supabase y lo que señalan sus Advisors como `auth_rls_initplan`.
--
-- Se usa `ALTER POLICY` y no `CREATE POLICY`: la política ya existe y crear otra
-- con el mismo propósito dejaría dos, que en PostgreSQL se combinan con OR y
-- harían más difícil razonar sobre lo que se concede.
--
-- `can_access_meeting` **se conserva sin tocar**: el resto de las tablas
-- -`minutes`, `signatures`, `documents`, `meeting_participants`,
-- `transcript_segments`- la usan sobre la reunión **padre**, que ya existe
-- cuando se inserta la hija. Allí no hay nada que arreglar.

ALTER POLICY meetings_read ON public.meetings
USING (
    EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = (SELECT auth.uid())
          AND p.institution_id = meetings.institution_id
          AND (
              p.id = meetings.teacher_id
              OR p.role = 'admin'
          )
    )
);
