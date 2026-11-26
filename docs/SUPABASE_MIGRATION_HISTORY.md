# Historial de migraciones y divergencia con el proyecto remoto

Última verificación: 2026-11-26, con `supabase migration list` y
`supabase db diff --remote` (ambos de solo lectura).

---

## 1. Estado real

| Migración | Archivo local | Historial remoto | Esquema remoto |
| --- | --- | --- | --- |
| `20261125032101_init` | sí | sí | parcial, ver §3 |
| `20261125032107_storage` | sí | sí | — |
| `20261125032110_commitment_tracking` | sí | sí | — |
| `20261125163219_security_hardening` | sí | sí | — |
| `20261125212938_document_and_meeting_integrity` | sí | **no** | **objetos ausentes** |
| `20261126025018_atomic_signing_and_finalization` | sí | no | ausente |
| `20261126030401_harden_signature_writes` | sí | no | ausente |
| `20261126031630_least_privilege_and_audit_integrity` | sí | no | ausente |

> **Que coincidan los identificadores no prueba que el esquema esté
> sincronizado.** Aquí ni siquiera coinciden, y además hay divergencia de
> contenido en los que sí figuran.

## 2. La primera migración no es idéntica a su original remota

`supabase/migration-history/` conserva las migraciones recuperadas del
proyecto remoto. La primera, `20261125032101_archive_legacy_and_0001_init.sql`,
**archiva las tablas antiguas hacia `acta_legacy_20261124` antes de crear el
esquema nuevo**.

La migración activa local con ese mismo identificador omite deliberadamente el
archivado, para que una instalación limpia no intente mover tablas que no
existen. **No son el mismo archivo.**

Las copias históricas se conservan a propósito y no deben alterarse para
disimular la diferencia: documentan lo que realmente se ejecutó en remoto.

## 3. Qué le falta al esquema remoto

Según `supabase db diff --remote`, al proyecto `lmscltbyehofrwtddbfn` le faltan:

- Los **7 triggers** de protección (identidad y estado de reunión, metadatos de
  documento, actas y firmas finalizadas, creación de reunión, reapertura).
- Las **8 restricciones** de integridad (claves compuestas institucionales,
  referencias documentales, formato SHA-256, unicidad de firma por rol).
- La función `public.sign_minutes` y las del esquema privado añadidas después.
- Los recortes de privilegio: **el remoto conserva `TRUNCATE` para `anon` y
  `authenticated`**.

Es decir: **el endurecimiento de seguridad no está vivo en producción.**

## 4. Los enums heredados

El remoto contiene dos tipos que el esquema activo no define:

```
public.data_status    = ok | verified | manual_verification_required
public.meeting_status = scheduled | in_progress | awaiting_teacher_review
                      | teacher_approved | rejected | signed | sent
                      | retry_required
```

Pertenecen al diseño anterior, archivado en `acta_legacy_20261124`. El esquema
activo modela el estado como `text` con `CHECK`, no como enum, y sus valores
son otros (`ready`, `recording`, `processing`, `draft`, `approved`).

**Su existencia no prueba incompatibilidad por sí sola.** Un tipo sin columnas
ni funciones que lo usen es inerte. Antes de decidir si se eliminan hay que
comprobar, en remoto y en solo lectura, si alguna columna, función, política o
índice depende de ellos:

```sql
select c.relname, a.attname
from pg_attribute a
join pg_class c on c.oid = a.attrelid
join pg_type t on t.oid = a.atttypid
where t.typname in ('data_status','meeting_status') and a.attnum > 0;
```

Si el resultado es vacío, son restos sin efecto y su eliminación es cosmética,
no urgente. Esa comprobación **no se ha ejecutado**: requiere consultar el
remoto con credenciales de base de datos que esta sesión no tiene.

## 5. Reproducibilidad

`supabase db diff` aplica las 8 migraciones sobre una base sombra vacía y
compara con la local: `No schema changes found`.

Para llegar ahí hubo que corregir `20261125212938`: creaba restricciones y
triggers sin guarda, de modo que fallaba con `42P07` al reaplicarse. Se editó
ese archivo en lugar de crear otro **porque nunca llegó al remoto**; editar una
migración ya aplicada en producción sí habría sido incorrecto.
