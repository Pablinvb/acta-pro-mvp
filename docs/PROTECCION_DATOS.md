# Protección de datos: carpeta para el piloto institucional

> **Esto no es asesoría jurídica y no declara cumplimiento de nada.** Es el
> material preparado para que una persona con formación jurídica lo revise,
> corrija y decida. Donde hay una afirmación legal, está marcada como lo que
> es: una lectura que hay que confirmar. Donde falta una decisión, se dice que
> falta en lugar de rellenarla.
>
> Trata datos de **niñas, niños y adolescentes**. Eso sube el listón de todo lo
> que sigue y es la razón por la que ninguna de estas páginas basta por sí sola.

Complementa a [`PRIVACY_CHECKLIST.md`](PRIVACY_CHECKLIST.md), que recoge lo que
la aplicación ya hace. Aquí está lo que la **institución** tiene que decidir y
firmar antes de un piloto con personas reales.

---

## 1. Marco de referencia

El marco previsto es la **Ley Orgánica de Protección de Datos Personales** del
Ecuador y su reglamento, con la Superintendencia de Protección de Datos
Personales como autoridad de control.

Tres cosas de ese marco ordenan el resto, y conviene que un profesional
confirme cómo se aplican a este caso concreto:

- **Los datos de menores tienen protección reforzada.** El tratamiento se
  apoya, por regla general, en el consentimiento de quien ejerce la
  representación legal, y debe atender al interés superior del niño.
- **Los titulares tienen derechos exigibles** —acceso, rectificación,
  actualización, eliminación, oposición, portabilidad, suspensión— y la
  institución debe poder atenderlos en plazo.
- **Las transferencias internacionales** requieren una base válida. Todos los
  proveedores de esta aplicación están fuera del Ecuador (§4), de modo que
  **esto no es un detalle: es el punto que más atención necesita**.

## 2. Quién es quién

| Figura | Quién | Qué implica |
| --- | --- | --- |
| Titular | La o el estudiante; también quienes participan en la reunión | Es de quien son los datos y quien ejerce los derechos |
| Quien consiente | La representación legal del estudiante | Por tratarse de una persona menor de edad |
| Responsable del tratamiento | **La institución educativa** | Decide la finalidad y los medios; es quien responde |
| Encargado | Quien opere ACTA PRO por cuenta de la institución | Trata datos siguiendo instrucciones del responsable |
| Subencargados | Supabase, Netlify, Deepgram, Anthropic, Resend | Ver §4 |

> **Decisión pendiente.** Si la institución opera ACTA PRO por su cuenta, no hay
> encargado externo y la figura desaparece. Si lo opera un tercero, hace falta
> un contrato de encargo. Esto cambia quién firma qué y hay que resolverlo antes
> del piloto.

## 3. Base de licitud

Lo que se propone, a confirmar:

| Tratamiento | Base propuesta |
| --- | --- |
| Grabar el audio y transcribirlo | Consentimiento informado de la representación legal, recogido antes de grabar |
| Redactar y archivar el acta | Cumplimiento de la función educativa y conservación del expediente, por la obligación institucional de documentar el acompañamiento |
| Enviar el acta por correo | Consentimiento, o ejecución de la propia reunión |

La aplicación **ya impide grabar sin consentimiento registrado de todas las
personas participantes**: no es una casilla de la interfaz, es una condición que
comprueba la base de datos. Lo que no puede hacer la aplicación es decidir si la
base jurídica elegida es la correcta.

## 4. Proveedores que procesan datos

Esta tabla es el registro de subencargados. Hay que mantenerla al día: es lo
primero que pide una autoridad de control.

| Proveedor | Para qué | Qué datos recibe | Dónde | Conserva |
| --- | --- | --- | --- | --- |
| **Supabase** | Base de datos, autenticación y almacenamiento de los PDF | Todo el expediente: estudiantes, representantes, transcripciones, actas, firmas, auditoría | Infraestructura en AWS, región `sa-east-1` (São Paulo) | Mientras la institución lo conserve |
| **Netlify** | Servir la aplicación y ejecutar sus funciones | Datos en tránsito; registros de petición | Estados Unidos | Registros según su política |
| **Deepgram** | Transcripción automática del audio | **Audio de la reunión** y su transcripción | Estados Unidos | Se envía `MIP_OPT_OUT`; verificar qué implica en el contrato |
| **Anthropic** | Redacción del borrador del acta | **Transcripción** y datos de contexto de la reunión | Estados Unidos | Según su política de API |
| **Resend** | Envío del acta por correo | Correo de destino y el PDF adjunto | Estados Unidos | **No configurado hoy** |
| **Google Calendar** | Sincronización de reuniones, opcional | Título y fecha de la reunión | Estados Unidos | **Desconectado hoy** |

Dos consecuencias que conviene no suavizar:

- **El audio y la transcripción salen del país.** El audio va a Deepgram y la
  transcripción a Anthropic. Son datos de menores en contexto escolar. Esto
  necesita base válida de transferencia internacional y acuerdo de encargo con
  cada proveedor, firmado, antes del piloto.
- **La aplicación no persiste el audio** —se elimina en cuanto termina la
  transcripción, y así está configurado con `KEEP_AUDIO_AFTER_TRANSCRIPTION=false`—
  pero eso dice lo que hace ACTA PRO, no lo que hace el proveedor con la copia
  que recibió.

