import type { Plan } from "@kc/core";
import { epochToLocalMin, localMinToEpoch } from "@kc/core";
import { diffPlans } from "./diff.js";
import { placeAll, toPlan } from "./place.js";
import { earliestServeSummary, summarize } from "./summary.js";
import { isPlaced, type ScheduleCtx, type WStep } from "./types.js";
import { validate } from "./validate.js";

export type Change =
  | { type: "shift"; target: string; deltaMin: number }
  | { type: "set_serve_time"; serveAt: number }
  | { type: "skip_dish"; dish: string }
  | { type: "mark_done"; stepId?: string };

export interface ReplanResult {
  plan: Plan;
  alternatives: Record<string, Plan>;
}

function fromPlan(plan: Plan): WStep[] {
  return plan.steps.map((s) => ({
    id: s.id,
    dishId: s.dishId,
    dishName: s.dishName ?? s.dishId,
    shortDish: s.shortDish ?? s.dishId,
    summaryOrder: s.summaryOrder ?? 50,
    glaze: "",
    fg: "",
    name: s.name,
    detail: s.detail ?? s.name,
    kind: s.kind,
    baseMinutes: s.baseMinutes ?? s.minutes,
    duration: s.minutes,
    minMinutes: s.minMinutes ?? s.minutes,
    maxMinutes: s.maxMinutes ?? s.minutes,
    ovenTempF: s.ovenTempF,
    appliedTempF: s.appliedTempF ?? s.ovenTempF,
    tempFlexible: s.tempFlexible ?? false,
    hands: s.hands,
    after: s.after.map((a) => ({ stepId: a.stepId, lagMin: a.lagMin ?? 0, maxLagMin: a.maxLagMin })),
    holdMin: s.holdMin,
    spanToServe: s.kind === "hold",
    status: s.status,
    pin: false,
    start: epochToLocalMin(s.startAt, plan.day),
    end: epochToLocalMin(s.endAt, plan.day),
    rack: s.resource.kind === "oven" ? s.resource.rack : undefined,
    burner: s.resource.kind === "burner" ? s.resource.n : undefined,
    adjustedNote: s.adjustedNote,
    source: s.source,
    timeMissing: s.timeMissing,
    offsetOf: s.offsetOf,
    offsetMin: s.offsetMin,
  }));
}

function stamp(steps: WStep[], nowMin: number): void {
  for (const s of steps) {
    if (!isPlaced(s) || s.status === "skipped") continue;
    if (s.end <= nowMin + 0.01) s.status = "done";
    else if (s.start <= nowMin + 0.01) s.status = "running";
    else s.status = "pending";
    s.pin = s.status === "done" || s.status === "running";
  }
}

function matchDish(s: WStep, target: string): boolean {
  const t = target.toLowerCase();
  return s.dishId === t || s.shortDish.toLowerCase() === t || s.dishName.toLowerCase() === t || s.id === target || s.id.endsWith(`.${t}`);
}

export function findTarget(steps: WStep[], target: string): WStep | undefined {
  const t = target.toLowerCase();
  if (t === "current") {
    return steps.find((s) => s.status === "running" && s.hands > 0)
      ?? steps.find((s) => s.status === "running")
      ?? steps.find((s) => s.status === "pending" && s.kind !== "hold");
  }
  const hits = steps.filter((s) => matchDish(s, target) && s.status !== "skipped" && s.kind !== "hold" && s.kind !== "check");
  return hits.find((s) => s.status === "running" && s.kind === "oven")
    ?? hits.find((s) => s.kind === "oven" && s.status !== "done")
    ?? hits.find((s) => s.status === "running")
    ?? hits.find((s) => s.status === "pending");
}

function ctxFrom(plan: Plan, now: number, serveMin: number, mode: ScheduleCtx["mode"], relax = false): ScheduleCtx {
  return {
    mealId: plan.mealId,
    version: plan.version + 1,
    createdAt: now,
    day: plan.day,
    serveMin,
    nowMin: epochToLocalMin(now, plan.day),
    cooks: plan.cooks,
    racks: plan.racks,
    burners: plan.burners,
    relaxHold: relax,
    mode,
  };
}

function attempt(steps: WStep[], ctx: ScheduleCtx): Plan | undefined {
  const trial = structuredClone(steps);
  if (!placeAll(trial, ctx)) return undefined;
  const plan = toPlan(trial, ctx);
  const v = validate(plan, {
    now: localMinToEpoch(ctx.nowMin, ctx.day),
    racks: ctx.racks,
    burners: ctx.burners,
    cooks: ctx.cooks,
    relaxHold: ctx.relaxHold,
  });
  return v.ok ? plan : undefined;
}

function lateDishIds(plan: Plan, serveMin: number): string[] {
  const by = new Map<string, number>();
  for (const s of plan.steps) {
    if (s.status === "skipped") continue;
    const end = epochToLocalMin(s.endAt, plan.day);
    by.set(s.dishId, Math.max(by.get(s.dishId) ?? 0, end));
  }
  return [...by.entries()].filter(([, end]) => end > serveMin + 0.5).map(([id]) => id).sort();
}

