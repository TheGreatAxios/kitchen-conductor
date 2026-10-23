import type { Clock, Plan, PlanView, ScheduledStep } from "./types.js";
import { epochToLocalMin, formatClock, formatSpeech } from "./time.js";

export interface ViewOpts {
  title: string;
  glazes: { id: string; name: string; glaze: string; fg: string }[];
  heard?: string;
  clock: Clock;
  canUndo?: boolean;
  ghost?: Plan;
  fired?: string[];
  banner?: string;
}

function local(plan: Plan, epoch: number): number {
  return epochToLocalMin(epoch, plan.day);
}

function dishOf(step: ScheduledStep): string {
  return step.dishName ?? step.dishId;
}

function handsHint(hands: number): string {
  if (hands >= 2) return "both hands";
  if (hands === 1) return "one hand";
  return "";
}

interface Beat {
  at: number;
  label: string;
  hint: string;
  stepId: string;
}

function beats(plan: Plan, now: number): Beat[] {
  const out: Beat[] = [];
  for (const s of plan.steps) {
    if (s.status === "skipped" || s.status === "done" || s.kind === "hold") continue;
    if (s.hands > 0 && s.startAt > now - 1000) {
      const name = s.name.toLowerCase().startsWith(dishOf(s).toLowerCase()) ? s.name : `${s.name}`;
      out.push({ at: s.startAt, label: name, hint: handsHint(s.hands), stepId: s.id });
    } else if (s.hands === 0 && (s.kind === "oven" || s.kind === "stovetop" || s.kind === "rest") && s.endAt > now - 1000) {
      const hint = s.kind === "stovetop" && s.resource.kind === "burner"
        ? `burner ${s.resource.n}`
        : s.kind === "rest" ? "resting" : "keep warm";
      const label = s.kind === "rest" ? `${dishOf(s)} rested` : s.kind === "oven" ? `${dishOf(s)} out` : `${dishOf(s)} on`;
      if (s.kind === "stovetop") {
        out.push({ at: s.startAt, label: `${dishOf(s)} on`, hint, stepId: s.id + "#on" });
      }
      out.push({ at: s.endAt, label, hint, stepId: s.id + "#end" });
    }
  }
  out.sort((a, b) => a.at - b.at || a.label.localeCompare(b.label));
  return out;
}

function ovenTemp(plan: Plan, now: number): number | undefined {
  const hit = plan.ovenPhases.find((p) => !p.ramp && p.startAt <= now && now < p.endAt);
  return hit?.tempF;
}