## 5. Conservación, eliminación y acceso

### Conservación

Plazos **propuestos**, a decidir por la institución. Hoy no hay borrado
programado: lo que se guarda, se queda.

| Dato | Plazo propuesto | Por qué |
| --- | --- | --- |
| Audio | **No se conserva** | Se elimina al terminar la transcripción; ya implementado |
| Transcripción | Hasta aprobar el acta, y un plazo corto después | Es el material de trabajo, no la evidencia |
| Acta aprobada y PDF firmado | El del expediente académico del estudiante | Es la evidencia institucional |
| Firmas (imágenes) | Igual que el acta a la que pertenecen | No tienen sentido separadas |
| Registro de auditoría | Igual o mayor que el acta | Si se borra antes, el acta pierde su respaldo |
| Cuentas del personal docente | Mientras dure el vínculo con la institución | |

> **Lo que falta para que esto sea una política y no una tabla:** quién decide
> los plazos, quién ejecuta el borrado, con qué periodicidad, y cómo se deja
> constancia de que se ejecutó.

### Eliminación

Hay una tensión real que conviene ver antes de prometer nada: **la auditoría no
admite borrado** y las actas firmadas están protegidas contra modificación y
contra `DELETE`. Eso es deliberado —una evidencia que se puede alterar no es
evidencia— y choca de frente con un derecho de eliminación ejercido sobre un
acta ya firmada.

No lo resuelve la técnica. Resolverlo es decidir, con criterio jurídico, qué
prevalece y en qué casos, y dejarlo escrito antes de que alguien lo pida.
Mientras tanto, lo honesto es decir que **hoy una solicitud de eliminación de un
acta firmada no se puede atender desde la aplicación**.

### Acceso

| Quién | A qué | Cómo se garantiza |
| --- | --- | --- |
| Docente | Solo sus propias reuniones | Políticas de la base, comprobado con dos instituciones ficticias |
| Administración de la institución | Todas las de su institución | Rol `admin`, comprobado |
| Otra institución | **Nada** | Comprobado por la API, no solo por la interfaz |
| Representantes y estudiantes | **No tienen acceso a la aplicación** | No existe ese rol hoy |

## 6. Derechos de los titulares

Procedimiento mínimo que la institución necesita tener escrito:

1. **Canal de recepción** —un correo institucional— publicado en el aviso de privacidad.
2. **Identificación** de quien solicita y de su legitimación, que para un menor
   es la representación legal.
3. **Plazo de respuesta**, conforme al que fije la normativa; confirmar el
   cómputo exacto con asesoría.
4. **Registro** de cada solicitud y de su respuesta.
5. **Vía de reclamación** ante la Superintendencia, indicada al titular.

Hoy **no existe** ese procedimiento, y atenderlo sería manual en todos los
casos. Es trabajo de la institución, no de la aplicación.

## 7. Evaluación de impacto

Por tratar datos de menores de forma sistemática, con transcripción automática
y elaboración de borradores por un modelo de lenguaje, lo previsible es que
**haga falta una evaluación de impacto antes del piloto**. Debería cubrir al
menos: las transferencias internacionales de §4, el riesgo de que el borrador
atribuya a alguien algo que no dijo, la conservación indefinida de §5 y la
tensión entre auditoría y derecho de eliminación.

Lo que la herramienta ya aporta a esa evaluación: el audio no se persiste, el
borrador no decide nada y lo revisa una persona, cada acta lleva huella
`SHA-256` verificable, la auditoría es infalsificable, y el aislamiento entre
instituciones está comprobado.

## 8. Brechas de seguridad

Conviene tener escrito, antes de necesitarlo: quién detecta, quién evalúa,
quién notifica a la autoridad y a las personas afectadas, y en qué plazo. La
normativa fija plazos breves. Hoy **no hay procedimiento de brechas**.

## 9. Lo que requiere revisión jurídica profesional

Sin ambigüedad, porque es el punto del documento:

1. **Los textos de consentimiento y de aceptación de firma** que la aplicación
   ya muestra y versiona (`src/lib/consent.ts`). Son borradores.
2. **La base de licitud** de cada tratamiento de §3.
3. **Las transferencias internacionales** y los acuerdos de encargo con
   Deepgram, Anthropic, Supabase, Netlify y Resend.
4. **Los plazos de conservación** de §5 y quién responde de ejecutarlos.
5. **La tensión entre el derecho de eliminación y la inmutabilidad de la
   evidencia**, que es la decisión más difícil de esta carpeta.
6. **La necesidad y el alcance de la evaluación de impacto.**
7. **El valor probatorio de la firma manuscrita digitalizada**, que es el asunto
   de [`SECURITY_HARDENING.md`](SECURITY_HARDENING.md) §9 y de
   [`FIRMAS_E_IDENTIDAD.md`](FIRMAS_E_IDENTIDAD.md).
8. **El procedimiento de derechos** de §6 y el de brechas de §8.

## 10. Lo que no se puede decir todavía

Que ACTA PRO cumple la LOPDP. No porque haya un incumplimiento conocido, sino
porque el cumplimiento no es una propiedad del software: depende de decisiones,
contratos y procedimientos de la institución que todavía no existen. La
herramienta está construida para facilitarlos —registro de consentimiento,
auditoría, aislamiento, minimización— y eso es distinto de haberlos tomado.
