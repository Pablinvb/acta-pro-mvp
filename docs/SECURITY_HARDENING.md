# Arquitectura de seguridad de ACTA PRO

Estado: rama `security/hardening`, validado contra Supabase local y **aplicado y
verificado en el proyecto remoto**.
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

Las 10 funciones del esquema privado, y para qué sirve cada una:

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

## 5. Idempotencia de la generación documental

Cada solicitud al generador creaba un registro y un archivo nuevos aunque nada
hubiera cambiado. La causa estaba en la fecha: el PDF incrustaba el instante del
reloj, de modo que los bytes —y con ellos el `SHA-256` y la ruta de
almacenamiento— diferían en cada llamada. Pulsar dos veces dejaba dos
«documentos» distintos de la misma acta, cada uno con su hash, lo que vacía de
sentido la verificación de integridad.

### La fecha deja de venir del reloj

`documentTimestamp()` la deriva del propio contenido: el instante más reciente
entre la generación del acta, su aprobación y sus firmas. Es el momento en que
el acta quedó como está, y es el mismo cada vez que se pregunta. Los metadatos
del PDF (`creationDate`, `modificationDate`, `producer`) también se fijan, y sin
eso los bytes seguirían difiriendo aunque el texto fuera idéntico.

Hay una prueba que lo comprueba **sobre el archivo real**: dos generaciones con
los mismos datos producen el mismo PDF byte a byte.

### La huella de generación

`generationFingerprint()` resume los datos de entrada en un `SHA-256`: versión
del generador, acta, versión, código, estado de aprobación, generador y modelo,
contenido, advertencias aceptadas, institución, reunión, estudiante,
participantes —con su consentimiento— y firmas. Participantes y firmas se
ordenan antes, de modo que el orden en que lleguen no cambia la huella.

De la imagen de cada firma se guarda **su hash, no la imagen**: basta para
detectar un cambio y evita arrastrar datos personales a la huella.

No es el hash del archivo. Responde a otra pregunta: si los datos que producen
el PDF son los mismos.

### Quién impide el duplicado

Un índice único **parcial** sobre `(minutes_id, generation_fingerprint)`, en la
base y no en la aplicación. Es parcial a propósito: los documentos anteriores a
esta regla tienen la huella a `NULL` y siguen siendo válidos. No se reescribe el
pasado para que encaje con la regla nueva.

Ese índice resuelve también la carrera. El orden de los pasos no es casual:

1. Si ya hay un documento con esa huella, se reutiliza —**pero solo después de
   comprobar que su archivo sigue en el almacenamiento y que sus bytes son los
   registrados**. Reutilizar sin esa comprobación sería afirmar una evidencia
   que quizá ya no está.
2. Se genera el PDF.
3. **Se inserta el registro antes de subir el archivo.** Dos solicitudes
   simultáneas chocan aquí; quien pierde la carrera no sube nada y reutiliza el
   documento del ganador.
4. Se guarda el archivo. Si falla, se deshace el registro: una fila sin PDF
   detrás sería una referencia a una evidencia que no existe.

La compensación del paso 4 usa el rol de servicio y está acotada por huella y
por «sin enviar». `documents` **no tiene política de `DELETE`** para
`authenticated`, a propósito: la evidencia no se retira desde la aplicación.

### Vista previa y documento definitivo

La columna `kind` distingue `preview` de `final`. Una vista previa sale de un
acta sin aprobar, lleva la banda BORRADOR y no es evidencia institucional. Como
el estado de aprobación entra en la huella, una previa y un definitivo de los
mismos datos tienen huellas distintas y conviven sin estorbarse.

`kind` y `generation_fingerprint` son inmutables, como el resto de los
metadatos del documento.

La orquestación vive en `src/lib/documents/generate.ts`, fuera de la ruta HTTP,
precisamente para poder ejercitarla contra una base de datos real. La ruta se
queda con la sesión, el límite de tasa y los códigos de respuesta.

## 6. Finalización y reapertura

Una reunión no alcanza `signed` sin versión vigente aprobada y ambas firmas
obligatorias. La comprobación vive en el trigger de estado, no en la
aplicación, y cubre también el `INSERT`: antes se podía crear directamente una
reunión en `signed` porque el trigger era solo `BEFORE UPDATE`.

Al volver de `approved` a `draft` se revoca la aprobación del acta vigente, se
descartan sus firmas y queda constancia en auditoría. Conservarlas permitiría
que una firma recogida para un texto finalizara otro distinto.

## 7. Mínimo privilegio

El hallazgo más grave de esta fase: **todas las tablas concedían `TRUNCATE` a
`anon` y a `authenticated`**, y `TRUNCATE` no pasa por RLS. Las políticas eran
correctas y aun así el historial de auditoría era borrable por cualquier
sesión. Procede de la exposición automática de tablas nuevas de Supabase.

Estado actual, **idéntico en la base local y en el proyecto remoto**:

