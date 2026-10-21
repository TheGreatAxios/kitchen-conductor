import type { Plan, PlanChange } from "@kc/core";

export function diffPlans(prev: Plan | undefined, next: Plan): PlanChange[] {
  if (!prev) return [];
  const old = new Map(prev.steps.map((s) => [s.id, s]));
  const changes: PlanChange[] = [];
  for (const s of next.steps) {
    const o = old.get(s.id);
    if (!o || s.status === "skipped" || o.status === "skipped") continue;
    const deltaMin = Math.round((s.startAt - o.startAt) / 60_000);
    const endDelta = Math.round((s.endAt - o.endAt) / 60_000);
    const shown = deltaMin !== 0 ? deltaMin : endDelta;
    if (shown === 0) continue;
    changes.push({ stepId: s.id, oldStartAt: o.startAt, newStartAt: s.startAt, deltaMin: shown });
  }
  changes.sort((a, b) => a.stepId.localeCompare(b.stepId));
  return changes;
}