export function replan(prev: Plan, change: Change, now: number): ReplanResult {
  let steps = fromPlan(prev);
  const nowMin = epochToLocalMin(now, prev.day);
  stamp(steps, nowMin);
  let serveMin = epochToLocalMin(prev.serveAt, prev.day);
  const mode: ScheduleCtx["mode"] = change.type === "shift" ? "late" : "compact";
  let shift: { dish: string; deltaMin: number } | undefined;

  if (change.type === "set_serve_time") {
    serveMin = epochToLocalMin(change.serveAt, prev.day);
  } else if (change.type === "skip_dish") {
    const t = change.dish.toLowerCase();
    const hit = steps.find((s) => matchDish(s, t));
    const dishId = hit?.dishId ?? t;
    steps = steps.filter((s) => s.dishId !== dishId);
    const ids = new Set(steps.map((s) => s.id));
    for (const s of steps) s.after = s.after.filter((a) => ids.has(a.stepId));
  } else if (change.type === "mark_done") {
    const step = change.stepId ? steps.find((s) => s.id === change.stepId || s.id.endsWith(`.${change.stepId}`)) : findTarget(steps, "current");
    if (step) {
      if (step.start > nowMin) step.start = nowMin;
      step.end = Math.max(step.start, Math.min(step.end, nowMin));
      step.duration = Math.max(1, step.end - step.start);
      step.status = "done";
      step.pin = true;
    }
  } else if (change.type === "shift") {
    const step = findTarget(steps, change.target);
    if (step) {
      shift = { dish: step.dishId, deltaMin: change.deltaMin };
      if (step.status === "running") {
        step.duration += change.deltaMin;
        step.end += change.deltaMin;
        step.maxMinutes = Math.max(step.maxMinutes, step.duration);
        step.pin = true;
      } else if (step.status === "pending") {
        step.notBefore = step.start + change.deltaMin;
        step.pin = false;
      }
    }
  }

  const baseCtx = ctxFrom(prev, now, serveMin, mode);
  let plan: Plan | undefined;
  const restIds = steps.filter((s) => s.kind === "rest" && !s.pin).map((s) => s.id);
  const durChoices = (trial: WStep[]): number[][] => {
    if (restIds.length === 0) return [[]];
    const rest = trial.find((s) => s.id === restIds[0]);
    if (!rest) return [[]];
    const ds: number[] = [];
    for (let d = rest.maxMinutes; d >= rest.minMinutes; d -= 5) ds.push(d);
    return ds.map((d) => [d]);
  };

  const seed = structuredClone(steps);
  for (let delta = 0; delta <= 12 * 60 && !plan; delta += 5) {
    for (const choice of durChoices(seed)) {
      const trial = structuredClone(seed);
      const rest = restIds[0] ? trial.find((s) => s.id === restIds[0]) : undefined;
      if (rest && choice[0] != null) {
        rest.duration = choice[0];
        rest.detail = `Rest · ${choice[0]} min`;
      }
      const ctx = { ...baseCtx, serveMin: serveMin + delta, mode };
      plan = attempt(trial, ctx);
      if (plan) break;
    }
  }

  if (!plan) {
    const ctx = { ...baseCtx, mode, relaxHold: true };
    const trial = structuredClone(seed);
    if (placeAll(trial, ctx)) plan = toPlan(trial, ctx);
    else plan = structuredClone(prev);
  }

  const alternatives: Record<string, Plan> = {};
  if (change.type === "shift" && plan && plan.serveAt !== prev.serveAt) {
    const keepServe = epochToLocalMin(prev.serveAt, prev.day);
    const trial = structuredClone(seed);
    const rest = restIds[0] ? trial.find((s) => s.id === restIds[0]) : undefined;
    if (rest) {
      rest.duration = rest.minMinutes;
      rest.detail = `Rest · ${rest.minMinutes} min`;
    }
    const kept = attempt(trial, { ...baseCtx, serveMin: keepServe, mode: "late", relaxHold: true });
    if (kept) {
      const late = lateDishIds(kept, keepServe);
      const label = late.includes("rolls")
        ? `Keep ${formatKeep(keepServe)}, rolls come late`
        : `Keep ${formatKeep(keepServe)}`;
      alternatives.keep_serve_time = kept;
      plan.options = [
        { id: "move_serve_time", label: "Sounds good", serveAt: plan.serveAt, lateDishes: [] },
        { id: "keep_serve_time", label, serveAt: prev.serveAt, lateDishes: late },
      ];
      plan.choicePending = true;
    }
  }

  plan.changes = diffPlans(prev, plan);
  if (shift) plan.summary = summarize(prev, plan, shift);
  else if (plan.serveAt !== prev.serveAt && change.type !== "set_serve_time") {
    plan.summary = earliestServeSummary(steps.find((s) => s.kind === "oven")?.dishName ?? "Dinner", epochToLocalMin(plan.serveAt, plan.day));
  } else if (change.type === "set_serve_time") {
    plan.summary = `Dinner moves to ${formatKeep(epochToLocalMin(plan.serveAt, plan.day))}.`;
  }
  plan.warnings = plan.steps.filter((s) => s.adjustedNote).map((s) => `${s.dishName ?? s.dishId}: ${s.adjustedNote}`);
  return { plan, alternatives };
}

function formatKeep(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  let h = Math.floor(m / 60);
  const mm = m % 60;
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${String(mm).padStart(2, "0")}`;
}
