import type { OvenPhase, Plan, Resource, ScheduledStep } from "@kc/core";
import { localMinToEpoch } from "@kc/core";
import { compromiseMinutes, preheatMinutes, rampMinutes } from "./oven.js";
import { isPlaced, UNPLACED, type ScheduleCtx, type WStep } from "./types.js";

/** Minutes of air between two both-hands tasks so carving doesn't start on a wet board. */
const HANDS_BREATHER_MIN = 10;

function byId(steps: WStep[], id: string): WStep | undefined {
  return steps.find((s) => s.id === id);
}

function capacity(ctx: ScheduleCtx): number {
  return ctx.cooks * 2;
}

function overlaps(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 < b1 && b0 < a1;
}

function loadDuring(steps: WStep[], start: number, end: number, ignore: string, kind: "hands" | "burner" | "rack"): number {
  const ev: { t: number; d: number }[] = [];
  for (const s of steps) {
    if (s.id === ignore || !isPlaced(s) || s.status === "skipped") continue;
    const add = kind === "hands" ? s.hands : kind === "burner" ? (s.kind === "stovetop" ? 1 : 0) : s.kind === "oven" ? 1 : 0;
    if (!add) continue;
    const a = Math.max(s.start, start);
    const b = Math.min(s.end, end);
    if (a < b) {
      ev.push({ t: a, d: add });
      ev.push({ t: b, d: -add });
    }
  }
  ev.sort((x, y) => x.t - y.t || x.d - y.d);
  let cur = 0;
  let max = 0;
  for (const e of ev) {
    cur += e.d;
    if (cur > max) max = cur;
  }
  return max;
}

function slotFree(step: WStep, start: number, steps: WStep[], ctx: ScheduleCtx): boolean {
  const end = start + step.duration;
  if (start < ctx.nowMin - 0.01 && step.kind !== "hold") return false;
  if (step.notBefore != null && start < step.notBefore - 0.01) return false;
  if (step.hands > 0 && loadDuring(steps, start, end, step.id, "hands") + step.hands > capacity(ctx)) return false;
  if (step.kind === "stovetop" && loadDuring(steps, start, end, step.id, "burner") + 1 > ctx.burners) return false;
  if (step.kind === "oven") {
    if (loadDuring(steps, start, end, step.id, "rack") + 1 > ctx.racks) return false;
    const temp = step.appliedTempF ?? step.ovenTempF;
    for (const o of steps) {
      if (o.id === step.id || o.kind !== "oven" || !isPlaced(o) || o.status === "skipped") continue;
      if (!overlaps(start, end, o.start, o.end)) {
        // Leave a ramp gap when temperatures differ.
        if (temp != null && o.appliedTempF != null && temp !== o.appliedTempF) {
          const ramp = rampMinutes(o.appliedTempF, temp);
          if (start >= o.end && start < o.end + ramp) return false;
          if (o.start >= end && o.start < end + rampMinutes(temp, o.appliedTempF)) return false;
        }
        continue;
      }
      const other = o.appliedTempF ?? o.ovenTempF;
      if (temp == null || other == null || temp !== other) return false;
    }
  }
  return true;
}

function pushLater(step: WStep, start: number, steps: WStep[], ctx: ScheduleCtx): number {
  const limit = ctx.serveMin + 12 * 60;
  for (let t = start; t <= limit; t++) {
    if (slotFree(step, t, steps, ctx)) return t;
  }
  return start;
}

function pushEarlier(step: WStep, desired: number, minStart: number, steps: WStep[], ctx: ScheduleCtx): number {
  for (let t = desired; t >= minStart; t--) {
    if (slotFree(step, t, steps, ctx)) return t;
  }
  return desired;
}

