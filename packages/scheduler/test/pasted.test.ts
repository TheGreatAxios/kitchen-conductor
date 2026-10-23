import { describe, expect, it } from "vitest";
import { epochToLocalMin, hm, localMinToEpoch, type RecipeDish } from "@kc/core";
import { CROSS_LINKS, parseRecipes, thanksgivingDishes, type BedrockSender } from "@kc/recipes";
import { debugTimeline, plan, replan, validate } from "../src/index.js";

const DAY = "2026-11-26";
const at = (h: number, m = 0) => localMinToEpoch(hm(h, m), DAY);

const step = (key: string, name: string, kind: string, minutes: number | null, extra: Record<string, unknown> = {}) => ({
  key, name, kind, minutes, ovenTempF: null, hands: "one", after: [], tempFlexible: false, holdMinutes: null, ...extra,
});

const reply = JSON.stringify({
  dishes: [
    {
      name: "Glazed carrots",
      servings: 6,
      ingredients: [{ item: "carrots", quantity: "2 lb" }],
      steps: [
        step("peel", "Peel and slice carrots", "prep", 10, { hands: "both" }),
        step("simmer", "Simmer in salted water", "stovetop", 8, { hands: "none", after: ["peel"] }),
        step("drain", "Drain", "prep", null, { after: ["simmer"] }),
        step("glaze", "Glaze with butter and maple", "stovetop", 5, { after: ["drain"] }),
        step("serve", "Serve hot", "prep", null, { hands: "both" }),
      ],
    },
    {
      name: "Cranberry sauce",
      servings: 8,
      ingredients: [{ item: "cranberries", quantity: "12 oz" }],
      steps: [
        step("rinse", "Rinse cranberries", "prep", 5),
        step("boil", "Boil sugar and water", "stovetop", 5, { hands: "none" }),
        step("simmer", "Simmer berries until they burst", "stovetop", 10, { hands: "none" }),
      ],
    },
    {
      name: "Roasted squash",
      servings: 6,
      ingredients: [{ item: "butternut squash", quantity: "1" }],
      steps: [
        step("cut", "Cube squash", "prep", 15, { hands: "both" }),
        step("roast", "Roast squash", "oven", 30, { hands: "none", ovenTempF: 400, after: ["cut"] }),
      ],
    },
  ],
});

const sender: BedrockSender = {
  async send() {
    return { output: { message: { content: [{ text: reply }] } } };
  },
};

async function pasted(): Promise<RecipeDish[]> {
  const res = await parseRecipes(
    [
      { name: "Glazed carrots", text: "carrots" },
      { name: "Cranberry sauce", text: "cranberries" },
      { name: "Roasted squash", text: "squash" },
    ],
    sender,
  );
  return res.dishes;
}

function request(dishes: RecipeDish[]) {
  return {
    mealId: "pasted",
    dishes: [...thanksgivingDishes(), ...dishes],
    links: CROSS_LINKS,
    serveAt: at(17, 0),
    now: at(13, 0),
    day: DAY,
    cooks: 1 as const,
    racks: 2,
    burners: 4,
  };
}

function window(p: ReturnType<typeof plan>, dishId: string): [number, number] {
  const own = p.steps.filter((s) => s.dishId === dishId && s.kind !== "hold");
  expect(own.length, debugTimeline(p)).toBeGreaterThan(0);
  return [Math.min(...own.map((s) => epochToLocalMin(s.startAt, DAY))), Math.max(...own.map((s) => epochToLocalMin(s.endAt, DAY)))];
}

describe("pasted recipes", () => {
  it("are scheduled backward from dinner and share the oven cleanly", async () => {
    const p = plan(request(await pasted()));
    const v = validate(p, { now: at(13, 0), racks: 2, burners: 4, cooks: 1 });
    expect(v.ok, v.issues.map((i) => i.message).join("; ") + "\n" + debugTimeline(p)).toBe(true);
    const serve = epochToLocalMin(p.serveAt, DAY);
    expect(serve).toBe(hm(17, 0));

    for (const id of ["glazed-carrots", "cranberry-sauce"]) {
      const [start, end] = window(p, id);
      expect(start, `${id}\n${debugTimeline(p)}`).toBeGreaterThan(hm(15, 0));
      expect(end, `${id}\n${debugTimeline(p)}`).toBeGreaterThan(serve - 45);
      expect(end).toBeLessThanOrEqual(serve);
    }

    const order = (dishId: string) =>
      p.steps
        .filter((s) => s.dishId === dishId && s.kind !== "hold")
        .sort((a, b) => a.startAt - b.startAt)
        .map((s) => s.id.split(".")[1]);
    expect(order("glazed-carrots")).toEqual(["peel", "simmer", "drain", "glaze", "serve"]);
    expect(order("cranberry-sauce")).toEqual(["rinse", "boil", "simmer"]);

    const roast = p.steps.find((s) => s.id === "roasted-squash.roast")!;
    const cut = p.steps.find((s) => s.id === "roasted-squash.cut")!;
    expect(cut.endAt).toBeLessThanOrEqual(roast.startAt);
    const phase = p.ovenPhases.find((ph) => ph.id === roast.ovenPhaseId);
    expect(phase?.tempF, debugTimeline(p)).toBe(roast.appliedTempF);
    expect(phase!.startAt).toBeLessThanOrEqual(roast.startAt);
    expect(phase!.endAt).toBeGreaterThanOrEqual(roast.endAt);
    expect(epochToLocalMin(roast.endAt, DAY)).toBeLessThanOrEqual(serve);
  });

  it("still move with dinner once one of their steps is done", async () => {
    const dishes = (await pasted()).filter((d) => d.id === "glazed-carrots");
    const first = plan(request(dishes));
    const step = first.steps.find((s) => s.dishId === "glazed-carrots" && s.startAt >= at(15, 40));
    expect(step, debugTimeline(first)).toBeTruthy();
    const now = step!.startAt + 2 * 60_000;
    const { plan: done } = replan(first, { type: "mark_done", stepId: step!.id }, now);
    const { plan: late } = replan(done, { type: "shift", target: "turkey", deltaMin: 30 }, now);
    const v = validate(late, { now, racks: 2, burners: 4, cooks: 1 });
    expect(v.ok, v.issues.map((i) => i.message).join("; ") + "\n" + debugTimeline(late)).toBe(true);
    const serve = epochToLocalMin(late.serveAt, DAY);
    expect(serve).toBeGreaterThan(hm(17, 0));
    expect(late.options.map((o) => o.id)).toContain("move_serve_time");
    const [, end] = window(late, "glazed-carrots");
    expect(end, debugTimeline(late)).toBeLessThanOrEqual(serve);
    expect(end).toBeGreaterThan(serve - 45);
  });
});
