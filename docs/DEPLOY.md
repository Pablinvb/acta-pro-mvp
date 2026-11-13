# Despliegue en producción

> **GitHub Pages no sirve para este proyecto.** Pages publica solo archivos
> estáticos y ACTA PRO necesita 17 rutas de servidor (token de Deepgram,
> generación del acta, PDF, huella, descarga firmada, correo). Llevar esas
> llamadas al navegador obligaría a publicar las claves dentro del JavaScript
> del sitio, en un repositorio público. No se hace.

Destino: **Vercel** para la aplicación y **Supabase** para datos y archivos.

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

En **SQL Editor**, pegue y ejecute **en este orden**:

1. `supabase/migrations/0001_init.sql`
2. `supabase/migrations/0002_storage.sql`
3. `supabase/migrations/0003_commitment_tracking.sql`
4. `supabase/seed.sql`

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

## 4. Vercel

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

```bash
curl -s https://SU-DOMINIO.vercel.app/api/health/integrations
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
**El micrófono exige HTTPS**, que Vercel ya proporciona.

---

## 6. Límites conocidos de esta versión en producción

| Límite | Efecto | Cuándo importa |
| --- | --- | --- |
| Límite de tasa en memoria, por instancia | Con varias instancias el tope efectivo se multiplica | Antes de abrir la herramienta a toda una institución |
| Sin Content Security Policy con nonces | Menos defensa en profundidad ante XSS | Endurecimiento previo a uso institucional |
| Repositorio en memoria si Supabase cae | Con `DEMO_MODE=false` no se activa: la aplicación falla a la vista en lugar de inventar datos | Es el comportamiento buscado |
| Textos de consentimiento sin revisión jurídica | Van marcados como borrador institucional | Antes de usarlo con personas reales |

Detalle completo en [`PRIVACY_CHECKLIST.md`](PRIVACY_CHECKLIST.md).