function assignResource(step: WStep, steps: WStep[], ctx: ScheduleCtx): void {
  if (step.kind === "oven") {
    const temp = step.appliedTempF ?? step.ovenTempF;
    for (let rack = 1; rack <= ctx.racks; rack++) {
      const hit = steps.some((o) => o.id !== step.id && o.kind === "oven" && isPlaced(o) && o.rack === rack && o.status !== "skipped" && overlaps(step.start, step.end, o.start, o.end));
      if (!hit) {
        step.rack = rack;
        return;
      }
    }
    step.rack = 1;
    void temp;
    return;
  }
  if (step.kind === "stovetop") {
    for (let n = 1; n <= ctx.burners; n++) {
      const hit = steps.some((o) => o.id !== step.id && o.kind === "stovetop" && isPlaced(o) && o.burner === n && o.status !== "skipped" && overlaps(step.start, step.end, o.start, o.end));
      if (!hit) {
        step.burner = n;
        return;
      }
    }
    step.burner = 1;
  }
}

function predMin(step: WStep, steps: WStep[], ctx: ScheduleCtx): number {
  let start = Math.max(ctx.nowMin, step.notBefore ?? ctx.nowMin);
  for (const a of step.after) {
    const p = byId(steps, a.stepId);
    if (!p || p.status === "skipped" || !isPlaced(p)) continue;
    start = Math.max(start, p.end + a.lagMin);
  }
  return start;
}

function sameDishChain(anchor: WStep, steps: WStep[]): WStep[] {
  const out: WStep[] = [];
  const seen = new Set<string>([anchor.id]);
  const q = [anchor];
  while (q.length) {
    const cur = q.shift()!;
    const next = steps
      .filter((s) => s.dishId === anchor.dishId && s.kind !== "hold" && s.kind !== "check" && !s.offsetOf && s.after.some((a) => a.stepId === cur.id))
      .sort((a, b) => a.id.localeCompare(b.id));
    for (const s of next) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      out.push(s);
      q.push(s);
    }
  }
  return out;
}

function placeChainBackward(anchor: WStep, chain: WStep[], ctx: ScheduleCtx): boolean {
  if (anchor.pin) return placeChainForward(anchor, chain, ctx);
  if (chain.length === 0) {
    anchor.end = ctx.serveMin;
    anchor.start = anchor.end - anchor.duration;
  } else {
    const last = chain[chain.length - 1]!;
    last.end = ctx.serveMin;
    last.start = last.end - last.duration;
    for (let i = chain.length - 2; i >= 0; i--) {
      const s = chain[i]!;
      const succ = chain[i + 1]!;
      const lag = succ.after.find((a) => a.stepId === s.id)?.lagMin ?? 0;
      s.end = succ.start - lag;
      s.start = s.end - s.duration;
    }
    const first = chain[0]!;
    const lag = first.after.find((a) => a.stepId === anchor.id)?.lagMin ?? 0;
    anchor.end = first.start - lag;
    anchor.start = anchor.end - anchor.duration;
  }
  anchor.appliedTempF = anchor.ovenTempF;
  const ready = ctx.nowMin + preheatMinutes(anchor.ovenTempF ?? 350);
  if (anchor.start < ready - 0.01) return false;
  if (anchor.notBefore != null && anchor.start < anchor.notBefore - 0.01) return false;
  for (const s of chain) assignResource(s, [anchor, ...chain], ctx);
  assignResource(anchor, [anchor, ...chain], ctx);
  return true;
}

function placeChainForward(anchor: WStep, chain: WStep[], ctx: ScheduleCtx): boolean {
  let prev = anchor;
  let t = anchor.end;
  for (const s of chain) {
    if (s.pin) {
      prev = s;
      t = s.end;
      continue;
    }
    const lag = s.after.find((a) => a.stepId === prev.id)?.lagMin ?? 0;
    s.start = Math.max(t + lag, ctx.nowMin);
    s.end = s.start + s.duration;
    assignResource(s, chain, ctx);
    prev = s;
    t = s.end;
  }
  return ctx.relaxHold || t <= ctx.serveMin + 0.01;
}

function placeOffsets(steps: WStep[]): void {
  for (const s of steps) {
    if (!s.offsetOf || s.pin || s.status === "skipped") continue;
    const parent = byId(steps, s.offsetOf);
    if (!parent || !isPlaced(parent)) continue;
    s.start = parent.start + (s.offsetMin ?? 0);
    s.end = s.start + s.duration;
  }
}