| Rol | Privilegios en `public` |
| --- | --- |
| `anon` | Ninguno |
| `authenticated` | Lectura según RLS; escritura solo en `meetings`, `meeting_participants`, `transcript_segments`, `minutes`, `documents`, `commitment_tracking` y `audit_logs` (solo `INSERT`) |
| `service_role` | Almacenamiento y `google_credentials` |

### El remoto ya está así

Hasta el 2026-11-26 no lo estaba: el volcado mostraba `GRANT ALL` para `anon` y
`authenticated` en las 28 tablas de `public` y del esquema archivado. Convenía
decir con precisión hasta dónde llegaba el riesgo:

- **Concedido en PostgreSQL**: sí, `TRUNCATE` incluido.
- **Alcanzable con la clave publicable**: no. PostgREST no tiene forma de
  expresar `TRUNCATE`, y el remoto no exponía ninguna función invocable.

No era una puerta abierta: era una puerta sin cerradura, aprovechable en cuanto
apareciera cualquier vía que ejecutara SQL con esos roles. La migración
`20261126031630` la cerró al aplicarse, y la comparación posterior de la matriz
de concesiones dio **27 sentencias `GRANT` a cada lado, idénticas**. La
corrección independiente
[`supabase/fixes/0001_revoke_truncate.sql`](../supabase/fixes/0001_revoke_truncate.sql)
quedó sin usar, y se conserva por si la exposición automática de una tabla nueva
volviera a traer el privilegio.

Se comprobó que el privilegio no hace falta: la aplicación no emite `TRUNCATE`
en ningún punto. Las únicas apariciones de esa palabra en el código son clases
CSS de Tailwind para recortar texto.

### La prueba que se dejó engañar

Probar el par corrección/reversión sobre la base local descubrió un falso
aprobado en la propia suite: los casos que intentan `TRUNCATE` sobre `meetings`
y `minutes` **pasaban igual con el privilegio concedido**, porque esas tablas
están referenciadas por claves foráneas y el `TRUNCATE` falla por eso. Solo el
de `audit_logs` —tabla sin referencias entrantes— delataba la debilidad.

Ahora hay dos casos que miran el privilegio en sí. Una prueba que pasa por el
motivo equivocado es peor que no tenerla, porque da tranquilidad sin darla.

## 8. Auditoría

`audit_logs` no admite `UPDATE` ni `DELETE`. Su política de inserción exige que
el actor sea quien firma la petición, que la institución sea la suya y que la
reunión le pertenezca. Las acciones `minutes.signed` y `minutes.reopened` solo
pueden nacer de funciones `SECURITY DEFINER`: no se pueden fabricar desde el
cliente.

Los metadatos guardan recuentos e identificadores, nunca contenido: ni
transcripciones, ni imágenes de firma, ni cuerpos de correo.

## 9. Límites honestos

- **La firma manuscrita digitalizada no es una firma electrónica
  cualificada ni certificada.** Es un trazo dibujado en pantalla guardado como
  PNG. No acredita identidad. Su valor depende de que la persona firme
  presencialmente y de las políticas de la institución.
- El límite de tasa de la aplicación es **por proceso**: con varias instancias
  el tope efectivo se multiplica.
- No hay Content Security Policy con nonces.
- Los textos de consentimiento y aceptación son borradores institucionales
  **pendientes de revisión jurídica**.
- **Todo lo descrito en esta página está vivo en las dos bases**, local y
  remota, desde el 2026-11-26. Detalle y verificaciones en
  [`SUPABASE_MIGRATION_HISTORY.md`](SUPABASE_MIGRATION_HISTORY.md).
- **La firma correcta no se ha ejercitado nunca contra el proyecto remoto.**
  Desde `signed` la única transición permitida es `sent`, y las guardas de
  finalización vigilan también el `DELETE`: una firma de prueba quedaría para
  siempre en la base de la institución y allí no hay forma de desactivar un
  disparador para retirarla. Contra el remoto se comprobó el **rechazo**, que no
  deja rastro; la firma correcta está demostrada sobre la base local, cuyo
  esquema y cuyos privilegios son idénticos. La primera firma real será la
  primera firma de verdad.
- La reproducibilidad de los bytes del PDF depende de que `@react-pdf/renderer`
  siga siendo determinista con la fecha fijada. Hay una prueba que lo
  comprueba sobre el archivo real, de modo que una actualización que lo rompa
  se vería; pero es una dependencia de terceros y conviene saberlo.
- El respaldo del proyecto remoto es manual
  (`scripts/backup-remote.mjs`): el plan gratuito no incluye respaldos
  automáticos con retención.

## 10. Datos de estudiantes

El audio nunca se persiste en el servidor. La transcripción, el acta y el
documento se conservan según la política de archivo de la institución, que
todavía no está implementada como borrado programado. Al tratarse de menores,
antes de cualquier uso real hacen falta acuerdos de encargo de tratamiento con
los proveedores externos y una evaluación de impacto. Detalle en
[`PRIVACY_CHECKLIST.md`](PRIVACY_CHECKLIST.md).
