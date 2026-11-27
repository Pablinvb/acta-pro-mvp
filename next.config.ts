import type { NextConfig } from "next";

/**
 * Encabezados de seguridad aplicados a toda la aplicación.
 * El proxy genera la política de contenido por petición.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // El micrófono es indispensable; el resto de capacidades queda bloqueado.
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  // Orígenes permitidos para los recursos internos del servidor de desarrollo.
  // Sin esto, abrir la aplicación por 127.0.0.1 impide la hidratación.
  allowedDevOrigins: ["localhost", "127.0.0.1"],
  // @react-pdf/renderer y googleapis no deben empaquetarse: se ejecutan en Node.
  serverExternalPackages: ["@react-pdf/renderer", "googleapis"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