function placeFlexible(step: WStep, steps: WStep[], ctx: ScheduleCtx): boolean {
  const hosts = steps.filter((s) => s.kind === "oven" && !s.tempFlexible && isPlaced(s) && s.status !== "skipped" && s.id !== step.id);
  const recipe = step.ovenTempF ?? 350;
  let best: { host: WStep; minutes: number } | undefined;
  for (const host of hosts) {
    const phase = host.appliedTempF ?? host.ovenTempF ?? recipe;
    if (!step.tempFlexible && phase !== recipe) continue;
    const c = compromiseMinutes(step.baseMinutes, recipe, phase);
    if (!c.ok) continue;
    if (!best || c.minutes < best.minutes) best = { host, minutes: c.minutes };
  }
  if (best) {
    step.duration = best.minutes;
    step.appliedTempF = best.host.appliedTempF ?? best.host.ovenTempF;
    step.end = best.host.end;
    step.start = step.end - step.duration;
    if (step.start < best.host.start - 0.01) return false;
    if (step.appliedTempF !== recipe) {
      const extra = step.duration - step.baseMinutes;
      step.adjustedNote = `${recipe}°→${step.appliedTempF}°, ${extra >= 0 ? "+" : ""}${extra} min`;
      step.detail = `Bake · ${step.appliedTempF}° (recipe: ${recipe}°)`;
    }
    if (!slotFree(step, step.start, steps, ctx)) return false;
    assignResource(step, steps, ctx);
    return true;
  }
  return placeOwnOven(step, steps, ctx);
}

function placeOwnOven(step: WStep, steps: WStep[], ctx: ScheduleCtx): boolean {
  step.appliedTempF = step.ovenTempF;
  step.duration = step.baseMinutes;
  const others = steps.filter((s) => s.kind === "oven" && isPlaced(s) && s.status !== "skipped" && s.id !== step.id && (s.appliedTempF ?? s.ovenTempF) !== step.appliedTempF);
  const earliest = Math.max(ctx.nowMin + (others.length === 0 ? preheatMinutes(step.ovenTempF ?? 350) : 0), predMin(step, steps, ctx));
  if (others.length === 0) {
    let start = Math.max(earliest, ctx.serveMin - step.duration);
    start = pushLater(step, start, steps, ctx);
    step.start = start;
    step.end = start + step.duration;
    assignResource(step, steps, ctx);
    return true;
  }
  const blocker = others.reduce((a, b) => (a.end > b.end ? a : b));
  const rampAfter = rampMinutes(blocker.appliedTempF ?? blocker.ovenTempF ?? 350, step.appliedTempF ?? 350);
  const afterStart = Math.max(blocker.end + rampAfter, earliest);
  const afterEnd = afterStart + step.duration;
  const windowLo = ctx.serveMin - (step.holdMin ?? 0);
  const fitsAfter = afterEnd <= ctx.serveMin + 0.01 && (step.holdMin == null || afterEnd >= windowLo - 0.01);
  if (fitsAfter) {
    step.start = pushLater(step, afterStart, steps, ctx);
    step.end = step.start + step.duration;
    assignResource(step, steps, ctx);
    return true;
  }
  const first = others.reduce((a, b) => (a.start < b.start ? a : b));
  const rampBefore = rampMinutes(step.appliedTempF ?? 350, first.appliedTempF ?? first.ovenTempF ?? 350);
  let start = first.start - rampBefore - step.duration;
  if (start < earliest) start = earliest;
  if (!slotFree(step, start, steps, ctx)) start = pushLater(step, Math.max(earliest, ctx.nowMin), steps, ctx);
  step.start = start;
  step.end = start + step.duration;
  assignResource(step, steps, ctx);
  return true;
}

function anchorOf(steps: WStep[]): WStep | undefined {
  const ovens = steps
    .filter((s) => s.kind === "oven" && !s.tempFlexible && s.status !== "skipped")
    .sort((a, b) => b.baseMinutes - a.baseMinutes || a.id.localeCompare(b.id));
  return ovens[0];
}

