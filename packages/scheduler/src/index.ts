import type { CrossLink, Plan, RecipeDish } from "@kc/core";
import { epochToLocalMin, localMinToEpoch } from "@kc/core";
import { expand } from "./expand.js";
import { placeAll, toPlan } from "./place.js";
import { earliestServeSummary } from "./summary.js";
import type { ScheduleCtx, WStep } from "./types.js";
import { validate } from "./validate.js";

export { expand } from "./expand.js";
export { validate, type ValidateCtx, type ValidateIssue } from "./validate.js";
export { replan, findTarget, type Change, type ReplanResult } from "./replan.js";

export interface PlanRequest {
  mealId: string;
  dishes: RecipeDish[];
  links?: CrossLink[];
  serveAt: number;
  now: number;
  createdAt?: number;
  day?: string;
  cooks?: 1 | 2;
  racks?: number;
  burners?: number;
  version?: number;
}

function durations(rest: WStep | undefined): (number | undefined)[] {
  if (!rest) return [undefined];
  const out: number[] = [];
  for (let d = rest.maxMinutes; d >= rest.minMinutes; d -= 5) out.push(d);
  return out.length ? out : [rest.duration];
}

function search(steps: WStep[], base: ScheduleCtx, serveMin: number): { plan: Plan; delta: number } | undefined {
  const rest = steps.find((s) => s.kind === "rest" && s.dishId === steps.find((x) => x.kind === "oven" && !x.tempFlexible)?.dishId);
  let last: Plan | undefined;
  for (let delta = 0; delta <= 12 * 60; delta += 5) {
    for (const dur of durations(rest)) {
      const trial = structuredClone(steps);
      const r = rest ? trial.find((s) => s.id === rest.id) : undefined;
      if (r && dur != null) {
        r.duration = dur;
        r.detail = `Rest · ${dur} min`;
      }
      const ctx = { ...base, serveMin: serveMin + delta };
      if (!placeAll(trial, ctx)) continue;
      const plan = toPlan(trial, ctx);
      last = plan;
      const v = validate(plan, {
        now: localMinToEpoch(ctx.nowMin, ctx.day),
        racks: ctx.racks,
        burners: ctx.burners,
        cooks: ctx.cooks,
      });
      if (v.ok) return { plan, delta };
    }
  }
  return last ? { plan: last, delta: -1 } : undefined;
}

export function plan(req: PlanRequest): Plan {
  const day = req.day ?? "2026-11-26";
  const serveMin = epochToLocalMin(req.serveAt, day);
  const nowMin = epochToLocalMin(req.now, day);
  const steps = expand(req.dishes, req.links ?? []);
  const ctx: ScheduleCtx = {
    mealId: req.mealId,
    version: req.version ?? 1,
    createdAt: req.createdAt ?? req.now,
    day,
    serveMin,
    nowMin,
    cooks: req.cooks ?? 1,
    racks: req.racks ?? 2,
    burners: req.burners ?? 4,
    mode: "compact",
  };
  const found = search(steps, ctx, serveMin);
  if (!found) {
    return toPlan(steps, ctx, { summary: "No plan.", warnings: ["The scheduler could not place this meal."] });
  }
  const { plan: made, delta } = found;
  made.warnings = made.steps.filter((s) => s.adjustedNote).map((s) => `${s.dishName ?? s.dishId}: ${s.adjustedNote}`);
  if (delta > 0) {
    const name = made.steps.find((s) => s.kind === "oven" && !s.tempFlexible)?.dishName ?? "Dinner";
    made.summary = earliestServeSummary(name, epochToLocalMin(made.serveAt, day));
    made.options = [{ id: "move_serve_time", label: "Sounds good", serveAt: made.serveAt, lateDishes: [] }];
    made.choicePending = true;
  }
  return made;
}

export function debugTimeline(p: Plan): string {
  const lines = p.steps.map((s) => {
    const a = epochToLocalMin(s.startAt, p.day);
    const b = epochToLocalMin(s.endAt, p.day);
    const hh = (m: number) => {
      const x = ((m % 1440) + 1440) % 1440;
      return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`;
    };
    return `${s.id.padEnd(16)} ${hh(a)}-${hh(b)} ${s.kind.padEnd(9)} ${s.status.padEnd(8)} ${s.adjustedNote ?? s.detail ?? ""}`;
  });
  const phases = p.ovenPhases.map((ph) => {
    const a = epochToLocalMin(ph.startAt, p.day);
    const b = epochToLocalMin(ph.endAt, p.day);
    const tag = ph.ramp ? "ramp" : ph.preheat ? "preheat" : `${ph.tempF}F`;
    return `${tag} ${a}-${b}`;
  });
  return `${lines.join("\n")}\nphases: ${phases.join(" | ")}\nserve ${epochToLocalMin(p.serveAt, p.day)} summary: ${p.summary}`;
}
