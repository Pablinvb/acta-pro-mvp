# Despliegue en producción

> **GitHub Pages no sirve para este proyecto.** Pages publica solo archivos
> estáticos y ACTA PRO necesita 17 rutas de servidor (token de Deepgram,
> generación del acta, PDF, huella, descarga firmada, correo). Llevar esas
> llamadas al navegador obligaría a publicar las claves dentro del JavaScript
> del sitio, en un repositorio público. No se hace.

Destino: **Netlify** (plan gratuito) para la aplicación y **Supabase** para datos
y archivos. La ruta de Vercel se conserva al final como alternativa, porque
sigue siendo válida.

---

## 1. Supabase

### 1.1 Crear el proyecto

1. En <https://supabase.com/dashboard> cree un proyecto nuevo.
2. Elija una región cercana (`South America (São Paulo)` para Ecuador).
3. Guarde la contraseña de la base de datos cuando se la muestre: no se repite.

> Si ya tenía un proyecto y la aplicación dice «Supabase no responde», lo más
> probable es que esté **pausado** por inactividad o borrado. Compruébelo así:
>
> ```bash
> nslookup SU-REFERENCIA.supabase.co
> ```
>
> Si responde «Non-existent domain», el proyecto ya no existe y hay que crearlo
> de nuevo. Reanudar un proyecto pausado se hace desde el propio panel.

### 1.2 Ejecutar el esquema

> **Si va a usar el proyecto `lmscltbyehofrwtddbfn`, este paso ya está hecho.**
> Sus nueve migraciones se aplicaron el 2026-11-26 y están verificadas; detalle
> en [`SUPABASE_MIGRATION_HISTORY.md`](SUPABASE_MIGRATION_HISTORY.md). Pase al
> paso 1.4.

Para un proyecto nuevo, el esquema **no se pega a mano en el SQL Editor**: son
nueve migraciones y el orden importa. Enlace el proyecto y aplique el historial:

```bash
node node_modules/supabase/dist/supabase.js link --project-ref SU-REFERENCIA
```

```bash
node node_modules/supabase/dist/supabase.js migration up --remote
```

Con `migration up`, **no con `db push`**: `db push` compara esquemas y puede
generar sentencias no previstas; `migration up` aplica los archivos en orden,
los mismos que se han probado.

Los datos de demostración van después, y en este orden: **primero** la cuenta de
autenticación del paso 1.3, **luego** `supabase/seed.sql` pegado en el SQL
Editor. El seed **no es autosuficiente** —necesita que esa cuenta exista— y su
propio encabezado da la sentencia exacta que hace falta.

### 1.3 Crear la cuenta docente

`seed.sql` inserta el perfil, pero el usuario de autenticación se crea aparte:

1. **Authentication → Users → Add user**.
2. Correo `ana.perez@demo.actapro.ec`, contraseña a su elección, y marque
   **Auto Confirm User**.
3. Copie el `User UID` que Supabase asigne.
4. Si ese UID no coincide con el del seed, alinéelos en SQL Editor:

```sql
update public.profiles
set id = 'EL-UID-QUE-COPIO'
where email = 'ana.perez@demo.actapro.ec';
```

### 1.4 Copiar las credenciales

**Settings → API**: la *Project URL*, la clave *publishable* (anon) y la
*service_role*. Esta última nunca sale del servidor.

---

## 2. Deepgram

Cree la clave en <https://console.deepgram.com> → **API Keys**.

**Importante:** la transcripción **en vivo** necesita que la clave pueda emitir
tokens temporales (`POST /v1/auth/grant`). Una clave con permisos reducidos
autentica correctamente contra `/v1/listen` pero devuelve
`403 Insufficient permissions` al pedir un token, y entonces la vista en vivo se
deshabilita sola. Para evitarlo, cree la clave con rol **Owner** o **Admin** del
proyecto.