function addHold(step: WStep, steps: WStep[], ctx: ScheduleCtx): void {
  if (steps.some((s) => s.id === `${step.dishId}.hold`)) return;
  const gap = ctx.serveMin - step.end;
  if (gap <= 0 || step.holdMin == null || gap > step.holdMin) return;
  steps.push({
    ...step,
    id: `${step.dishId}.hold`,
    name: "Keep warm",
    detail: "Keep warm",
    kind: "hold",
    hands: 0,
    duration: gap,
    baseMinutes: gap,
    minMinutes: 0,
    maxMinutes: step.holdMin,
    after: [{ stepId: step.id, lagMin: 0 }],
    spanToServe: true,
    start: step.end,
    end: ctx.serveMin,
    pin: true,
    status: "pending",
    offsetOf: undefined,
    rack: undefined,
    burner: undefined,
    ovenTempF: undefined,
    appliedTempF: undefined,
    adjustedNote: undefined,
  });
}

function placeSpan(step: WStep, steps: WStep[], ctx: ScheduleCtx): void {
  const pred = step.after[0] ? byId(steps, step.after[0].stepId) : undefined;
  const start = pred && isPlaced(pred) ? pred.end + (step.after[0]?.lagMin ?? 0) : ctx.nowMin;
  const cap = step.holdMin != null ? start + step.holdMin : ctx.serveMin;
  step.start = start;
  step.end = Math.min(ctx.serveMin, cap);
  step.duration = Math.max(0, step.end - step.start);
  step.pin = true;
}

function successorCap(step: WStep, steps: WStep[]): number | undefined {
  let cap: number | undefined;
  for (const s of steps) {
    if (!isPlaced(s) || s.status === "skipped") continue;
    const link = s.after.find((a) => a.stepId === step.id);
    if (!link) continue;
    const end = s.start - link.lagMin;
    cap = cap == null ? end : Math.min(cap, end);
  }
  return cap;
}

function placeLoose(step: WStep, steps: WStep[], ctx: ScheduleCtx, slide: boolean): void {
  if (step.spanToServe) {
    placeSpan(step, steps, ctx);
    return;
  }
  const cap = successorCap(step, steps);
  if (cap != null) {
    const minStart = predMin(step, steps, ctx);
    let start = cap - step.duration;
    if (start < minStart) start = minStart;
    if (!slotFree(step, start, steps, ctx)) start = pushLater(step, minStart, steps, ctx);
    step.start = start;
    step.end = start + step.duration;
    assignResource(step, steps, ctx);
    return;
  }
  const minStart = predMin(step, steps, ctx);
  let start = pushLater(step, minStart, steps, ctx);
  step.start = start;
  step.end = start + step.duration;
  const hasUnplacedSucc = steps.some((s) => !isPlaced(s) && s.status !== "skipped" && s.after.some((a) => a.stepId === step.id));
  const hasAnySucc = steps.some((s) => s.status !== "skipped" && s.after.some((a) => a.stepId === step.id));
  if (!slide || hasUnplacedSucc || hasAnySucc || step.holdMin == null) {
    assignResource(step, steps, ctx);
    return;
  }
  const windowStart = ctx.serveMin - step.holdMin;
  if (step.end >= windowStart - 0.01) {
    assignResource(step, steps, ctx);
    return;
  }
  const desired = Math.max(minStart, ctx.serveMin - step.duration);
  start = pushEarlier(step, desired, minStart, steps, ctx);
  // pushEarlier may return a busy desired start; walk again only through free slots.
  if (!slotFree(step, start, steps, ctx)) start = pushLater(step, minStart, steps, ctx);
  step.start = start;
  step.end = start + step.duration;
  assignResource(step, steps, ctx);
  if (step.end < ctx.serveMin - 0.01) addHold(step, steps, ctx);
}

