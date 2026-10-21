import { describe, expect, it } from "vitest";
import { epochToLocalMin, hm, localMinToEpoch } from "@kc/core";
import { CROSS_LINKS, dishById, loadLibrary, thanksgivingDishes } from "@kc/recipes";
import { debugTimeline, plan, replan, validate, type PlanRequest } from "../src/index.js";

const DAY = "2026-11-26";
const at = (h: number, m = 0) => localMinToEpoch(hm(h, m), DAY);

function t1req(over: Partial<PlanRequest> = {}): PlanRequest {
  return {
    mealId: "tg",
    dishes: thanksgivingDishes(),
    links: CROSS_LINKS,
    serveAt: at(17, 0),
    now: at(13, 0),
    createdAt: at(13, 0),
    day: DAY,
    cooks: 1,
    racks: 2,
    burners: 4,
    ...over,
  };
}

function span(made: ReturnType<typeof plan>, id: string): [number, number] {
  const s = made.steps.find((step) => step.id === id);
  if (!s) throw new Error(`missing ${id}\n${debugTimeline(made)}`);
  return [epochToLocalMin(s.startAt, DAY), epochToLocalMin(s.endAt, DAY)];
}

function close(made: ReturnType<typeof plan>, id: string, start: number, end: number) {
  const [a, b] = span(made, id);
  expect(Math.abs(a - start), `${id} start ${a} vs ${start}\n${debugTimeline(made)}`).toBeLessThanOrEqual(5);
  expect(Math.abs(b - end), `${id} end ${b} vs ${end}\n${debugTimeline(made)}`).toBeLessThanOrEqual(5);
}

