# Historial de migraciones y divergencia con el proyecto remoto

Última verificación: 2026-11-26, con `supabase migration list --remote` y
`supabase db dump --remote` (ambos de solo lectura).

> **Corrección respecto a la versión anterior de esta página.** Decía que al
> remoto le faltaban cuatro migraciones y que `20261125163219_security_hardening`
> constaba aplicada. Ninguna de las dos cosas es cierta. El volcado del esquema
> remoto y el historial lo desmienten: **faltan seis**, y la de endurecimiento
> es una de ellas. Se deja escrita la corrección en lugar de reescribir la
> página en silencio, porque el error afectaba a la decisión de qué aplicar.

---

## 1. Estado real

| # | Migración | Archivo local | Historial remoto | Esquema remoto |
| --- | --- | --- | --- | --- |
| 1 | `20261125032101_init` | sí | **sí** | parcial, ver §3 |
| 2 | `20261125032107_storage` | sí | **sí** | presente |
| 3 | `20261125032110_commitment_tracking` | sí | **sí** | presente |
| 4 | `20261125163219_security_hardening` | sí | no | **ausente** |
| 5 | `20261125212938_document_and_meeting_integrity` | sí | no | **ausente** |
| 6 | `20261126025018_atomic_signing_and_finalization` | sí | no | **ausente** |
| 7 | `20261126030401_harden_signature_writes` | sí | no | **ausente** |
| 8 | `20261126031630_least_privilege_and_audit_integrity` | sí | no | **ausente** |
| 9 | `20261126033310_document_generation_idempotency` | sí | no | **ausente** |

**9 migraciones locales, 3 aplicadas en remoto, 6 pendientes.**

> Que coincidan los identificadores no prueba que el esquema esté sincronizado.
> Aquí no coinciden, y además hay divergencia de contenido en la primera, que sí
> figura en ambos lados (§2).

## 2. La primera migración no es idéntica a su original remota

`supabase/migration-history/` conserva las migraciones recuperadas del proyecto
remoto. La primera, `20261125032101_archive_legacy_and_0001_init.sql`, **archiva
las tablas antiguas hacia `acta_legacy_20261124` antes de crear el esquema
nuevo**.

La migración activa local con ese mismo identificador omite deliberadamente el
archivado, para que una instalación limpia no intente mover tablas que no
existen. **No son el mismo archivo.**

Las copias históricas se conservan a propósito y no deben alterarse para
disimular la diferencia: documentan lo que realmente se ejecutó en remoto.

## 3. Qué le falta al esquema remoto

Según `supabase db dump --remote` del 2026-11-26, el proyecto
`lmscltbyehofrwtddbfn` tiene:

| Objeto | Local | Remoto |
| --- | --- | --- |
| Disparadores de protección en `public` | 7 | **0** |
| Funciones en `acta_private` | 12 | **2** (`can_access_meeting`, `current_institution_id`) |
| `public.sign_minutes` | sí | **no** |
| Restricciones `CHECK` de integridad documental | sí | **no** (`documents_sha256_format_check` ausente) |
| Índice único de firma por rol | sí | **no** |
| Índice único de huella de generación | sí | **no** |
| `TRUNCATE` para `anon` y `authenticated` | revocado | **concedido en las 28 tablas** |
| Privilegios de `anon` en `public` | ninguno | **`GRANT ALL` en todas las tablas** |

Es decir: **el endurecimiento de seguridad no está vivo en producción.** La
firma no es atómica allí, una reunión puede alcanzar `signed` sin firmas, y
`audit_logs` es vaciable por cualquier rol de la Data API a nivel de
PostgreSQL.

### El matiz sobre `TRUNCATE`, con precisión

`GRANT ALL` incluye `TRUNCATE`, y `TRUNCATE` no pasa por RLS. Pero hay que
separar dos cosas:

- **Concedido en PostgreSQL**: sí, en las 28 tablas de `public` y del esquema
  archivado, para `anon` y `authenticated`.