function topo(steps: WStep[]): WStep[] {
  const open = steps.filter((s) => s.status !== "skipped");
  const indeg = new Map<string, number>();
  const kids = new Map<string, string[]>();
  for (const s of open) {
    indeg.set(s.id, 0);
    kids.set(s.id, []);
  }
  for (const s of open) {
    for (const a of s.after) {
      if (!indeg.has(a.stepId)) continue;
      indeg.set(s.id, (indeg.get(s.id) ?? 0) + 1);
      kids.get(a.stepId)!.push(s.id);
    }
  }
  const q = open.filter((s) => (indeg.get(s.id) ?? 0) === 0).sort((a, b) => a.id.localeCompare(b.id));
  const out: WStep[] = [];
  while (q.length) {
    q.sort((a, b) => a.id.localeCompare(b.id));
    const s = q.shift()!;
    out.push(s);
    for (const id of kids.get(s.id) ?? []) {
      indeg.set(id, (indeg.get(id) ?? 1) - 1);
      if (indeg.get(id) === 0) {
        const n = open.find((x) => x.id === id);
        if (n) q.push(n);
      }
    }
  }
  for (const s of open) if (!out.includes(s)) out.push(s);
  return out;
}

function pullAncestors(step: WStep, steps: WStep[], ctx: ScheduleCtx): void {
  for (const a of step.after) {
    const p = byId(steps, a.stepId);
    if (!p || p.pin || p.status === "skipped" || p.kind === "oven") continue;
    p.end = step.start - a.lagMin;
    p.start = p.end - p.duration;
    const min = predMin(p, steps.filter((s) => s.id !== p.id), ctx);
    if (p.start < min) {
      const shift = min - p.start;
      p.start += shift;
      p.end += shift;
      step.start += shift;
      step.end += shift;
    }
    assignResource(p, steps, ctx);
    pullAncestors(p, steps, ctx);
  }
}

function placeLateHands(steps: WStep[], ctx: ScheduleCtx, anchor: WStep | undefined, skip: Set<string>): void {
  const carve = anchor
    ? steps.find((s) => s.dishId === anchor.dishId && s.hands >= 2 && s.kind === "prep" && isPlaced(s))
    : undefined;
  const hands = steps.filter((s) => !s.pin && !isPlaced(s) && !skip.has(s.dishId) && s.hands >= 2 && s.status !== "skipped" && s.kind !== "oven" && s.kind !== "check");
  for (const s of hands) {
    const cap = carve && carve.id !== s.id ? carve.start - HANDS_BREATHER_MIN : ctx.serveMin;
    s.end = cap;
    s.start = s.end - s.duration;
    const min = predMin(s, steps, ctx);
    if (s.start < min) {
      s.start = min;
      s.end = s.start + s.duration;
    }
    if (!slotFree(s, s.start, steps, ctx)) {
      s.start = pushEarlier(s, s.start, Math.max(ctx.nowMin, min - 120), steps, ctx);
      s.end = s.start + s.duration;
    }
    assignResource(s, steps, ctx);
    pullAncestors(s, steps, ctx);
  }
}

/**
 * Dishes with no oven step and no link to another dish. Nothing else decides when they cook,
 * so they are placed backward from serve. A dish already under way only counts when running late;
 * otherwise its remaining steps follow on from the finished ones.
 */
function standaloneDishes(steps: WStep[], ctx: ScheduleCtx): Set<string> {
  const dishOf = new Map(steps.map((s) => [s.id, s.dishId]));
  const out = new Set<string>();
  const blocked = new Set<string>();
  for (const s of steps) {
    if (s.status === "skipped") continue;
    out.add(s.dishId);
    if (s.kind === "oven" || s.spanToServe || s.offsetOf || (s.pin && ctx.mode !== "late")) blocked.add(s.dishId);
    for (const a of s.after) {
      const other = dishOf.get(a.stepId);
      if (other != null && other !== s.dishId) {
        blocked.add(s.dishId);
        blocked.add(other);
      }
    }
  }
  for (const id of blocked) out.delete(id);
  return out;
}