describe("scheduler", () => {
  it("T1 thanksgiving lands on the mockup within 5 minutes", () => {
    const p = plan(t1req());
    const v = validate(p, { now: at(13, 0), racks: 2, burners: 4, cooks: 1 });
    expect(v.ok, v.issues.map((i) => i.message).join("; ") + "\n" + debugTimeline(p)).toBe(true);
    const bake = p.steps.find((s) => s.id === "stuffing.bake")!;
    expect(bake.appliedTempF).toBe(350);
    expect(bake.minutes).toBe(50);
    expect(bake.adjustedNote).toMatch(/\+10/);
    const phases = p.ovenPhases.filter((ph) => !ph.ramp && !ph.preheat);
    const hot = phases.find((ph) => ph.tempF === 425);
    const roast = p.steps.find((s) => s.id === "turkey.roast")!;
    const rolls = p.steps.find((s) => s.id === "rolls.bake")!;
    expect(hot, debugTimeline(p)).toBeTruthy();
    expect(rolls.startAt).toBeGreaterThanOrEqual(roast.endAt);
    const gravy = p.steps.find((s) => s.id === "gravy.simmer")!;
    expect(gravy.startAt).toBeGreaterThanOrEqual(roast.endAt);
    close(p, "turkey.roast", hm(13, 45), hm(16, 15));
    close(p, "turkey.baste", hm(15, 45), hm(15, 50));
    close(p, "turkey.rest", hm(16, 15), hm(16, 45));
    close(p, "turkey.carve", hm(16, 45), hm(17, 0));
    close(p, "stuffing.prep", hm(15, 5), hm(15, 25));
    close(p, "stuffing.bake", hm(15, 25), hm(16, 15));
    close(p, "stuffing.hold", hm(16, 15), hm(17, 0));
    close(p, "rolls.bake", hm(16, 30), hm(16, 45));
    close(p, "potatoes.peel", hm(15, 30), hm(15, 45));
    close(p, "potatoes.boil", hm(15, 55), hm(16, 20));
    close(p, "potatoes.mash", hm(16, 25), hm(16, 35));
    close(p, "gravy.simmer", hm(16, 20), hm(16, 40));
    close(p, "beans.cook", hm(16, 35), hm(16, 52));
  });

  it("T2 turkey +30 at 3:40 moves dinner to 5:20 and shortens the rest", () => {
    const t1 = plan(t1req());
    const now = at(15, 40);
    const { plan: t2, alternatives } = replan(t1, { type: "shift", target: "turkey", deltaMin: 30 }, now);
    const v = validate(t2, { now, racks: 2, burners: 4, cooks: 1 });
    expect(v.ok, v.issues.map((i) => i.message).join("; ") + "\n" + debugTimeline(t2)).toBe(true);
    expect(epochToLocalMin(t2.serveAt, DAY)).toBe(hm(17, 20));
    expect(t2.summary).toBe("Turkey needs 30 more minutes. Potatoes, gravy, beans and rolls moved later. The turkey rests 20 minutes instead of 30.");
    const keep = t2.options.find((o) => o.id === "keep_serve_time");
    expect(keep, debugTimeline(t2)).toBeTruthy();
    expect(keep!.lateDishes).toContain("rolls");
    const alt = alternatives.keep_serve_time;
    expect(alt).toBeTruthy();
    const rolls = alt!.steps.find((s) => s.id === "rolls.bake")!;
    expect(rolls.endAt - alt!.serveAt).toBeLessThanOrEqual(15 * 60_000);
    const prep = t2.steps.find((s) => s.id === "stuffing.prep")!;
    const prep0 = t1.steps.find((s) => s.id === "stuffing.prep")!;
    expect(prep.startAt).toBe(prep0.startAt);
    expect(prep.endAt).toBe(prep0.endAt);
    expect(t2.changes.some((c) => c.deltaMin !== 0)).toBe(true);
  });

  it("T3 a later serve time shifts the unfinished meal about an hour", () => {
    const t1 = plan(t1req());
    const { plan: t3 } = replan(t1, { type: "set_serve_time", serveAt: at(18, 0) }, at(13, 0));
    const v = validate(t3, { now: at(13, 0), racks: 2, burners: 4, cooks: 1 });
    expect(v.ok, debugTimeline(t3) + v.issues.map((i) => i.message).join("; ")).toBe(true);
    for (const s of t1.steps) {
      const n = t3.steps.find((x) => x.id === s.id);
      expect(n, s.id).toBeTruthy();
      const delta = Math.round((n!.startAt - s.startAt) / 60_000);
      expect(Math.abs(delta - 60), `${s.id} moved ${delta}`).toBeLessThanOrEqual(5);
      expect(n!.startAt).toBeGreaterThanOrEqual(at(13, 0) - 1000);
    }
  });

  it("T4 two inflexible oven temperatures never share the cavity", () => {
    const dish = (id: string, temp: number) => ({
      id, name: id, shortName: id, aliases: [], glaze: "#888", fg: "#fff", summaryOrder: 1,
      ingredients: [],
      steps: [{ key: "bake", name: "Bake", kind: "oven" as const, minutes: 60, ovenTempF: temp, tempFlexible: false, hands: 0 as const, holdMin: 180 }],
    });
    const p = plan({
      mealId: "t4", dishes: [dish("low", 350), dish("high", 450)],
      serveAt: at(17, 0), now: at(12, 0), day: DAY, racks: 2, burners: 4, cooks: 1,
    });
    const v = validate(p, { now: at(12, 0), racks: 2, burners: 4, cooks: 1 });
    expect(v.ok, debugTimeline(p) + v.issues.map((i) => i.message).join("; ")).toBe(true);
    const a = p.steps.find((s) => s.id === "low.bake")!;
    const b = p.steps.find((s) => s.id === "high.bake")!;
    expect(a.endAt <= b.startAt || b.endAt <= a.startAt).toBe(true);
    const temps = new Set(p.ovenPhases.filter((ph) => !ph.ramp && !ph.preheat).map((ph) => ph.tempF));
    expect(temps.has(350)).toBe(true);
    expect(temps.has(450)).toBe(true);
    expect(p.ovenPhases.some((ph) => ph.ramp)).toBe(true);
  });

  it("T5 both hands stay within the cooks in the kitchen", () => {
    const dishes = [1, 2, 3].map((n) => ({
      id: `d${n}`, name: `D${n}`, shortName: `d${n}`, aliases: [], glaze: "#888", fg: "#fff", summaryOrder: n,
      ingredients: [],
      steps: [{ key: "prep", name: "Prep", kind: "prep" as const, minutes: 30, hands: 2 as const, holdMin: 90 }],
    }));
    const serve = at(17, 0);
    const now = at(14, 0);
    const one = plan({ mealId: "t5", dishes, serveAt: serve, now, day: DAY, cooks: 1 });
    const two = plan({ mealId: "t5", dishes, serveAt: serve, now, day: DAY, cooks: 2 });
    expect(maxHands(one)).toBeLessThanOrEqual(2);
    expect(maxHands(two)).toBeLessThanOrEqual(4);
    expect(maxHands(two)).toBeGreaterThanOrEqual(4);
  });

  it("T6 a fifth burner dish moves earlier and is held", () => {
    const dishes = [1, 2, 3, 4, 5].map((n) => ({
      id: `s${n}`, name: `S${n}`, shortName: `s${n}`, aliases: [], glaze: "#888", fg: "#fff", summaryOrder: n,
      ingredients: [],
      steps: [{ key: "simmer", name: "Simmer", kind: "stovetop" as const, minutes: 40, hands: 0 as const, holdMin: 50 }],
    }));
    const p = plan({ mealId: "t6", dishes, serveAt: at(17, 0), now: at(14, 0), day: DAY, burners: 4, cooks: 1 });
    const v = validate(p, { now: at(14, 0), racks: 2, burners: 4, cooks: 1 });
    expect(v.ok, debugTimeline(p) + v.issues.map((i) => i.message).join("; ")).toBe(true);
    expect(maxBurners(p)).toBeLessThanOrEqual(4);
    expect(p.steps.some((s) => s.kind === "hold")).toBe(true);
  });

  it("T7 skipping rolls removes the 425 phase", () => {
    const t1 = plan(t1req());
    const { plan: t7 } = replan(t1, { type: "skip_dish", dish: "rolls" }, at(13, 0));
    expect(t7.steps.some((s) => s.dishId === "rolls")).toBe(false);
    expect(t7.ovenPhases.some((p) => !p.preheat && p.tempF === 425)).toBe(false);
    const v = validate(t7, { now: at(13, 0), racks: 2, burners: 4, cooks: 1 });
    expect(v.ok, debugTimeline(t7) + v.issues.map((i) => i.message).join("; ")).toBe(true);
  });

  it("T8 the same meal is byte-identical across 100 runs", () => {
    const first = JSON.stringify(plan(t1req()));
    for (let i = 0; i < 100; i++) expect(JSON.stringify(plan(t1req()))).toBe(first);
  });

  it("T9 500 random library meals validate or move dinner", () => {
    const lib = loadLibrary();
    const rand = mulberry32(20261126);
    for (let i = 0; i < 500; i++) {
      const n = 1 + Math.floor(rand() * 8);
      const picked = shuffle(lib, rand).slice(0, n);
      const serveH = 16 + Math.floor(rand() * 4);
      const serve = at(serveH, Math.floor(rand() * 12) * 5);
      const now = serve - 8 * 60 * 60_000;
      let made: ReturnType<typeof plan>;
      try {
        made = plan({ mealId: `r${i}`, dishes: picked, links: CROSS_LINKS, serveAt: serve, now, day: DAY, cooks: rand() > 0.8 ? 2 : 1 });
      } catch (err) {
        throw new Error(`seed ${i} threw ${err}`, { cause: err });
      }
      const v = validate(made, { now, racks: made.racks, burners: made.burners, cooks: made.cooks });
      const shifted = made.options.some((o) => o.id === "move_serve_time") || made.serveAt !== serve;
      if (!v.ok && !shifted) {
        throw new Error(`seed ${i} invalid without a serve shift\n${v.issues.map((x) => x.message).join("; ")}\n${debugTimeline(made)}`);
      }
    }
  }, 30_000);

  it("T10 a turkey that has not started names the earliest dinner", () => {
    const turkey = dishById("turkey");
    expect(turkey).toBeTruthy();
    const p = plan({ mealId: "t10", dishes: [turkey!], serveAt: at(17, 0), now: at(16, 30), day: DAY });
    const v = validate(p, { now: at(16, 30), racks: 2, burners: 4, cooks: 1 });
    expect(v.ok, debugTimeline(p) + v.issues.map((i) => i.message).join("; ")).toBe(true);
    expect(p.serveAt).toBeGreaterThan(at(17, 0));
    expect(p.summary.toLowerCase()).toContain("earliest");
    expect(epochToLocalMin(p.serveAt, DAY)).toBeGreaterThanOrEqual(hm(19, 50));
  });

  it("T11 finishing the mash early lets the next hands step start sooner", () => {
    const dishes = [{
      id: "potatoes",
      name: "Potatoes",
      shortName: "potatoes",
      aliases: [],
      glaze: "#E9DFC9",
      fg: "#2A241B",
      summaryOrder: 1,
      ingredients: [],
      steps: [
        { key: "mash", name: "Mash", kind: "prep" as const, minutes: 20, hands: 2 as const },
        { key: "season", name: "Season", kind: "prep" as const, minutes: 10, hands: 1 as const, after: [{ key: "mash", lagMin: 0 }] },
      ],
    }];
    const base = plan({ mealId: "t11", dishes, serveAt: at(17, 0), now: at(15, 0), day: DAY });
    const mash0 = base.steps.find((s) => s.id === "potatoes.mash")!;
    const season0 = base.steps.find((s) => s.id === "potatoes.season")!;
    const now = mash0.endAt - 5 * 60_000;
    const { plan: t11 } = replan(base, { type: "mark_done", stepId: "potatoes.mash" }, now);
    const v = validate(t11, { now, racks: 2, burners: 4, cooks: 1 });
    expect(v.ok, debugTimeline(t11) + v.issues.map((i) => i.message).join("; ")).toBe(true);
    const mash = t11.steps.find((s) => s.id === "potatoes.mash")!;
    expect(mash.status).toBe("done");
    expect(mash.endAt).toBeLessThanOrEqual(now + 1000);
    const season = t11.steps.find((s) => s.id === "potatoes.season")!;
    expect(season.startAt).toBeLessThan(season0.startAt);
  });

  it("T12 undo restores the unfinished steps from before the shift", () => {
    const t1 = plan(t1req());
    const saved = structuredClone(t1);
    const now = at(15, 40);
    const { plan: t2 } = replan(t1, { type: "shift", target: "turkey", deltaMin: 30 }, now);
    expect(t1.steps.map((s) => s.startAt)).toEqual(saved.steps.map((s) => s.startAt));
    expect(t2.serveAt).not.toBe(t1.serveAt);
    for (const s of saved.steps) {
      if (s.endAt <= now) continue;
      const back = t1.steps.find((x) => x.id === s.id)!;
      expect(back.startAt).toBe(s.startAt);
      expect(back.endAt).toBe(s.endAt);
    }
  });
});

function maxHands(p: ReturnType<typeof plan>): number {
  return sweep(p, (s) => s.hands);
}
function maxBurners(p: ReturnType<typeof plan>): number {
  return sweep(p, (s) => (s.resource.kind === "burner" ? 1 : 0));
}
function sweep(p: ReturnType<typeof plan>, weight: (s: (typeof p.steps)[number]) => number): number {
  const ev: { t: number; d: number }[] = [];
  for (const s of p.steps) {
    const w = weight(s);
    if (!w) continue;
    ev.push({ t: s.startAt, d: w }, { t: s.endAt, d: -w });
  }
  ev.sort((a, b) => a.t - b.t || a.d - b.d);
  let cur = 0, max = 0;
  for (const e of ev) {
    cur += e.d;
    if (cur > max) max = cur;
  }
  return max;
}
function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle<T>(list: T[], rand: () => number): T[] {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