- **Alcanzable con la clave publicable**: no. PostgREST no tiene forma de
  expresar `TRUNCATE`, y la auditoría confirmó que el remoto **no expone
  ninguna función invocable** (`/rpc/` vacío), de modo que hoy no existe una vía
  para ejecutarlo desde la API de datos.

No es una puerta abierta: es una puerta sin cerradura. Se vuelve aprovechable
en cuanto aparezca cualquier camino que ejecute SQL con esos roles. La
corrección está preparada y aislada en
[`supabase/fixes/0001_revoke_truncate.sql`](../supabase/fixes/0001_revoke_truncate.sql).

## 4. Los enums heredados: ya no es una pregunta abierta

El remoto contiene dos tipos que el esquema activo no define:

```
public.data_status    = ok | verified | manual_verification_required
public.meeting_status = scheduled | in_progress | awaiting_teacher_review
                      | teacher_approved | rejected | signed | sent
                      | retry_required
```

La versión anterior de esta página decía, correctamente, que su existencia no
prueba incompatibilidad y que había que comprobar las dependencias. **Ya se
comprobó**, sobre el volcado del esquema remoto:

| Dependencia | Dónde |
| --- | --- |
| `acta_legacy_20261124.meetings.status` | columna, tipo `public.meeting_status` |
| `acta_legacy_20261124.meetings.data_status` | columna, tipo `public.data_status` |
| `acta_legacy_20261124.meetings_read` | vista que proyecta ambas columnas |

**No son restos inertes.** Están en uso por el esquema archivado, de modo que
eliminarlos no es cosmético: exige decidir antes qué se hace con ese archivo.
Ninguna de las seis migraciones pendientes los toca, así que **no bloquean la
sincronización**. La decisión puede tomarse después, por separado.

El esquema archivado, por su parte, **no se expone por la API de datos**: una
petición a `meetings_read` devuelve 404. Sus 14 tablas sí tienen `GRANT ALL`
para `anon`, lo que la corrección de `TRUNCATE` cubre.

## 5. Reproducibilidad

`supabase db diff` aplica las 9 migraciones sobre una base sombra vacía y
compara con la local: `No schema changes found`.

Para llegar ahí hubo que corregir `20261125212938`: creaba restricciones y
disparadores sin guarda, de modo que fallaba con `42P07` al reaplicarse. Se
editó ese archivo en lugar de crear otro **porque nunca llegó al remoto**;
editar una migración ya aplicada en producción sí habría sido incorrecto.

Desde el 2026-11-26 la reproducibilidad no se comprueba solo con `db diff`:
`npm run verify:clean-install` levanta una pila local **independiente y
desechable**, aplica el historial desde cero y ejecuta contra ella la suite
completa. Ver [`SECURITY_TEST_REPORT.md`](SECURITY_TEST_REPORT.md) §5.

## 6. Compatibilidad de los datos existentes

`node scripts/audit-remote-readonly.mjs` (solo lectura) comprobó el 2026-11-26
si los datos que ya existen cumplirían las restricciones que introducen las
migraciones pendientes. Es la pregunta que decide si se pueden aplicar sin
pérdida.

| Comprobación | Resultado |
| --- | --- |
| Reuniones con docente o estudiante de otra institución | ninguna |
| Reuniones finalizadas sin las dos firmas obligatorias | ninguna |
| Firmas duplicadas por rol en la misma acta | ninguna |
| Documentos con `sha256` de formato inválido | ninguno |
| Documentos cuya referencia `(acta, reunión, versión)` no cuadra | ninguno |
| Actas con más de un documento registrado | ninguna |

Inventario remoto: 1 institución, 1 perfil, 2 estudiantes, 2 representantes,
4 reuniones, 2 participantes, 1 segmento de transcripción, 1 acta, 2 firmas,
1 documento, 13 anotaciones de auditoría, 3 seguimientos de compromiso,
0 credenciales de Google.

**Conclusión: las seis migraciones pendientes son aplicables sin pérdida de
datos.** El procedimiento exacto está en
[`RELEASE_READINESS.md`](RELEASE_READINESS.md) §6.