Compruébelo antes de desplegar:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://api.deepgram.com/v1/auth/grant -H "authorization: Token SU_CLAVE" -H "content-type: application/json" -d "{\"ttl_seconds\":60}"
```

`200` es correcto. `403` significa que falta permiso: la grabación seguirá
funcionando, pero sin transcripción en vivo.

---

## 3. Anthropic

Cree la clave en <https://console.anthropic.com> → **API Keys** y deje
`ANTHROPIC_MODEL=claude-sonnet-5`.

Sin esta clave la aplicación **no deja de funcionar**, pero el acta la produce el
generador determinístico y sale rotulada como «Borrador de demostración». Para
un acta real es obligatoria.

---

## 4. Netlify

Proyecto: **`acta-pro`** · <https://acta-pro.netlify.app> · equipo `ED Pulse 360`
(plan **Free**).

### 4.1 Lo que Next.js 16 necesita de Netlify: nada

Netlify detecta Next.js y aplica su adaptador OpenNext sin configuración. Next 16
está soportado y no exige nada distinto de la 15. **No se instala
`@netlify/plugin-nextjs` ni se fija su versión**: la propia documentación de
Netlify recomienda no fijarla, porque el adaptador se prueba con cada versión de
Next y fijarlo deja el sitio atrás. El `proxy.ts` de este proyecto —el
`middleware.ts` de antes, renombrado en Next 16— se publica como Edge Function.

`netlify.toml` existe solo para fijar la versión de Node, declarar el comando de
construcción, añadir cuatro cabeceras de seguridad y eximir del rastreo de
secretos las variables que son públicas por definición. Cada línea lleva su
motivo escrito al lado.

### 4.2 Los límites del plan gratuito, y dónde aprietan

Cifras de la documentación de Netlify, no estimadas:

| Límite | Valor | Configurable |
| --- | --- | --- |
| Función sincrónica | **30 s medidos** (la documentación dice 60) | **No** |
| Función programada | 30 s | No |
| Función en segundo plano | 15 min | No |
| Cuerpo de petición y respuesta | **6 MB** | No |
| Respuesta en flujo | 20 MB | No |
| Memoria | 1024 MB | Solo en Pro |

Un cuerpo binario va en base64, lo que añade cerca de un 30 %: el tope real para
subir un archivo es de unos **4,5 MB**.

Dos sitios de esta aplicación tocan esos límites, y los dos están resueltos:

**Generación del acta con Anthropic.** Es el punto donde más apretaba, y costó
dos vueltas acertar. Detalle completo en §5 ter; en resumen:

- El límite real **no son 60 s sino 30**. Lo dice el registro de la función sin
  ambigüedad: `Duration: 30000 ms`, clavado. La tabla de valores por defecto de
  Netlify documenta 60 y en este proyecto no se cumplen.
- La causa de fondo no era el plazo sino el **razonamiento extendido**, que estos
  modelos traen activado por defecto. Una transcripción de 229 palabras tardaba
  **49 s**. Desactivarlo la deja en **18 s**, y una reunión realista de 22
  minutos y 2080 palabras, en **21,7 s**.
- `ANTHROPIC_TIMEOUT_MS` vale ahora **24 s**, por debajo de los 30 de la
  plataforma, de modo que el que se rinde primero es el SDK y la aplicación
  responde «superó el tiempo de espera» en vez de morir con un 502 de pasarela.

Queda un margen estrecho y conviene saberlo: una reunión bastante más larga que
22 minutos puede no caber en 24 s. En ese caso la respuesta es un error legible y
reintentable, no una caída. La salida compatible con el plan gratuito, si llega a
hacer falta, es mover la generación a una **función en segundo plano** (15 min)
con la interfaz consultando el resultado; es un cambio de arquitectura y no se ha
hecho.

**Recuperación de la transcripción desde el audio.** El camino normal no manda
audio a ningún servidor propio: el navegador habla con Deepgram directamente con
un token temporal. Pero el plan B, cuando la transcripción en vivo no deja ni una
intervención, sube la grabación completa a `/api/transcriptions/recover`. A unos
**1 MB por minuto** de webm, el tope de 4,5 MB son unos **cuatro minutos**: para
una reunión de media hora, esa vía no sirve en este plan. El navegador ahora lo
comprueba antes de enviar y lo dice con claridad, en lugar de provocar un error
de red sin causa aparente. La salida compatible, para cuando haga falta: que el
navegador suba el audio **a Supabase Storage** y la función pase a Deepgram una
URL firmada, de modo que el archivo no atraviese la función. Necesita una
política de almacenamiento nueva y tampoco se ha hecho.

Lo que **no** es problema: el PDF. Pesa unos 29 KB, se genera en bastante menos
de 60 s y la descarga va muy por debajo del tope de respuesta.

### 4.3 Enlazar el proyecto y configurar el entorno

```powershell
netlify login
```

```powershell
netlify link
```

Las variables se cargan del archivo local, sin pasar por el portapapeles ni por
la pantalla:

```powershell
netlify env:import .env.local
```

Después hay que corregir las dos que apuntaban a la máquina de desarrollo:

```powershell
netlify env:set NEXT_PUBLIC_APP_URL https://acta-pro.netlify.app
```

```powershell
netlify env:set GOOGLE_REDIRECT_URI https://acta-pro.netlify.app/api/integrations/google/callback
```

> `NEXT_PUBLIC_APP_URL` se incrusta en el código **durante la construcción**, de
> modo que cambiarla exige volver a desplegar, no solo guardarla.

> Si va a usar Google Calendar, registre esa misma URI de retorno en Google
> Cloud. Sin ese registro el enlace con el calendario falla, pero el resto de la
> aplicación no se entera.

`DEMO_MODE` se queda en **`false`**. Es deliberado: sin eso, un fallo de Supabase
haría que la aplicación continuara con datos ficticios, y un acta de
demostración no debe parecerse nunca al expediente de un estudiante real.

### 4.4 Construir en Linux, no en Windows

```powershell
netlify deploy --build
```

En Windows ese comando **falla** si la cuenta no tiene privilegio para crear
enlaces simbólicos:

```
EPERM: symlink ... .next\standalone\node_modules\@react-pdf\renderer
```

No es un problema de la aplicación ni de Netlify: el adaptador de Next enlaza el
código del servidor y Windows lo prohíbe salvo con modo de desarrollador o con
permisos de administrador. Hay dos salidas:

1. **Que construya Netlify.** Conecte el repositorio en el panel del proyecto;
   sus servidores son Linux. Es la opción duradera y además da despliegue
   continuo. Requiere autorizar la aplicación de GitHub de Netlify una vez.
2. **Construir en un contenedor Linux**, que es lo que se hizo aquí:

```powershell
docker run -d --name acta-build -e NETLIFY_AUTH_TOKEN -e NETLIFY_SITE_ID node:22 sleep infinity
```

Se copia el código dentro del contenedor —no como volumen montado, porque la
escritura seguiría cayendo en el sistema de archivos de Windows—, y allí se
ejecuta `npm ci` y `netlify deploy --build`.

### 4.5 Acceso restringido en el plan gratuito

**La protección por contraseña no está en el plan gratuito**; es de Pro. Lo que
sí está es hacer el proyecto **privado**: en Free, un proyecto privado es visible
**solo para la persona propietaria del equipo**, con el inicio de sesión de
Netlify por delante.

Eso es lo que se usa para la validación inicial. Conviene saber qué cubre y qué
no: la aplicación ya exige sesión de Supabase para cualquier dato, de modo que
sin credenciales no se lee nada aunque la URL se conozca. El proyecto privado
añade una puerta antes incluso de llegar a la aplicación.

### 4.6 Comprobación tras desplegar

```powershell
node scripts/verify-deployment.mjs https://acta-pro.netlify.app
```

Comprueba que la aplicación responde, que las funciones se ejecutan, que las
integraciones están configuradas, que las rutas privadas rechazan a quien no ha
entrado, que las cabeceras de seguridad llegan, y descarga el paquete de
JavaScript del navegador para buscar dentro **cada clave privada**. Esa última es
la que importa: si alguna apareciera, el guion lo dice por su nombre y falla.

Netlify, además, rastrea por su cuenta el resultado de la construcción buscando
los valores de las variables de entorno y **falla el despliegue** si encuentra
alguno. Esa red se conserva a propósito: en `netlify.toml` solo se eximen las
variables `NEXT_PUBLIC_*`, que Next incrusta por diseño. Ninguna clave privada
está eximida, y si el rastreo señalara una, es un fallo real y no algo que
silenciar añadiéndola a la lista.

## 4 bis. Vercel (alternativa)

1. Entre en <https://vercel.com/new> con su cuenta de GitHub.
2. Importe el repositorio **`Pablinvb/acta-pro-mvp`**.
3. Vercel detecta Next.js solo: no cambie el framework, el comando de build ni
   el directorio de salida.
4. Antes de pulsar **Deploy**, abra **Environment Variables** y añada:

| Variable | Valor |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL de Supabase |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | clave publicable (anon) |
| `SUPABASE_SERVICE_ROLE_KEY` | clave service_role |
| `DEEPGRAM_API_KEY` | su clave de Deepgram |
| `NEXT_PUBLIC_DEEPGRAM_MODEL` | `nova-3` |
| `NEXT_PUBLIC_DEEPGRAM_LANGUAGE` | `es-419` |
| `DEEPGRAM_DIARIZE_MODEL` | `latest` |
| `DEEPGRAM_TOKEN_TTL_SECONDS` | `3600` |
| `DEEPGRAM_MIP_OPT_OUT` | `true` |
| `ANTHROPIC_API_KEY` | su clave de Anthropic |
| `ANTHROPIC_MODEL` | `claude-sonnet-5` |
| `DEMO_MODE` | `false` |
| `DEMO_KEEP_AUDIO` | `false` |
| `KEEP_AUDIO_AFTER_TRANSCRIPTION` | `false` |
| `NEXT_PUBLIC_APP_URL` | se completa tras el primer despliegue |

Opcionales, solo si va a usar correo o calendario:
`RESEND_API_KEY`, `EMAIL_FROM`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`GOOGLE_REDIRECT_URI`, `TOKEN_ENCRYPTION_KEY`.

5. **Deploy**.
6. Cuando termine, copie el dominio asignado y vuelva a Environment Variables
   para poner `NEXT_PUBLIC_APP_URL=https://SU-DOMINIO.vercel.app`. Si usa Google
   Calendar, ajuste también `GOOGLE_REDIRECT_URI` al mismo dominio y regístrelo
   en Google Cloud. Luego **Redeploy**.

