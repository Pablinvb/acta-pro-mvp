import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const parse = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message);
    }
  }
  class APIConnectionTimeoutError extends Error {}

  class Anthropic {
    readonly messages = { parse };
  }
  Object.assign(Anthropic, { APIError, APIConnectionTimeoutError });

  return { default: Anthropic, APIError, APIConnectionTimeoutError };
});

vi.mock("@anthropic-ai/sdk/helpers/zod", () => ({
  zodOutputFormat: vi.fn(() => ({ type: "json_schema", schema: {} })),
}));

const { generateMinutesWithAnthropic } = await import("@/lib/anthropic/generate-minutes");
const { resetEnvCache } = await import("@/lib/env");
const { emptyMinutes } = await import("@/lib/schemas/minutes");

const segments = [
  {
    id: "m1-seg-01",
    meeting_id: "m1",
    speaker_label: "speaker_0",
    start_seconds: 0,
    end_seconds: 5,
    text: "Convoqué esta reunión para revisar Matemáticas.",
    confidence: 0.96,
    is_final: true,
    created_at: "2026-08-18T15:00:00.000Z",
  },
];

const detail = {
  meeting: {
    id: "m1",
    institution_id: "i1",
    teacher_id: "t1",
    student_id: "s1",
    title: "Seguimiento académico",
    reason: null,
    scheduled_at: "2026-08-18T15:00:00.000Z",
    started_at: null,
    ended_at: null,
    status: "processing" as const,
    source: "manual" as const,
    google_event_id: null,
    created_at: "2026-08-10T14:00:00.000Z",
  },
  student: {
    id: "s1",
    institution_id: "i1",
    external_id: "DEMO-0001",
    full_name: "Juan Pérez López",
    grade: "5.º EGB",
    section: "A",
    active: true,
  },
  teacher: {
    id: "t1",
    full_name: "Ana Pérez",
    email: "ana.perez@demo.actapro.ec",
    role: "teacher" as const,
    institution_id: "i1",
    created_at: "2026-01-08T13:00:00.000Z",
  },
  institution: { id: "i1", name: "Unidad Educativa Demo", address: null, created_at: "2026-01-08T13:00:00.000Z" },
  representatives: [],
  participants: [],
};

function validMinutes(overrides = {}) {
  return {
    ...emptyMinutes(),
    summary: "Reunión de seguimiento académico.",
    agreements: [
      {
        description: "Entregar tareas pendientes",
        responsible: "Juan Pérez López",
        due_date: "2026-08-21",
        source_segment_ids: ["m1-seg-01"],
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  parse.mockReset();
  process.env.ANTHROPIC_API_KEY = "clave-de-prueba";
  process.env.ANTHROPIC_MODEL = "claude-sonnet-5";
  resetEnvCache();
});

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  resetEnvCache();
});

describe("generación del acta con Anthropic", () => {
  it("usa el modelo configurado y salida estructurada", async () => {
    parse.mockResolvedValue({ stop_reason: "end_turn", parsed_output: validMinutes() });

    const result = await generateMinutesWithAnthropic(detail, segments, { speaker_0: "Ana Pérez" });

    expect(result.model).toBe("claude-sonnet-5");
    const params = parse.mock.calls[0][0];
    expect(params.model).toBe("claude-sonnet-5");
    expect(params.output_config.format).toBeDefined();
    expect(params.max_tokens).toBeGreaterThanOrEqual(6000);
  });

  it("envía la transcripción numerada y no filtra la clave en el mensaje", async () => {
    parse.mockResolvedValue({ stop_reason: "end_turn", parsed_output: validMinutes() });
    await generateMinutesWithAnthropic(detail, segments, { speaker_0: "Ana Pérez" });

    const params = parse.mock.calls[0][0];
    const userMessage = params.messages[0].content as string;
    expect(userMessage).toContain("[m1-seg-01]");
    expect(userMessage).toContain("Ana Pérez");
    expect(userMessage).not.toContain("clave-de-prueba");
    expect(params.system).toContain("REGLAS INNEGOCIABLES");
  });

  it("normaliza fechas inválidas devueltas por el modelo", async () => {
    parse.mockResolvedValue({
      stop_reason: "end_turn",
      parsed_output: validMinutes({
        agreements: [
          {
            description: "Entregar tareas",
            responsible: "Juan",
            due_date: "el próximo viernes",
            source_segment_ids: ["m1-seg-01"],
          },
        ],
      }),
    });

    const { minutes } = await generateMinutesWithAnthropic(detail, segments, {});
    expect(minutes.agreements[0].due_date).toBeNull();
    expect(minutes.review_warnings.join(" ")).toMatch(/formato inválido/);
  });

  it("advierte cuando el modelo cita segmentos inexistentes", async () => {
    parse.mockResolvedValue({
      stop_reason: "end_turn",
      parsed_output: validMinutes({
        facts: [{ statement: "Hecho inventado", attributed_to: "Docente", source_segment_ids: ["m1-seg-99"] }],
      }),
    });

    const { minutes } = await generateMinutesWithAnthropic(detail, segments, {});
    expect(minutes.review_warnings.join(" ")).toMatch(/no existen en la transcripción/);
  });

  it("rechaza una salida que no cumple el esquema", async () => {
    parse.mockResolvedValue({ stop_reason: "end_turn", parsed_output: { summary: "solo un resumen" } });
    await expect(generateMinutesWithAnthropic(detail, segments, {})).rejects.toThrow(/no cumple el esquema/);
  });

  it("informa cuando el modelo se niega a responder", async () => {
    parse.mockResolvedValue({ stop_reason: "refusal", parsed_output: null });
    await expect(generateMinutesWithAnthropic(detail, segments, {})).rejects.toThrow(/no pudo redactar/);
  });

  it("informa cuando se agota el presupuesto de tokens", async () => {
    parse.mockResolvedValue({ stop_reason: "max_tokens", parsed_output: null });
    await expect(generateMinutesWithAnthropic(detail, segments, {})).rejects.toThrow(/demasiado extensa/);
  });

  it("traduce el límite de tasa del proveedor a un mensaje recuperable", async () => {
    // El módulo está simulado en tiempo de ejecución, pero TypeScript ve la
    // firma real del SDK; se acota al constructor del doble de prueba.
    const { APIError } = await import("@anthropic-ai/sdk");
    const MockedApiError = APIError as unknown as new (status: number, message: string) => Error;
    parse.mockRejectedValue(new MockedApiError(429, "rate limited"));
    await expect(generateMinutesWithAnthropic(detail, segments, {})).rejects.toThrow(/saturado/);
  });

  it("no llama al proveedor sin transcripción", async () => {
    await expect(generateMinutesWithAnthropic(detail, [], {})).rejects.toThrow(/No hay transcripción/);
    expect(parse).not.toHaveBeenCalled();
  });

  it("falla de forma explícita sin clave configurada", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    resetEnvCache();
    await expect(generateMinutesWithAnthropic(detail, segments, {})).rejects.toThrow(/no está configurado/);
  });
});
