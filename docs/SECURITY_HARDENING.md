# Arquitectura de seguridad de ACTA PRO

Estado: rama `security/hardening`, validado contra Supabase local.
Última actualización: 2026-11-26.

---

## 1. Principio

La autoridad está en Postgres, no en la aplicación. Cada regla que importa se
cumple aunque alguien llame a la Data API directamente con la clave publicable,
sin pasar por Next.js. La aplicación valida antes para dar un error legible,
pero nunca es el único freno.

## 2. Capas

| Capa | Qué impide |
| --- | --- |
| Privilegios de tabla | Que `anon` toque nada y que `authenticated` use TRUNCATE, REFERENCES o TRIGGER |
| Row Level Security | Que se lea o escriba fuera de la institución y de las reuniones propias |
| Triggers | Transiciones inválidas, identidades mutadas, documentos y actas finalizadas |
| Funciones `SECURITY DEFINER` | Operaciones que necesitan privilegio y por eso comprueban autorización ellas mismas |

## 3. Esquema privado

`acta_private` aloja las funciones de autorización y los guardianes. Está
revocado a `PUBLIC` y a `anon`; solo `authenticated` y `service_role` tienen
`USAGE`. Todas las funciones fijan `search_path = ''` y referencian cada objeto
con su esquema, de modo que no pueden ser secuestradas creando objetos
homónimos en un esquema anterior del `search_path`.

| Función | Para qué |
| --- | --- |
| `current_institution_id()` | Institución del perfil autenticado |
| `can_access_meeting(uuid)` | Titularidad o rol de administración sobre una reunión |
| `meeting_can_be_signed(uuid)` | Versión vigente aprobada con ambas firmas obligatorias |
| `protect_meeting_identity()` | Identidad de la reunión inmutable |
| `protect_meeting_status()` | Transiciones válidas **y** precondiciones de finalización |
| `protect_meeting_creation()` | Una reunión solo nace `scheduled` o `ready` |
| `protect_document_metadata()` | Metadatos del documento inmutables |
| `protect_finalized_minutes()` | Actas firmadas o enviadas inmutables |
| `protect_finalized_signatures()` | Firmas finalizadas inmutables; exige acta aprobada |
| `revoke_approval_on_reopen()` | Al reabrir, revoca aprobación y descarta firmas |

## 4. Firma atómica

`public.sign_minutes(minutes_id, signatures, acceptance_text_version)` es la
única vía para firmar. En una sola transacción:

1. Comprueba que hay sesión y que la reunión es accesible.
2. Bloquea la reunión con `FOR UPDATE`, de modo que dos solicitudes
   simultáneas se serializan en lugar de competir.
3. Verifica que el acta es la versión vigente y está aprobada.
4. Verifica que la reunión está en `approved`.
5. Exige las firmas de docente y representante.
6. Inserta o reemplaza las firmas.
7. Cambia el estado a `signed`, lo que vuelve a disparar la comprobación de
   precondiciones.
8. Escribe la auditoría.

Si algo falla, no queda nada: ni firmas sueltas ni estados a medias.

**Idempotencia honesta.** Repetir la llamada sobre un acta ya firmada devuelve
éxito **solo si el contenido coincide** —rol, nombre y firma, con independencia
del orden—. Si difiere, se rechaza: devolver éxito haría creer que se registró
algo que no se registró.

La escritura directa sobre `signatures` está revocada para `authenticated`, de
modo que esta vía no se puede eludir desde la Data API.

## 5. Finalización y reapertura

Una reunión no alcanza `signed` sin versión vigente aprobada y ambas firmas
obligatorias. La comprobación vive en el trigger de estado, no en la
aplicación, y cubre también el `INSERT`: antes se podía crear directamente una
reunión en `signed` porque el trigger era solo `BEFORE UPDATE`.

Al volver de `approved` a `draft` se revoca la aprobación del acta vigente, se
descartan sus firmas y queda constancia en auditoría. Conservarlas permitiría
que una firma recogida para un texto finalizara otro distinto.

## 6. Mínimo privilegio

El hallazgo más grave de esta fase: **todas las tablas concedían `TRUNCATE` a
`anon` y a `authenticated`**, y `TRUNCATE` no pasa por RLS. Las políticas eran
correctas y aun así el historial de auditoría era borrable por cualquier
sesión. Procede de la exposición automática de tablas nuevas de Supabase.

Estado actual:

| Rol | Privilegios en `public` |
| --- | --- |
| `anon` | Ninguno |
| `authenticated` | Lectura según RLS; escritura solo en `meetings`, `meeting_participants`, `transcript_segments`, `minutes`, `documents`, `commitment_tracking` y `audit_logs` (solo `INSERT`) |
| `service_role` | Almacenamiento y `google_credentials` |

## 7. Auditoría

`audit_logs` no admite `UPDATE` ni `DELETE`. Su política de inserción exige que
el actor sea quien firma la petición, que la institución sea la suya y que la
reunión le pertenezca. Las acciones `minutes.signed` y `minutes.reopened` solo
pueden nacer de funciones `SECURITY DEFINER`: no se pueden fabricar desde el
cliente.

Los metadatos guardan recuentos e identificadores, nunca contenido: ni
transcripciones, ni imágenes de firma, ni cuerpos de correo.

## 8. Límites honestos

- **La firma manuscrita digitalizada no es una firma electrónica
  cualificada ni certificada.** Es un trazo dibujado en pantalla guardado como
  PNG. No acredita identidad. Su valor depende de que la persona firme
  presencialmente y de las políticas de la institución.
- El límite de tasa de la aplicación es **por proceso**: con varias instancias
  el tope efectivo se multiplica.
- No hay Content Security Policy con nonces.
- Los textos de consentimiento y aceptación son borradores institucionales
  **pendientes de revisión jurídica**.

## 9. Datos de estudiantes

El audio nunca se persiste en el servidor. La transcripción, el acta y el
documento se conservan según la política de archivo de la institución, que
todavía no está implementada como borrado programado. Al tratarse de menores,
antes de cualquier uso real hacen falta acuerdos de encargo de tratamiento con
los proveedores externos y una evaluación de impacto. Detalle en
[`PRIVACY_CHECKLIST.md`](PRIVACY_CHECKLIST.md).