> `DEMO_MODE=false` es deliberado en producción: sin él, un fallo de Supabase
> haría que la aplicación continuara con datos ficticios, y un acta de
> demostración no debe parecerse nunca al expediente de un estudiante real.

---

## 5. Comprobación tras desplegar

```powershell
curl.exe -s https://acta-pro.netlify.app/api/health/integrations
```

Debe responder:

```json
{"supabase":"configured","deepgram":"configured","anthropic":"configured","resend":"missing","googleCalendar":"disconnected"}
```

- `"supabase":"unreachable"` → el proyecto está pausado, borrado o la URL tiene
  una errata.
- `"anthropic":"missing"` → el acta saldrá como borrador de demostración.

Después, en el navegador: entre con la cuenta creada en el paso 1.3, abra la
reunión semilla, confirme participantes, registre el consentimiento y grabe.
**El micrófono exige HTTPS**, que Netlify ya proporciona.

---

## 5 bis. El error que apareció al desplegar, y por qué ninguna prueba lo vio

Al abrir la aplicación desplegada, el panel respondía:

> This page couldn't load. A server error occurred. Reload to try again.

No era la protección de Netlify —esa devuelve **401**— ni el adaptador, ni las
cookies, ni Node. Era un **500** de Next con un `digest`, y el registro de la
función dio la causa literal:

