import { describe, expect, it } from "vitest";

import {
  assertTransition,
  canTransition,
  hasReached,
  InvalidTransitionError,
  MEETING_FLOW,
} from "@/lib/meeting-state";

describe("máquina de estados de la reunión", () => {
  it("permite el recorrido completo del camino feliz", () => {
    for (let index = 0; index < MEETING_FLOW.length - 1; index += 1) {
      expect(canTransition(MEETING_FLOW[index], MEETING_FLOW[index + 1])).toBe(true);
    }
  });

  it("impide saltarse el consentimiento y la grabación", () => {
    expect(canTransition("scheduled", "recording")).toBe(false);
    expect(canTransition("ready", "draft")).toBe(false);
    expect(canTransition("scheduled", "signed")).toBe(false);
  });

  it("no permite retroceder desde un acta firmada", () => {
    expect(canTransition("signed", "draft")).toBe(false);
    expect(canTransition("signed", "approved")).toBe(false);
    expect(canTransition("sent", "signed")).toBe(false);
  });

  it("permite reabrir la edición mientras el acta no esté firmada", () => {
    expect(canTransition("approved", "draft")).toBe(true);
    expect(canTransition("draft", "processing")).toBe(true);
  });

  it("permite abortar una grabación sin audio", () => {
    expect(canTransition("recording", "ready")).toBe(true);
    expect(canTransition("processing", "ready")).toBe(true);
  });

  it("lanza InvalidTransitionError con un mensaje legible", () => {
    expect(() => assertTransition("scheduled", "signed")).toThrow(InvalidTransitionError);
    expect(() => assertTransition("scheduled", "signed")).toThrow(/scheduled → signed/);
  });

  it("hasReached ordena las etapas del flujo", () => {
    expect(hasReached("draft", "ready")).toBe(true);
    expect(hasReached("ready", "draft")).toBe(false);
    expect(hasReached("sent", "sent")).toBe(true);
  });
});
