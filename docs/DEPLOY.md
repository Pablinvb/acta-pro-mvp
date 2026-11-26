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
| Función sincrónica | **60 s** | **No** |
| Función programada | 30 s | No |
| Función en segundo plano | 15 min | No |
| Cuerpo de petición y respuesta | **6 MB** | No |
| Respuesta en flujo | 20 MB | No |
| Memoria | 1024 MB | Solo en Pro |

Un cuerpo binario va en base64, lo que añade cerca de un 30 %: el tope real para
subir un archivo es de unos **4,5 MB**.

Dos sitios de esta aplicación tocan esos límites, y los dos están resueltos:

**Generación del acta con Anthropic.** La ruta declara `maxDuration = 120`, que
en Netlify **no se concede**: la función muere a los 60 s. Peor aún, el SDK tenía
un plazo propio de 90 s y un reintento, de modo que la plataforma siempre ganaba
la carrera y quien usara la aplicación recibía un error de pasarela sin
explicación. Ahora el plazo se fija con `ANTHROPIC_TIMEOUT_MS` —45 s por
defecto, un único intento—, de manera que el que se rinde primero es el SDK y la
aplicación puede dar un mensaje legible. Si una transcripción muy larga no cabe
en ese plazo, la salida compatible con el plan gratuito es mover la generación a
una **función en segundo plano** (15 min) y que la interfaz consulte el
resultado; es un cambio de arquitectura y no se ha hecho.

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

## 6. Límites conocidos de esta versión en producción

| Límite | Efecto | Cuándo importa |
| --- | --- | --- |
| Función de 60 s en Netlify, no ampliable | Una transcripción muy larga puede no dar tiempo a generar el acta. El plazo del SDK se bajó a 45 s para que el mensaje de error sea legible | Reuniones largas; detalle y salida en §4.2 |
| Cuerpo de 6 MB, unos 4,5 MB en binario | La recuperación del acta desde el audio solo sirve para grabaciones de unos cuatro minutos | Solo en el plan B, cuando la transcripción en vivo no deja texto |
| Límite de tasa en memoria, por instancia | Con varias instancias el tope efectivo se multiplica | Antes de abrir la herramienta a toda una institución |
| Sin Content Security Policy con nonces | Menos defensa en profundidad ante XSS | Endurecimiento previo a uso institucional |
| Repositorio en memoria si Supabase cae | Con `DEMO_MODE=false` no se activa: la aplicación falla a la vista en lugar de inventar datos | Es el comportamiento buscado |
| Textos de consentimiento sin revisión jurídica | Van marcados como borrador institucional | Antes de usarlo con personas reales |

Detalle completo en [`PRIVACY_CHECKLIST.md`](PRIVACY_CHECKLIST.md).