```
Error: No se pudo leer el repositorio: Could not embed because more than one
relationship was found for 'meetings' and 'students'
    at Object.listDocuments                               digest 1673923183

Error: No se pudo leer el seguimiento: Could not embed because more than one
relationship was found for 'meetings' and 'students'
    at Object.listCommitments                             digest 2034472494
```

### La causa

La migración `20261125212938_document_and_meeting_integrity` añadió claves
foráneas compuestas por institución. A partir de ella hay **dos** caminos de
`meetings` a `students`:

| Clave | Columnas |
| --- | --- |
| `meetings_student_id_fkey` | `(student_id) → students(id)` |
| `meetings_student_institution_fk` | `(student_id, institution_id) → students(id, institution_id)` |

La segunda es la que impide que una reunión apunte a un estudiante de otra
institución: es deseable y se queda. Pero PostgREST no elige entre dos caminos:
ante `students!inner(*)` responde **`300 Multiple Choices`**, y la página que
hace esa consulta se cae.

Conviene decirlo con precisión: **no fue un fallo de Netlify.** Reproducido
contra la base local, el error es idéntico, con el mismo HTTP 300. El despliegue
solo lo puso a la vista. Y el error se devuelve al analizar la consulta, antes de
RLS, así que aparecía incluso sin sesión.

