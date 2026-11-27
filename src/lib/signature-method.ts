import type { SignatureVerificationMethod } from "@/lib/types";

const labels: Record<SignatureVerificationMethod, string> = {
  no_registrado: "Método no registrado",
  sesion_verificada: "Sesión docente verificada",
  presencial_atestiguada: "Firma presencial atestiguada",
  docente_reautenticado: "Docente reautenticado con contraseña",
  codigo_correo: "Código de un solo uso por correo",
};

export function signatureMethodLabel(
  method?: SignatureVerificationMethod | null,
) {
  return labels[method ?? "no_registrado"] ?? labels.no_registrado;
}
