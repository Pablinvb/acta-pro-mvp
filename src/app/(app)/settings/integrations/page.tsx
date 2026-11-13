import type { Metadata } from "next";

import { Alert } from "@/components/ui/alert";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { GoogleCalendarCard } from "@/app/(app)/settings/integrations/google-card";
import { requireSession } from "@/lib/session";
import {
  getEnv,
  isAnthropicConfigured,
  isDeepgramConfigured,
  isGoogleConfigured,
  isResendConfigured,
  isSupabaseConfigured,
  missingRequiredVariables,
} from "@/lib/env";
import { getGoogleCredentials } from "@/lib/google/credentials";
import { isSupabaseReachable } from "@/lib/data/mode";

export const metadata: Metadata = { title: "Integraciones" };

type Status =
  | "Configurado"
  | "Falta configurar"
  | "Conectado"
  | "Modo demostración"
  | "No disponible"
  | "No responde";

const TONE: Record<Status, BadgeTone> = {
  Configurado: "verified",
  Conectado: "verified",
  "Falta configurar": "review",
  "Modo demostración": "review",
  "No disponible": "neutral",
  "No responde": "danger",
};

interface IntegrationCard {
  name: string;
  status: Status;
  purpose: string;
  detail: string;
  variables: string[];
}

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ google?: string; configuracion?: string }>;
}) {
  const { google, configuracion } = await searchParams;
  const session = await requireSession();
  const env = getEnv();
  const demo = env.DEMO_MODE;
  const missing = missingRequiredVariables(env);

  const supabaseReachable = isSupabaseConfigured(env) ? await isSupabaseReachable() : false;

  let googleConnected = false;
  if (isGoogleConfigured(env)) {
    try {
      googleConnected = Boolean(await getGoogleCredentials(session.profile.id));
    } catch {
      googleConnected = false;
    }
  }

  const cards: IntegrationCard[] = [
    {
      name: "Supabase",
      status: !isSupabaseConfigured(env)
        ? demo
          ? "Modo demostración"
          : "Falta configurar"
        : supabaseReachable
          ? "Configurado"
          : "No responde",
      purpose: "Autenticación, base de datos y almacenamiento privado de los PDF.",
      detail: !isSupabaseConfigured(env)
        ? "Sin Supabase, los datos viven en la memoria del servidor y se pierden al reiniciarlo."
        : supabaseReachable
          ? "Los datos se guardan en Postgres con Row Level Security."
          : "Las variables están puestas pero la API no contesta: el proyecto puede estar pausado, borrado o la URL tener una errata.",
      variables: ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"],
    },
    {
      name: "Deepgram",
      status: isDeepgramConfigured(env) ? "Configurado" : demo ? "Modo demostración" : "Falta configurar",
      purpose: "Transcripción en vivo y separación de hablantes.",
      detail: isDeepgramConfigured(env)
        ? `Modelo ${env.NEXT_PUBLIC_DEEPGRAM_MODEL}, idioma ${env.NEXT_PUBLIC_DEEPGRAM_LANGUAGE}, diarización ${env.DEEPGRAM_DIARIZE_MODEL}.`
        : "Sin clave se usa una transcripción ficticia, siempre rotulada como simulación.",
      variables: ["DEEPGRAM_API_KEY"],
    },
    {
      name: "Claude (Anthropic)",
      status: isAnthropicConfigured(env) ? "Configurado" : demo ? "Modo demostración" : "Falta configurar",
      purpose: "Convierte la transcripción en un borrador estructurado de acta.",
      detail: isAnthropicConfigured(env)
        ? `Modelo ${env.ANTHROPIC_MODEL} con salida estructurada validada.`
        : "Sin clave se genera un borrador determinístico marcado como demostración.",
      variables: ["ANTHROPIC_API_KEY", "ANTHROPIC_MODEL"],
    },
    {
      name: "Resend",
      status: isResendConfigured(env) ? "Configurado" : demo ? "Modo demostración" : "Falta configurar",
      purpose: "Envío del acta firmada al representante.",
      detail: isResendConfigured(env)
        ? `Los correos salen desde ${env.EMAIL_FROM}.`
        : "Sin clave se muestra una vista previa del correo rotulada como simulación.",
      variables: ["RESEND_API_KEY", "EMAIL_FROM"],
    },
    {
      name: "Runachay",
      status: "No disponible",
      purpose: "Conector con el sistema institucional de estudiantes.",
      detail:
        "No existe documentación ni credenciales oficiales para esta integración. El listado de estudiantes proviene de un proveedor simulado con datos ficticios y no se conecta a ningún sistema real.",
      variables: ["RUNACHAY_BASE_URL", "RUNACHAY_API_KEY"],
    },
  ];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Integraciones</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Estado real de cada servicio. Ninguna clave se muestra aquí ni se envía al navegador.
        </p>
      </header>

      {configuracion === "incompleta" ? (
        <Alert tone="danger" title="Configuración incompleta">
          DEMO_MODE está desactivado y faltan variables indispensables:{" "}
          {missing.length > 0 ? missing.join(", ") : "revise su archivo .env.local"}. La aplicación no continuará
          con simulaciones silenciosas.
        </Alert>
      ) : null}

      {google === "conectado" ? (
        <Alert tone="verified">Cuenta de Google Calendar conectada.</Alert>
      ) : google === "cancelado" ? (
        <Alert tone="review">Se canceló la autorización de Google Calendar.</Alert>
      ) : null}

      {demo ? (
        <Alert tone="review" title="Modo demostración activo">
          La aplicación arranca sin claves y usa datos ficticios determinísticos. Toda simulación aparece rotulada
          en la interfaz. Cambie DEMO_MODE a false cuando las integraciones indispensables estén configuradas.
        </Alert>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        {cards.map((card) => (
          <Card key={card.name}>
            <CardHeader className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>{card.name}</CardTitle>
              <Badge tone={TONE[card.status]}>{card.status}</Badge>
            </CardHeader>
            <CardBody className="space-y-3">
              <p className="text-sm text-ink-muted">{card.purpose}</p>
              <p className="text-sm leading-relaxed text-ink">{card.detail}</p>
              <p className="text-xs text-ink-subtle">
                Variables: <span className="font-mono">{card.variables.join(", ")}</span>
              </p>
            </CardBody>
          </Card>
        ))}

        <GoogleCalendarCard
          configured={isGoogleConfigured(env)}
          connected={googleConnected}
          demo={demo}
          calendarId={env.GOOGLE_CALENDAR_ID}
        />
      </div>
    </div>
  );
}