El esquema tiene tres pares con esta ambigüedad —`meetings → students`,
`meetings → profiles` y `documents → minutes`—, pero solo el primero lo
atravesaba alguna consulta.

### La corrección

Nombrar la clave foránea en la consulta, que es lo que PostgREST pide para
desambiguar, sin renunciar a la restricción:

```
*, meetings!inner(*, students!meetings_student_id_fkey!inner(*))
```

El nombre vive en una sola constante, `MEETING_STUDENT_FK`, con el motivo
escrito al lado. Se usa la clave simple y no la compuesta porque es la relación
que la consulta quiere decir; el resultado es el mismo, porque la compuesta
garantiza la coincidencia de institución en toda fila.

### Por qué ninguna prueba lo detectó

Esta es la parte que importa más que el arreglo. **Ninguna prueba llamaba a
`listDocuments` ni a `listCommitments` contra una base de datos.** Las 33 de
integración cubrían almacenamiento, rutas de documentos y permisos de la API; y
las 16 contra el proyecto remoto, las rutas de documentos. Estas dos consultas
no las ejecutaba nada.

Un esquema que cambia puede romper una consulta **sin que se toque una línea de
código**, de modo que el tipado y las pruebas unitarias no pueden verlo: la
consulta es una cadena que solo se valida cuando PostgREST la recibe. Por eso la
corrección trae
[`tests/integration/repository-queries.test.ts`](../tests/integration/repository-queries.test.ts):
seis casos que ejecutan las tres consultas con incrustación que existen en el
repositorio, con datos de verdad, y comprueban que el estudiante incrustado
llega. Si una migración futura añade otro camino entre dos tablas incrustadas,
falla ahí y no en producción.

## 5 ter. «No se pudo generar el borrador»: tres fallos, no uno

Al pulsar «Generar borrador con IA» en la aplicación desplegada, la respuesta no
venía de la aplicación:

```
HTTP 502   {"errorType":"Error","errorMessage":"An unknown error has occurred"}
```

Ese es el sobre de error de la propia plataforma, no el de ACTA PRO. La
aplicación nunca llegó a responder. El registro de la función dijo por qué:

```
Duration: 30000 ms      Memory Usage: 212 MB
```

Exactamente 30.000 ms: un corte, no un fallo. Detrás había tres problemas
distintos, y hacía falta arreglar los tres.

### Primero: el límite real es de 30 s, no de 60

La documentación de Netlify da 60 s como límite de una función sincrónica. **En
este proyecto son 30**, medidos. Por eso el plazo de 45 s que se había puesto
antes no servía de nada: la plataforma mataba la función mucho antes de que el
SDK se rindiera, y lo que llegaba al navegador era un error de pasarela sin
explicación posible —cuando la función muere, no queda nadie para registrar nada—.

`ANTHROPIC_TIMEOUT_MS` vale ahora **24 s**, con margen para la sesión, las
lecturas y la escritura posterior dentro de la ventana de 30.

### Segundo: el razonamiento extendido estaba haciendo el trabajo lento

Bajar el plazo solo convierte una caída en un mensaje; no hace que el acta se
genere. La causa real es que estos modelos traen el **razonamiento extendido
activado por defecto**, y sus tokens salen del mismo presupuesto y del mismo
reloj. Medido con el guion
[`scripts/diagnose-generation.ts`](../scripts/diagnose-generation.ts), que
cronometra la generación donde nada la interrumpe:

| Configuración | Transcripción | Resultado |
| --- | --- | --- |
| Por defecto, tope 6000 | 229 palabras | **49,0 s** |
| Por defecto, tope 2000 | 229 palabras | **falla a los 22 s**: agota los tokens pensando |
| **Sin razonamiento, tope 6000** | 229 palabras | **18,1 s** |
| **Sin razonamiento, tope 6000** | 2080 palabras · 22 min | **21,7 s** |