/** Place one dish from its last step back toward now, each step as late as its successors allow. */
function placeBackward(dishId: string, steps: WStep[], ctx: ScheduleCtx): void {
  const own = steps.filter((s) => s.dishId === dishId && s.status !== "skipped");
  const open = own.filter((s) => !s.pin);
  for (const s of topo(open).reverse()) {
    let end = ctx.serveMin;
    for (const o of open) {
      const link = o.after.find((a) => a.stepId === s.id);
      if (link && isPlaced(o)) end = Math.min(end, o.start - link.lagMin);
    }
    const minStart = predMin(s, steps, ctx);
    const start = pushEarlier(s, end - s.duration, minStart, steps, ctx);
    if (start < minStart - 0.01 || !slotFree(s, start, steps, ctx)) {
      for (const o of open) {
        o.start = UNPLACED;
        o.end = UNPLACED;
      }
      return;
    }
    s.start = start;
    s.end = start + s.duration;
    assignResource(s, steps, ctx);
  }
  const last = open.filter((s) => !own.some((o) => o.after.some((a) => a.stepId === s.id)));
  for (const s of last) if (s.end < ctx.serveMin - 0.01) addHold(s, steps, ctx);
}

function clearUnpinned(steps: WStep[]): void {
  for (const s of steps) {
    if (s.pin || s.status === "skipped") continue;
    s.start = UNPLACED;
    s.end = UNPLACED;
  }
}

/** Place every unpinned step. Returns false if the anchor chain cannot finish by serve. */
export function placeAll(steps: WStep[], ctx: ScheduleCtx): boolean {
  clearUnpinned(steps);
  const standalone = standaloneDishes(steps, ctx);
  const anchor = anchorOf(steps);
  if (anchor) {
    const chain = sameDishChain(anchor, steps).filter((s) => !s.pin);
    const ok = anchor.pin ? placeChainForward(anchor, sameDishChain(anchor, steps), ctx) : placeChainBackward(anchor, chain, ctx);
    if (!ok) return false;
    if (!anchor.pin) assignResource(anchor, steps, ctx);
  }
  placeOffsets(steps);
  const flex = steps.filter((s) => s.kind === "oven" && s.tempFlexible && !s.pin && s.status !== "skipped");
  for (const s of flex) {
    if (!placeFlexible(s, steps, ctx)) return false;
  }
  const restOven = steps.filter((s) => s.kind === "oven" && !s.tempFlexible && !isPlaced(s) && s.status !== "skipped");
  for (const s of restOven) placeOwnOven(s, steps, ctx);

  if (ctx.mode === "late") placeLateHands(steps, ctx, anchor, standalone);

  for (const s of topo(steps)) {
    if (s.pin || isPlaced(s) || s.status === "skipped" || standalone.has(s.dishId)) continue;
    placeLoose(s, steps, ctx, ctx.mode === "compact");
  }
  for (const dishId of standalone) placeBackward(dishId, steps, ctx);
  for (const s of topo(steps)) {
    if (s.pin || isPlaced(s) || s.status === "skipped") continue;
    placeLoose(s, steps, ctx, ctx.mode === "compact");
  }
  // Spans and offsets again in case preds landed in the loose pass.
  for (const s of steps) {
    if (!s.pin && s.spanToServe && s.status !== "skipped") placeSpan(s, steps, ctx);
  }
  placeOffsets(steps);
  for (const s of steps) {
    if (!isPlaced(s) || s.status === "skipped") continue;
    if (s.pin && (s.status === "done" || s.status === "running")) continue;
    if (s.end <= ctx.nowMin + 0.01) s.status = "done";
    else if (s.start <= ctx.nowMin + 0.01) s.status = "running";
    else s.status = "pending";
    if (s.kind !== "hold") assignResource(s, steps, ctx);
  }
  return true;
}

