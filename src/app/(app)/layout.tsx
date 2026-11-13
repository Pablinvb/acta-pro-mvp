import { AppShell } from "@/components/app-shell";
import { Alert } from "@/components/ui/alert";
import { requireSession } from "@/lib/session";
import { isDemoMode, missingRequiredVariables } from "@/lib/env";
import { resolveDataMode } from "@/lib/data/mode";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const missing = missingRequiredVariables();
  const { mode, supabaseUnreachable } = await resolveDataMode();

  return (
    <AppShell session={session} demoMode={isDemoMode()}>
      {supabaseUnreachable ? (
        <Alert tone="danger" title="Supabase no responde" className="mb-6">
          Las variables de Supabase están configuradas, pero su API no contesta: el proyecto puede estar pausado,
          borrado o la URL puede tener una errata. La aplicación continúa en memoria para no bloquearse, así que lo
          que registre ahora no se conservará.
        </Alert>
      ) : mode === "demo" && isDemoMode() ? (
        <Alert tone="review" title="Almacenamiento en memoria" className="mb-6">
          Supabase no está configurado. Las reuniones, transcripciones y actas viven en la memoria del servidor y se
          pierden al reiniciarlo. Configure Supabase para conservar los datos.
        </Alert>
      ) : null}

      {missing.length > 0 ? (
        <Alert tone="danger" title="Faltan variables indispensables" className="mb-6">
          Configure {missing.join(", ")} o active DEMO_MODE. Revise la página de integraciones.
        </Alert>
      ) : null}

      {children}
    </AppShell>
  );
}