Aquí no hace falta deliberar. Lo que se pide es redactar a partir de una
transcripción con un esquema fijo, y el acta la revisa y aprueba una persona.
Desactivarlo no deja al modelo sin control: la salida sigue restringida por el
esquema y la comprobación de identificadores huérfanos sigue rechazando
cualquier cita que no esté en la transcripción.

### Tercero: el mensaje de error mentía

```ts
if (error instanceof Anthropic.APIError) { ... }
if (error instanceof Anthropic.APIConnectionTimeoutError) { ... }  // inalcanzable
```

`APIConnectionTimeoutError` **hereda** de `APIError`, de modo que la primera
comprobación atrapaba también los plazos agotados y salía por su rama genérica:
«El servicio de IA rechazó la solicitud». Es decirle a quien usa la aplicación
que revise la clave cuando lo que pasó fue que no dio tiempo. La comprobación
del plazo va ahora delante, y un plazo agotado responde **504 «La generación del
borrador superó el tiempo de espera»**.

### Lo que no estaba roto

Conviene decirlo porque se comprobó una por una: la clave de Anthropic es
válida, el modelo configurado existe, **hay saldo** —una llamada mínima responde
en 0,8 s—, la salida estructurada funciona, el JSON valida contra el esquema, y
un fallo de generación **no bloquea la reunión**: el cambio a `draft` ocurre
después de crear el acta, de modo que la reunión se queda en `processing` y se
puede reintentar. Se verificó reintentando.

## 6. Límites conocidos de esta versión en producción

| Límite | Efecto | Cuándo importa |
| --- | --- | --- |
| Función de **30 s** en Netlify, no ampliable | Una reunión bastante más larga que 22 minutos puede no dar tiempo a generar el acta. El plazo del SDK está en 24 s para que el error sea legible y reintentable | Reuniones largas; detalle y medidas en §5 ter |
| Cuerpo de 6 MB, unos 4,5 MB en binario | La recuperación del acta desde el audio solo sirve para grabaciones de unos cuatro minutos | Solo en el plan B, cuando la transcripción en vivo no deja texto |
| Límite de tasa en memoria, por instancia | Con varias instancias el tope efectivo se multiplica | Antes de abrir la herramienta a toda una institución |
| Sin Content Security Policy con nonces | Menos defensa en profundidad ante XSS | Endurecimiento previo a uso institucional |
| Repositorio en memoria si Supabase cae | Con `DEMO_MODE=false` no se activa: la aplicación falla a la vista en lugar de inventar datos | Es el comportamiento buscado |
| Textos de consentimiento sin revisión jurídica | Van marcados como borrador institucional | Antes de usarlo con personas reales |

Detalle completo en [`PRIVACY_CHECKLIST.md`](PRIVACY_CHECKLIST.md).

## Trabajos, audio y verificación de firmas

La versión de la rama de endurecimiento utiliza dos funciones de Netlify. El navegador autenticado despacha `minutes-background` con una autorización para un único trabajo. La base reserva el trabajo antes de invocar a Anthropic. La huella combina los metadatos de redacción, los participantes y la transcripción numerada. Las solicitudes idénticas de una reunión comparten el trabajo. El resultado se guarda antes de crear el acta y el evento de auditoría en una transacción.

`recover-jobs` revisa la cola cada diez minutos en despliegues publicados. Recupera reservas abandonadas, finaliza respuestas guardadas y elimina cargas caducadas. Ante una respuesta incierta de un proveedor de pago, el trabajo requiere revisión para evitar un segundo cargo. Los límites por cuenta y operación se aplican en Postgres. La recuperación de audio envía ficheros mayores de 4 MB directamente al bucket privado, hasta 50 MiB. Deepgram recibe una URL de lectura válida durante cinco minutos.

Para las firmas nuevas se requiere una sesión del docente responsable, su contraseña y un código enviado al correo registrado del representante participante. El código caduca a los diez minutos, admite cinco intentos y se consume una vez. Configure `RESEND_API_KEY` y `EMAIL_FROM` en el entorno de Functions y verifique el dominio en Resend. El ensayo de integración sustituye el transporte de correo y comprueba la reautenticación real contra Supabase local.

El ensayo de duración se ejecuta con `node --env-file=.env.local --import tsx scripts/benchmark-generation.ts`. Consume cuatro solicitudes al proveedor con transcripciones sintéticas repetibles.
