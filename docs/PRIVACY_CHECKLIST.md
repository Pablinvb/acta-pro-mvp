# Lista de verificación de privacidad

Se trata de reuniones escolares en las que se habla de **menores de edad**. Esta lista describe qué hace hoy el MVP y qué queda pendiente antes de cualquier uso con personas reales.

> Los textos de consentimiento y aceptación son **borradores institucionales sujetos a revisión jurídica**. ACTA PRO no otorga validez legal automática.

---

## 1. Datos personales tratados

| Dato | Origen | Dónde vive | Cuánto dura |
| --- | --- | --- | --- |
| Audio de la reunión | Micrófono del navegador | En tránsito hacia el proveedor de transcripción y en memoria del navegador | **Nunca se guarda en el servidor.** Se descarta al terminar la petición |
| Transcripción con hablantes | Deepgram | `transcript_segments` | Según la política de archivo de la institución |
| Nombres y roles de participantes | Datos institucionales | `meeting_participants` | Ídem |
| Registro de consentimiento | Formulario | `meeting_participants` | Ídem |
| Borrador y acta aprobada | Anthropic + edición humana | `minutes` | Ídem |
| Firma manuscrita digitalizada | Canvas | `signatures` (PNG en data URL) | Ídem |
| PDF firmado | Servidor | Bucket privado `acta-documents` | Ídem |
| Rastro de auditoría | Aplicación | `audit_logs` | Ídem |

**No se tratan** datos de salud, diagnósticos ni categorías especiales. El prompt del sistema prohíbe explícitamente diagnosticar.

---

## 2. Consentimiento

- [x] Aviso previo con finalidad, datos tratados, responsable, encargados y destinatarios, conservación, decisiones automatizadas y derechos.
- [x] El micrófono permanece **bloqueado** hasta que todas las personas presentes acepten. Se verifica en la interfaz y otra vez en el servidor, en `/api/meetings/[id]/recording` y en `/api/integrations/deepgram/token`.
- [x] Se guarda `consent_status`, `consent_at` y `consent_text_version` por persona.
- [x] La negativa no impide la reunión: la interfaz lo dice y ofrece continuar sin grabación.
- [x] Casilla adicional que confirma que el aviso se leyó en voz alta.
- [ ] **Pendiente:** retirar el consentimiento a mitad de la reunión desde la propia pantalla de grabación.
- [ ] **Pendiente:** consentimiento del representante legal recogido por separado del asentimiento del estudiante.

---

## 3. Minimización

- [x] El audio no se persiste en ningún momento del lado del servidor.
- [x] Google Calendar importa **solo** eventos marcados con el prefijo `ACTA PRO:` o la propiedad privada `actaPro=true`. No se copian descripciones ni eventos personales.
- [x] Alcance de Google restringido a `calendar.events.readonly`.
- [x] El esquema JSON enviado a Anthropic no contiene datos personales en nombres, enums ni descripciones.
- [x] La ficha del estudiante muestra solo lo necesario para identificar la reunión.
- [ ] **Pendiente:** política de conservación configurable con borrado programado de transcripciones.

---

## 4. Secretos y credenciales

- [x] Ninguna clave de proveedor llega al navegador.
- [x] Deepgram se usa desde el cliente mediante **tokens temporales** (`/v1/auth/grant`), con TTL configurable.
- [x] La service role key de Supabase solo se usa en el servidor, y únicamente para el bucket privado y las credenciales de Google.
- [x] Tokens de Google cifrados con AES-256-GCM antes de guardarse.
- [x] `state` de OAuth firmado, atado a la sesión y con caducidad de 10 minutos.
- [x] `.gitignore` excluye `.env*` (salvo `.env.example`), `credentials.json`, archivos de token y claves.
- [x] `npm run check:env` comprueba presencia y formato **sin imprimir valores**.

---

## 5. Registros

- [x] No se registran transcripciones, firmas, contenido de correos ni secretos.
- [x] El error no controlado registra el **tipo** de error, no su mensaje: un mensaje puede arrastrar contenido de la reunión.
- [x] La emisión de un token registra `meetingId`, `userId` y fecha; nunca el token.
- [x] `audit_logs.metadata_json` guarda recuentos e identificadores.
- [x] Las respuestas de error no exponen mensajes de los proveedores externos.

---

## 6. Control de acceso

- [x] Row Level Security en todas las tablas con datos institucionales.
- [x] Acceso resuelto por institución del perfil, y por titularidad o rol de administración para cada reunión.
- [x] `google_credentials` sin ninguna política: inaccesible desde el cliente.
- [x] Una reunión de otra institución responde **404**, no 403: un 403 confirmaría que el registro existe.
- [x] Bucket de documentos privado; la descarga pasa por una ruta autenticada.
- [x] `transcript_segments` sin política de `UPDATE`: la transcripción original es inmutable.

---

## 7. Transparencia sobre la automatización

- [x] El acta permanece como `BORRADOR` hasta la aprobación humana; el PDF sin aprobar lleva una banda visible.
- [x] Se indica qué modelo generó el borrador, o si provino del generador de demostración.
- [x] Cada tema, hecho, acuerdo, compromiso y seguimiento enlaza con sus segmentos de origen.
- [x] Las contradicciones se registran sin decidir quién tiene razón.
- [x] Las sugerencias de lenguaje objetivo se presentan como propuestas; aceptarlas **no** modifica la transcripción.
- [x] Nunca se afirma que el sistema reconoce voces biométricamente.
- [x] Toda simulación aparece rotulada: banda de modo demostración, insignias por integración y aviso en el borrador.

---

## 8. Antes de usarlo con personas reales

1. Revisión jurídica de los textos de consentimiento y aceptación conforme a la normativa ecuatoriana de protección de datos.
2. Acuerdos de encargo de tratamiento con Deepgram, Anthropic y el proveedor de correo.
3. Política institucional de conservación y borrado, con responsable designado.
4. Procedimiento documentado para atender derechos de acceso, rectificación y eliminación.
5. Evaluación de impacto, por tratarse de datos de menores.
6. Límite de tasa distribuido y protección anti-abuso en las rutas de IA.
7. Content Security Policy con nonces.
8. Formación al personal docente: la herramienta reduce omisiones, **no** sustituye el criterio profesional.