export function buildPhases(steps: WStep[]): { tempF: number; start: number; end: number; ramp: boolean; preheat?: boolean; readyAt?: number }[] {
  const ovens = steps.filter((s) => s.kind === "oven" && isPlaced(s) && s.status !== "skipped").sort((a, b) => a.start - b.start);
  if (ovens.length === 0) return [];
  const merged: { temp: number; start: number; end: number }[] = [];
  for (const s of ovens) {
    const temp = s.appliedTempF ?? s.ovenTempF ?? 0;
    const last = merged[merged.length - 1];
    if (last && last.temp === temp && s.start <= last.end + 0.01) last.end = Math.max(last.end, s.end);
    else merged.push({ temp, start: s.start, end: s.end });
  }
  const phases: { tempF: number; start: number; end: number; ramp: boolean; preheat?: boolean; readyAt?: number }[] = [];
  const pre = preheatMinutes(merged[0]!.temp);
  phases.push({ tempF: merged[0]!.temp, start: merged[0]!.start - pre, end: merged[0]!.start, ramp: false, preheat: true, readyAt: merged[0]!.start });
  phases.push({ tempF: merged[0]!.temp, start: merged[0]!.start, end: merged[0]!.end, ramp: false, readyAt: merged[0]!.start });
  for (let i = 1; i < merged.length; i++) {
    const prev = merged[i - 1]!;
    const cur = merged[i]!;
    const ramp = rampMinutes(prev.temp, cur.temp);
    if (ramp > 0) phases.push({ tempF: cur.temp, start: prev.end, end: prev.end + ramp, ramp: true });
    phases.push({ tempF: cur.temp, start: cur.start, end: cur.end, ramp: false, readyAt: cur.start });
  }
  return phases;
}

function resourceOf(s: WStep): Resource {
  if (s.kind === "oven") return { kind: "oven", rack: s.rack ?? 1 };
  if (s.kind === "stovetop") return { kind: "burner", n: s.burner ?? 1 };
  if (s.kind === "hold" || s.kind === "rest") return { kind: "counter" };
  return { kind: "hands" };
}

export function toPlan(steps: WStep[], ctx: ScheduleCtx, extras: Partial<Plan> = {}): Plan {
  const phases = buildPhases(steps);
  const epoch = (min: number) => localMinToEpoch(min, ctx.day);
  const ovenPhases: OvenPhase[] = phases.map((p, i) => ({
    id: `phase-${i}`,
    tempF: p.tempF,
    startAt: epoch(p.start),
    endAt: epoch(p.end),
    ramp: p.ramp,
    preheat: p.preheat,
    readyAt: p.readyAt != null ? epoch(p.readyAt) : undefined,
  }));
  const scheduled: ScheduledStep[] = steps
    .filter((s) => s.status !== "skipped" && isPlaced(s))
    .map((s) => {
      let phaseId: string | undefined;
      if (s.kind === "oven") {
        const hit = phases.findIndex((p) => !p.ramp && !p.preheat && p.start <= s.start + 0.01 && p.end >= s.end - 0.01);
        if (hit >= 0) phaseId = `phase-${hit}`;
      }
      return {
        id: s.id,
        dishId: s.dishId,
        dishName: s.dishName,
        shortDish: s.shortDish,
        summaryOrder: s.summaryOrder,
        name: s.name,
        detail: s.detail,
        kind: s.kind,
        minutes: s.duration,
        baseMinutes: s.baseMinutes,
        minMinutes: s.minMinutes,
        maxMinutes: s.maxMinutes,
        ovenTempF: s.ovenTempF,
        appliedTempF: s.appliedTempF,
        tempFlexible: s.tempFlexible,
        hands: s.hands,
        after: s.after.map((a) => ({ stepId: a.stepId, lagMin: a.lagMin, maxLagMin: a.maxLagMin })),
        holdMin: s.holdMin,
        source: s.source,
        timeMissing: s.timeMissing,
        offsetOf: s.offsetOf,
        offsetMin: s.offsetMin,
        startAt: epoch(s.start),
        endAt: epoch(s.end),
        resource: resourceOf(s),
        ovenPhaseId: phaseId,
        adjustedNote: s.adjustedNote,
        status: s.status,
      };
    })
    .sort((a, b) => a.startAt - b.startAt || a.id.localeCompare(b.id));

  for (const s of scheduled) {
    const w = steps.find((x) => x.id === s.id)!;
    s.status = w.status;
  }

  return {
    mealId: ctx.mealId,
    version: ctx.version,
    serveAt: epoch(ctx.serveMin),
    createdAt: ctx.createdAt,
    day: ctx.day,
    steps: scheduled,
    ovenPhases,
    changes: [],
    options: [],
    summary: "",
    warnings: [],
    cooks: ctx.cooks,
    racks: ctx.racks,
    burners: ctx.burners,
    ...extras,
  };
}

