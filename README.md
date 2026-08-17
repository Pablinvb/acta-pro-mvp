# ACTA PRO

Convierte una reunión escolar grabada **con consentimiento** en un borrador de acta objetivo, editable, firmado y trazable.

> ACTA PRO produce **evidencia institucional trazable**. No otorga validez legal automática ni sustituye una firma electrónica cualificada. La validez del documento depende de las políticas de la institución y de la normativa aplicable.

Español de Ecuador · zona horaria `America/Guayaquil`.

---

## Qué hace

1. La docente abre una reunión con la ficha del estudiante y su representante.
2. Confirma quiénes están presentes.
3. Lee el aviso de tratamiento de datos y **registra el consentimiento de todas las personas**. Sin consentimiento, el micrófono no se habilita.
4. Graba desde el navegador con cronómetro, pausa y finalización. La transcripción llega en vivo, separada por hablante.
5. Asigna cada hablante detectado (`speaker_0`, `speaker_1`…) a una persona real.
6. La IA propone un borrador con temas, hechos, acuerdos, compromisos y seguimiento, cada uno enlazado a los segmentos de la transcripción que lo respaldan.
7. La docente revisa, corrige, acepta o rechaza sugerencias de lenguaje objetivo y **aprueba**. Hasta ese momento el acta es un `BORRADOR`.
8. Docente y representante firman en el mismo dispositivo.
9. El sistema genera el PDF, calcula su huella SHA-256, lo archiva en el repositorio y registra la auditoría.
10. El acta se envía al representante por correo, o se muestra una vista previa rotulada como simulación.
11. Los acuerdos y compromisos aprobados pasan al **tablero de seguimiento**, con su responsable y su fecha tal como constan en el acta. La docente marca su avance; el sistema no da nada por cumplido.

## Lo que el MVP **no** hace

| Área | Estado |
| --- | --- |
| Runachay | **No disponible.** No hay API oficial. El listado de estudiantes proviene de un proveedor simulado con datos ficticios. |
| Google Calendar | Opcional. Importa solo eventos marcados explícitamente para ACTA PRO. |
| Firma electrónica cualificada | Fuera de alcance. Lo que se recoge es una **firma manuscrita digitalizada**. |
| Identificación biométrica de voz | No existe. El sistema separa hablantes; la persona lo confirma. |
| Portal remoto del representante | Fuera de alcance. Ambas firmas se recogen en el mismo dispositivo. |
| Retención de audio | El audio **nunca** se guarda en el servidor: se transcribe y se descarta. |

---

## Arranque rápido (sin ninguna clave)

```bash
npm install
npm run dev
```

Abra <http://localhost:3000> e ingrese con las credenciales de demostración que aparecen en la propia pantalla:

- Correo: `ana.perez@demo.actapro.ec`
- Contraseña: `demo1234`

Con `DEMO_MODE=true` (valor por defecto) la aplicación arranca sin Supabase, Deepgram, Anthropic ni Resend. Cada simulación aparece **rotulada en la interfaz**: banda superior de «Modo demostración», insignias por integración y avisos en el propio borrador.

**Limitación conocida del modo demo:** sin Supabase los datos viven en la memoria del servidor. Reiniciar `next dev` devuelve el escenario a los datos semilla.

---

## Configuración con APIs reales

1. Copie el archivo de ejemplo:

```bash
cp .env.example .env.local
```

2. Complete las variables y compruebe el formato sin exponer valores:

```bash
npm run check:env
```

### Integraciones indispensables

| Servicio | Para qué | Variables |
| --- | --- | --- |
| Supabase | Autenticación, Postgres y almacenamiento privado de PDF | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| Deepgram | Transcripción en vivo y diarización | `DEEPGRAM_API_KEY` |
| Anthropic | Borrador estructurado del acta | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` |

### Integraciones opcionales

| Servicio | Para qué | Variables |
| --- | --- | --- |
| Resend | Envío real del acta | `RESEND_API_KEY`, `EMAIL_FROM` (dominio verificado) |
| Google Calendar | Importar reuniones programadas | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `TOKEN_ENCRYPTION_KEY` |

Genere la clave de cifrado de tokens (32 bytes en Base64):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Registre en Google Cloud exactamente estos URI de redirección:

- Desarrollo: `http://localhost:3000/api/integrations/google/callback`
- Producción: `https://SU-DOMINIO/api/integrations/google/callback`

Ponga `DEMO_MODE=false` **solo** cuando las tres integraciones indispensables estén configuradas. Si falta alguna, la aplicación dirige a `/settings/integrations` en lugar de continuar con simulaciones silenciosas.

---

## Base de datos

Con el proyecto de Supabase creado, ejecute en el editor SQL, en este orden:

1. `supabase/migrations/0001_init.sql` — tablas, índices, funciones y políticas de Row Level Security.
2. `supabase/migrations/0002_storage.sql` — bucket privado `acta-documents`.
3. `supabase/migrations/0003_commitment_tracking.sql` — tablero de seguimiento de acuerdos.
4. `supabase/seed.sql` — datos ficticios de demostración.

El archivo de semilla necesita que el usuario docente exista antes en `auth.users`. Créelo desde **Authentication → Add user** con el correo `ana.perez@demo.actapro.ec` y ajuste el identificador en `seed.sql` si Supabase asigna otro.

Con el CLI de Supabase:

```bash
supabase db push
supabase db execute --file supabase/seed.sql
```

---

## Comandos

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Compilación de producción |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript sin emitir |
| `npm test` | Pruebas unitarias y con mocks (Vitest) |
| `npm run test:coverage` | Cobertura de `src/lib` |
| `npm run test:e2e` | Prueba end-to-end del camino feliz (Playwright) |
| `npm run test:smoke` | Pruebas contra APIs reales; cada una se omite si falta su clave |
| `npm run check:env` | Presencia y formato de variables, sin imprimir valores |

La prueba end-to-end levanta su propio servidor en el puerto `3100` y necesita el navegador de Playwright:

```bash
npx playwright install chromium
```

---

## Estructura

```
src/
  app/
    (app)/                  páginas autenticadas: dashboard, reuniones, actas, seguimiento, integraciones
    api/                    rutas de servidor: Deepgram, Anthropic, PDF, correo, Google, salud
    login/                  autenticación
  components/               interfaz accesible reutilizable, marca e iconografía
  lib/
    anthropic/              prompt y generación validada del acta
    api/                    errores, límite de tasa y utilidades HTTP
    crypto/                 cifrado AES-256-GCM de tokens de terceros
    data/                   contrato de repositorio + implementaciones demo y Supabase
    deepgram/               streaming en vivo, pregrabado y normalización de segmentos
    demo/                   datos semilla y generador determinístico de demostración
    pdf/                    documento del acta, huellas y códigos
    schemas/                MinutesSchema y normalización
  proxy.ts                  refresco de sesión y bloqueo de configuración incompleta
supabase/                   migraciones, RLS y datos semilla
scripts/check-env.ts        verificación de entorno
tests/                      unit, mocks, smoke y end-to-end
docs/                       arquitectura, privacidad y guion de demostración
```

Más detalle en [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`docs/PRIVACY_CHECKLIST.md`](docs/PRIVACY_CHECKLIST.md) y [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md).

---

## Identidad visual

Tema oscuro institucional: azul marino profundo como fondo, azul eléctrico `#1F6FEB` como único acento de marca, verde reservado a lo verificado, ámbar a lo que exige revisión humana y rojo a la grabación en curso. Tipografía Inter. Los tokens viven en `src/app/globals.css` bajo `@theme`; los componentes no llevan colores literales.

Elementos propios de la identidad implementados como componentes:

- `LiveWaveform` — nivel de audio en tiempo real durante la grabación. Solo visualiza: lee un `AnalyserNode` y no graba ni envía nada.
- `StaticWaveform` — huella visual determinística de cada voz en la pantalla de hablantes. No reproduce audio, porque el audio no se conserva.
- `ProgressRing` — anillo de cumplimiento de acuerdos. Muestra `—` en lugar de `0 %` cuando todavía no hay compromisos.
- `FollowUpBoard` — tablero de responsables por semana, con avance en un clic.
- `LiveBadge` — indicador rojo pulsante de grabación en curso.

Todas las animaciones se desactivan con `prefers-reduced-motion`.

---

## Seguridad

- Ninguna clave de proveedor llega al navegador. Deepgram se usa desde el cliente con **tokens temporales** emitidos por el servidor.
- El bucket de documentos es privado; la descarga pasa por una ruta autenticada que comprueba la institución.
- Row Level Security en todas las tablas con datos institucionales.
- Los tokens de Google se guardan cifrados con AES-256-GCM.
- Los registros de consola no contienen transcripciones, firmas, correos ni secretos: solo recuentos e identificadores.
- La transcripción original es inmutable: las correcciones viven como versiones del acta.

## Despliegue

- Aplicación en Vercel; datos y archivos en Supabase.
- Configure las mismas variables de entorno en el proyecto de Vercel y actualice `NEXT_PUBLIC_APP_URL` y `GOOGLE_REDIRECT_URI` al dominio de producción.
- El límite de tasa es en memoria por proceso: para varias instancias sustitúyalo por un almacén compartido antes de un uso institucional real.