/** Card copy for one plan. The Thanksgiving screen at 3:12 PM reads "Stuffing goes in". */
export function buildView(plan: Plan, now: number, opts: ViewOpts): PlanView {
  const serveMin = local(plan, plan.serveAt);
  const upcoming = beats(plan, now).filter((b) => b.at >= now - 1000);
  const nextOven = plan.steps
    .filter((s) => s.kind === "oven" && s.status !== "skipped" && s.startAt > now)
    .sort((a, b) => a.startAt - b.startAt)[0];
  const runningHands = plan.steps
    .filter((s) => s.hands > 0 && s.status !== "skipped" && s.startAt <= now && s.endAt > now)
    .sort((a, b) => a.endAt - b.endAt)[0];

  let headline = "On plan";
  let meta = plan.summary || "The oven, the burners, and both hands are on one timeline.";
  let countdownTo = plan.serveAt;
  let countdownWhat = `Dinner ${formatSpeech(serveMin)}`;
  let countdownSub = "";

  if (plan.choicePending) {
    headline = `Dinner moves to ${formatSpeech(serveMin)}`;
    meta = plan.summary;
    const next = upcoming[0];
    if (next) {
      countdownTo = next.at;
      countdownWhat = next.label;
      countdownSub = `at ${formatSpeech(local(plan, next.at))}${next.hint ? ` · ${next.hint}` : ""}`;
    }
  } else if (nextOven && nextOven.startAt - now <= 20 * 60_000) {
    headline = `${dishOf(nextOven)} goes in`;
    const rack = nextOven.resource.kind === "oven" ? nextOven.resource.rack : undefined;
    const applied = nextOven.appliedTempF ?? nextOven.ovenTempF;
    const extra = nextOven.baseMinutes != null ? nextOven.minutes - nextOven.baseMinutes : 0;
    if (nextOven.adjustedNote && nextOven.ovenTempF && applied && extra > 0) {
      meta = `Rack ${rack ?? 2}, beside the turkey at ${applied}°F. Recipe says ${nextOven.ovenTempF}°; it gets ${extra} extra minutes instead.`;
    } else if (applied) {
      meta = rack ? `Rack ${rack} at ${applied}°F.` : `${applied}°F.`;
    }
    countdownTo = nextOven.startAt;
    countdownWhat = `until ${formatClock(local(plan, nextOven.startAt))}`;
    const then = upcoming.find((b) => b.at > nextOven.startAt && b.stepId !== nextOven.id);
    countdownSub = then ? `then ${then.label.toLowerCase()} at ${formatSpeech(local(plan, then.at))}` : "";
  } else if (runningHands) {
    headline = runningHands.name;
    meta = runningHands.detail ?? runningHands.adjustedNote ?? meta;
    countdownTo = runningHands.endAt;
    countdownWhat = runningHands.name;
    countdownSub = handsHint(runningHands.hands);
  } else if (upcoming[0]) {
    headline = upcoming[0].label;
    countdownTo = upcoming[0].at;
    countdownWhat = upcoming[0].label;
    countdownSub = upcoming[0].hint;
  }

  const skipDish = (runningHands ?? nextOven)?.dishId;
  const skipName = (runningHands ?? nextOven)?.shortDish ?? skipDish;
  const chips: PlanView["chips"] = [];
  if (plan.choicePending && plan.options.length) {
    for (const o of plan.options) {
      chips.push({
        id: o.id,
        label: o.label,
        style: o.id === "move_serve_time" ? "primary" : "default",
        tool: "choose_option",
        args: { mealId: plan.mealId, optionId: o.id },
      });
    }
    chips.push({ id: "undo", label: "Undo", style: "ghost", tool: "undo", args: { mealId: plan.mealId } });
  } else {
    const current = runningHands ?? plan.steps.find((s) => s.status === "running" && s.hands > 0);
    chips.push({
      id: "done",
      label: "Done",
      style: "primary",
      tool: "mark_done",
      args: { mealId: plan.mealId, ...(current ? { stepId: current.id } : {}) },
    });
    chips.push({
      id: "plus5",
      label: "5 more minutes",
      style: "default",
      tool: "shift",
      args: { mealId: plan.mealId, target: "current", deltaMin: 5 },
    });
    if (skipDish) {
      chips.push({
        id: "skip",
        label: `Skip ${skipName}`,
        style: "skip",
        tool: "skip_dish",
        args: { mealId: plan.mealId, dish: skipDish },
      });
    }
  }

  const shown = new Set<string>();
  if (!plan.choicePending && nextOven) shown.add(nextOven.id);
  const upNext = upcoming
    .filter((b) => !shown.has(b.stepId) && !shown.has(b.stepId.replace(/#.*$/, "")))
    .filter((b) => plan.choicePending || b.at !== countdownTo)
    .slice(0, 3)
    .map((b) => ({ atMin: local(plan, b.at), label: b.label, hint: b.hint }));

  const ghosts = opts.ghost
    ? plan.steps.flatMap((s) => {
        const old = opts.ghost!.steps.find((g) => g.id === s.id);
        if (!old || (old.startAt === s.startAt && old.endAt === s.endAt)) return [];
        return [{ stepId: s.id, startAt: old.startAt, endAt: old.endAt }];
      })
    : undefined;

  const heard = Boolean(opts.heard);
  const sec = Math.max(0, Math.round((countdownTo - now) / 1000));

  return {
    ...plan,
    now,
    nextStepId: upcoming[0]?.stepId,
    ovenTempNow: ovenTemp(plan, now),
    minutesToServe: Math.max(0, Math.round((plan.serveAt - now) / 60_000)),
    title: opts.title,
    headline,
    meta,
    countdownSec: sec,
    countdownTo,
    countdownWhat,
    countdownSub,
    upNext,
    chips,
    listening: opts.heard ? `“${opts.heard}”` : "Say “the turkey’s running late”",
    heard,
    screen: "timeline",
    glazes: opts.glazes,
    ghosts,
    previousServeAt: opts.ghost && opts.ghost.serveAt !== plan.serveAt ? opts.ghost.serveAt : undefined,
    clock: opts.clock,
    canUndo: Boolean(opts.canUndo),
    banner: opts.banner,
    fired: opts.fired ?? [],
  };
}
