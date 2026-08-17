/**
 * Textos versionados de consentimiento y de aceptación de firma.
 *
 * Son BORRADORES INSTITUCIONALES sujetos a revisión jurídica. ACTA PRO no
 * declara validez legal automática: guarda qué versión de texto leyó cada
 * persona y cuándo, para que la institución pueda auditarlo.
 */

export const CONSENT_TEXT_VERSION = "consentimiento-v1-2026-08";
export const ACCEPTANCE_TEXT_VERSION = "aceptacion-firma-v1-2026-08";

export interface ConsentSection {
  heading: string;
  body: string;
}

export const CONSENT_SECTIONS: ConsentSection[] = [
  {
    heading: "Finalidad",
    body: "Grabar el audio de esta reunión para transcribirla automáticamente y preparar un borrador de acta que el personal docente revisa, corrige y aprueba antes de firmarla.",
  },
  {
    heading: "Datos que se tratan",
    body: "Audio de la reunión, transcripción del audio con separación de intervenciones, nombres y roles de quienes participan, y la firma manuscrita digitalizada que cada persona dibuje en pantalla.",
  },
  {
    heading: "Responsable del tratamiento",
    body: "La institución educativa organizadora de la reunión. El personal docente que convoca actúa por encargo de la institución.",
  },
  {
    heading: "Encargados y destinatarios",
    body: "El audio se envía a un proveedor de transcripción automática y la transcripción a un proveedor de modelos de lenguaje, ambos únicamente para producir el borrador. El acta firmada se entrega a las personas participantes y se archiva en el repositorio de la institución. No se comparte con terceros ajenos a la reunión.",
  },
  {
    heading: "Conservación",
    body: "El audio se elimina en cuanto termina la transcripción. Se conservan la transcripción, el acta y el documento firmado según la política de archivo de la institución.",
  },
  {
    heading: "Decisiones automatizadas",
    body: "La herramienta no toma decisiones sobre el estudiante. Propone un borrador; la redacción final es responsabilidad de la persona que firma el acta.",
  },
  {
    heading: "Derechos",
    body: "Puede negarse a la grabación sin que ello impida la reunión, retirar el consentimiento en cualquier momento, y solicitar acceso, rectificación o eliminación de sus datos ante la institución.",
  },
];

export const CONSENT_SUMMARY =
  "Se grabará el audio de esta reunión para generar un borrador de acta. La grabación se elimina tras transcribirse. La negativa no impide realizar la reunión.";

export const ACCEPTANCE_TEXT =
  "Declaro que revisé el contenido de esta acta, que refleja lo tratado en la reunión y que firmo de forma manuscrita digitalizada. Entiendo que esta firma no es una firma electrónica cualificada y que su validez depende de las políticas de la institución.";

export const DRAFT_LEGAL_NOTE =
  "Texto de borrador institucional sujeto a revisión jurídica. ACTA PRO no otorga validez legal automática.";
