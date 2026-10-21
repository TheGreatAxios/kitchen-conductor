import type { Plan, ScheduledStep } from "@kc/core";
import { epochToLocalMin } from "@kc/core";
import { rampMinutes } from "./oven.js";

export interface ValidateIssue {
  code: "hands" | "burners" | "racks" | "rack-id" | "oven-temp" | "ramp" | "lag" | "hold" | "before-now" | "burner-id";
  message: string;
  stepId?: string;
}

export interface ValidateCtx {
  now: number;
  racks: number;
  burners: number;
  cooks: number;
  relaxHold?: boolean;
}

function active(steps: ScheduledStep[]): ScheduledStep[] {
  return steps.filter((s) => s.status !== "skipped");
}

export function validate(plan: Plan, ctx: ValidateCtx): { ok: boolean; issues: ValidateIssue[] } {
  const issues: ValidateIssue[] = [];
  const steps = active(plan.steps);
  const day = plan.day;
  const nowMin = epochToLocalMin(ctx.now, day);
  const serveMin = epochToLocalMin(plan.serveAt, day);
  const cap = ctx.cooks * 2;

  const ev: { t: number; hands: number; burners: number; racks: number }[] = [];
  for (const s of steps) {
    const a = epochToLocalMin(s.startAt, day);
    const b = epochToLocalMin(s.endAt, day);
    const burner = s.resource.kind === "burner" ? 1 : 0;
    const rack = s.kind === "oven" ? 1 : 0;
    ev.push({ t: a, hands: s.hands, burners: burner, racks: rack });
    ev.push({ t: b, hands: -s.hands, burners: -burner, racks: -rack });
  }
  ev.sort((x, y) => x.t - y.t || (x.hands + x.burners + x.racks) - (y.hands + y.burners + y.racks));
  let hands = 0, burners = 0, racks = 0;
  for (const e of ev) {
    hands += e.hands;
    burners += e.burners;
    racks += e.racks;
    if (hands > cap) issues.push({ code: "hands", message: `Hands ${hands} exceed ${cap} at minute ${e.t}` });
    if (burners > ctx.burners) issues.push({ code: "burners", message: `Burners ${burners} exceed ${ctx.burners}` });
    if (racks > ctx.racks) issues.push({ code: "racks", message: `Oven steps ${racks} exceed ${ctx.racks} racks` });
  }

  for (const s of steps) {
    const a = epochToLocalMin(s.startAt, day);
    const b = epochToLocalMin(s.endAt, day);
    if (s.status === "pending" && a < nowMin - 0.01) {
      issues.push({ code: "before-now", message: `${s.id} starts before now`, stepId: s.id });
    }
    if (s.resource.kind === "oven" || s.resource.kind === "burner") {
      const key = s.resource.kind === "oven" ? s.resource.rack : s.resource.n;
      for (const o of steps) {
        if (o.id === s.id || o.resource.kind !== s.resource.kind) continue;
        const oKey = o.resource.kind === "oven" ? o.resource.rack : o.resource.n;
        if (oKey !== key) continue;
        const oa = epochToLocalMin(o.startAt, day);
        const ob = epochToLocalMin(o.endAt, day);
        if (a < ob && oa < b && o.id > s.id) {
          issues.push({
            code: s.resource.kind === "oven" ? "rack-id" : "burner-id",
            message: `${s.id} overlaps ${o.id} on the same ${s.resource.kind}`,
            stepId: s.id,
          });
        }
      }
    }
    if (s.kind === "oven") {
      const phase = plan.ovenPhases.find((p) => !p.ramp && !p.preheat && epochToLocalMin(p.startAt, day) <= a + 0.01 && epochToLocalMin(p.endAt, day) >= b - 0.01);
      const temp = s.appliedTempF ?? s.ovenTempF;
      if (!phase || (temp != null && phase.tempF !== temp)) {
        issues.push({ code: "oven-temp", message: `${s.id} is outside a ${temp}°F phase`, stepId: s.id });
      } else if (!s.tempFlexible && s.ovenTempF != null && phase.tempF !== s.ovenTempF) {
        issues.push({ code: "oven-temp", message: `${s.id} is not flexible and left ${s.ovenTempF}°F`, stepId: s.id });
      } else if (s.tempFlexible && s.ovenTempF != null && Math.abs(phase.tempF - s.ovenTempF) > 50) {
        issues.push({ code: "oven-temp", message: `${s.id} is more than 50°F off its recipe`, stepId: s.id });
      }
      const hitsRamp = plan.ovenPhases.some((p) => {
        if (!p.ramp && !p.preheat) return false;
        const ps = epochToLocalMin(p.startAt, day);
        const pe = epochToLocalMin(p.endAt, day);
        return a < pe && ps < b;
      });
      if (hitsRamp) issues.push({ code: "ramp", message: `${s.id} overlaps a ramp or preheat`, stepId: s.id });
    }
    for (const link of s.after) {
      const p = steps.find((x) => x.id === link.stepId);
      if (!p) continue;
      const pend = epochToLocalMin(p.endAt, day);
      const lag = link.lagMin ?? 0;
      if (a < pend + lag - 0.01) {
        issues.push({ code: "lag", message: `${s.id} starts before ${p.id} lag ${lag}`, stepId: s.id });
      }
      if (link.maxLagMin != null && a > pend + link.maxLagMin + 0.01) {
        issues.push({ code: "lag", message: `${s.id} exceeds max lag after ${p.id}`, stepId: s.id });
      }
    }
  }

  // Ramp gaps between cooking phases must be long enough.
  const cooking = plan.ovenPhases.filter((p) => !p.ramp && !p.preheat).slice().sort((a, b) => a.startAt - b.startAt);
  for (let i = 1; i < cooking.length; i++) {
    const prev = cooking[i - 1]!;
    const cur = cooking[i]!;
    if (prev.tempF === cur.tempF) continue;
    const gap = epochToLocalMin(cur.startAt, day) - epochToLocalMin(prev.endAt, day);
    const need = rampMinutes(prev.tempF, cur.tempF);
    if (gap + 0.01 < need) {
      issues.push({ code: "ramp", message: `Ramp ${prev.tempF}→${cur.tempF} needs ${need} min, gap is ${gap}` });
    }
  }

  if (!ctx.relaxHold) {
    const byDish = new Map<string, ScheduledStep[]>();
    for (const s of steps) {
      const list = byDish.get(s.dishId) ?? [];
      list.push(s);
      byDish.set(s.dishId, list);
    }
    for (const [dish, list] of byDish) {
      const declared = list.map((s) => s.holdMin).filter((n): n is number => n != null);
      if (declared.length === 0) continue;
      const hold = Math.max(...declared);
      const final = list.reduce((a, b) => (a.endAt > b.endAt ? a : b));
      const cookingEnd = list.filter((s) => s.kind !== "hold").reduce((m, s) => Math.max(m, s.endAt), 0);
      const finalMin = epochToLocalMin(final.endAt, day);
      const cookMin = cookingEnd ? epochToLocalMin(cookingEnd, day) : finalMin;
      if (finalMin < serveMin - hold - 0.01 || finalMin > serveMin + 0.01) {
        issues.push({ code: "hold", message: `${dish} finishes at ${finalMin}, outside [${serveMin - hold}, ${serveMin}]`, stepId: final.id });
      }
      if (finalMin - cookMin > hold + 0.01) {
        issues.push({ code: "hold", message: `${dish} is held longer than ${hold} min`, stepId: final.id });
      }
    }
  }

  // Report each distinct rule once per step.
  const seen = new Set<string>();
  const uniq = issues.filter((i) => {
    const k = `${i.code}|${i.stepId ?? ""}|${i.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { ok: uniq.length === 0, issues: uniq };
}
