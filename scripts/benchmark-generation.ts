import { generateMinutesWithAnthropic } from "@/lib/anthropic/generate-minutes";
import { DEMO_MEETING_ID, DEMO_TRANSCRIPT } from "@/lib/demo/seed-data";
import { DemoRepository } from "@/lib/data/demo-repository";

async function main() {
  const detail = await new DemoRepository().getMeetingDetail(DEMO_MEETING_ID);
  if (!detail) throw new Error("Falta la reunión ficticia.");
  for (const duration of [15, 30, 45, 60]) {
    const segments = Array.from({ length: duration * 6 }, (_, index) => {
      const sample = DEMO_TRANSCRIPT[index % DEMO_TRANSCRIPT.length];
      return {
        ...sample,
        id: "seg-" + (index + 1),
        meeting_id: DEMO_MEETING_ID,
        start_seconds: index * 10,
        end_seconds: (index + 1) * 10,
        is_final: true,
        created_at: "2026-01-01T00:00:00Z",
      };
    });
    const start = Date.now();
    try {
      const result = await generateMinutesWithAnthropic(
        detail,
        segments,
        {},
        600_000,
      );
      console.log(
        JSON.stringify({
          duration,
          seconds: (Date.now() - start) / 1000,
          model: result.model,
          input: result.usage?.input_tokens,
          output: result.usage?.output_tokens,
          segments: segments.length,
        }),
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          duration,
          seconds: (Date.now() - start) / 1000,
          error: error instanceof Error ? error.message : "Falló el proveedor",
        }),
      );
      process.exitCode = 1;
      break;
    }
  }
}
void main();
