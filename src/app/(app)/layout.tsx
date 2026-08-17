import { AppShell } from "@/components/app-shell";
import { Alert } from "@/components/ui/alert";
import { requireSession } from "@/lib/session";
import { isDemoMode, isSupabaseConfigured, missingRequiredVariables } from "@/lib/env";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const missing = missingRequiredVariables();

  return (
    <AppShell session={session} demoMode={isDemoMode()}>
      {!isSupabaseConfigured() && isDemoMode() ? (
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
