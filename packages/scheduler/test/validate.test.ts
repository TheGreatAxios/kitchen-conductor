import { describe, expect, it } from "vitest";
import type { Plan, ScheduledStep } from "@kc/core";
import { hm, localMinToEpoch } from "@kc/core";
import { validate } from "../src/validate.js";

const DAY = "2026-11-26";
const at = (h: number, m = 0) => localMinToEpoch(hm(h, m), DAY);

function step(partial: Partial<ScheduledStep> & Pick<ScheduledStep, "id" | "kind" | "startAt" | "endAt">): ScheduledStep {
  return {
    dishId: partial.id.split(".")[0]!,
    name: partial.id,
    minutes: 10,
    hands: 0,
    after: [],
    source: "library",
    status: "pending",
    resource: { kind: "counter" },
    dishName: partial.id,
    shortDish: partial.id,
    summaryOrder: 1,
    ...partial,
  };
}

function meal(steps: ScheduledStep[], phases: Plan["ovenPhases"] = []): Plan {
  return {
    mealId: "bad",
    version: 1,
    serveAt: at(17, 0),
    createdAt: at(13, 0),
    day: DAY,
    steps,
    ovenPhases: phases,
    changes: [],
    options: [],
    summary: "",
    warnings: [],
    cooks: 1,
    racks: 2,
    burners: 4,
  };
}

const ctx = { now: at(13, 0), racks: 2, burners: 4, cooks: 1 };

describe("validate", () => {
  it("flags too many hands", () => {
    const p = meal([
      step({ id: "a.a", kind: "prep", hands: 2, startAt: at(16, 0), endAt: at(16, 20), resource: { kind: "hands" } }),
      step({ id: "b.b", kind: "prep", hands: 2, startAt: at(16, 0), endAt: at(16, 20), resource: { kind: "hands" } }),
    ]);
    expect(validate(p, ctx).issues.some((i) => i.code === "hands")).toBe(true);
  });

  it("flags too many burners", () => {
    const steps = [1, 2, 3, 4, 5].map((n) => step({
      id: `d${n}.s`, kind: "stovetop", startAt: at(16, 0), endAt: at(16, 30), resource: { kind: "burner", n },
    }));
    expect(validate(meal(steps), ctx).issues.some((i) => i.code === "burners")).toBe(true);
  });

  it("flags an oven step off its phase", () => {
    const p = meal(
      [step({ id: "t.roast", kind: "oven", ovenTempF: 450, appliedTempF: 450, startAt: at(16, 0), endAt: at(16, 30), resource: { kind: "oven", rack: 1 } })],
      [{ id: "p", tempF: 350, startAt: at(16, 0), endAt: at(16, 30), ramp: false }],
    );
    expect(validate(p, ctx).issues.some((i) => i.code === "oven-temp")).toBe(true);
  });

  it("flags food during a ramp", () => {
    const p = meal(
      [step({ id: "t.roast", kind: "oven", ovenTempF: 425, appliedTempF: 425, startAt: at(16, 0), endAt: at(16, 20), resource: { kind: "oven", rack: 1 } })],
      [
        { id: "r", tempF: 425, startAt: at(16, 0), endAt: at(16, 10), ramp: true },
        { id: "p", tempF: 425, startAt: at(16, 10), endAt: at(16, 30), ramp: false },
      ],
    );
    expect(validate(p, ctx).issues.some((i) => i.code === "ramp")).toBe(true);
  });

  it("flags a broken dependency lag", () => {
    const p = meal([
      step({ id: "a.a", kind: "prep", startAt: at(16, 0), endAt: at(16, 20), resource: { kind: "hands" } }),
      step({ id: "b.b", kind: "prep", startAt: at(16, 10), endAt: at(16, 25), after: [{ stepId: "a.a", lagMin: 0 }], resource: { kind: "hands" } }),
    ]);
    expect(validate(p, ctx).issues.some((i) => i.code === "lag")).toBe(true);
  });

  it("flags a dish that misses its hold window", () => {
    const p = meal([
      step({ id: "a.a", kind: "prep", startAt: at(14, 0), endAt: at(14, 20), holdMin: 10, resource: { kind: "hands" } }),
    ]);
    expect(validate(p, ctx).issues.some((i) => i.code === "hold")).toBe(true);
  });

  it("flags a pending step that starts before now", () => {
    const p = meal([
      step({ id: "a.a", kind: "prep", startAt: at(12, 0), endAt: at(12, 20), status: "pending", resource: { kind: "hands" }, holdMin: 400 }),
    ]);
    expect(validate(p, ctx).issues.some((i) => i.code === "before-now")).toBe(true);
  });

  it("flags two dishes on the same rack", () => {
    const phase = { id: "p", tempF: 350, startAt: at(16, 0), endAt: at(17, 0), ramp: false };
    const p = meal([
      step({ id: "a.a", kind: "oven", ovenTempF: 350, appliedTempF: 350, startAt: at(16, 0), endAt: at(16, 30), resource: { kind: "oven", rack: 1 }, holdMin: 60 }),
      step({ id: "b.b", kind: "oven", ovenTempF: 350, appliedTempF: 350, startAt: at(16, 10), endAt: at(16, 40), resource: { kind: "oven", rack: 1 }, holdMin: 60 }),
    ], [phase]);
    expect(validate(p, { ...ctx, racks: 2 }).issues.some((i) => i.code === "rack-id" || i.code === "racks")).toBe(true);
  });
});
