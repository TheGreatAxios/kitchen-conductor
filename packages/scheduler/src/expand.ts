import type { CrossLink, RecipeDish } from "@kc/core";
import { UNPLACED, type WStep } from "./types.js";

export function expand(dishes: RecipeDish[], links: CrossLink[] = []): WStep[] {
  const present = new Set(dishes.map((d) => d.id));
  const steps: WStep[] = [];
  for (const dish of dishes) {
    for (const raw of dish.steps) {
      const id = `${dish.id}.${raw.key}`;
      const base = raw.minutes;
      steps.push({
        id,
        dishId: dish.id,
        dishName: dish.name,
        shortDish: dish.shortName,
        summaryOrder: dish.summaryOrder,
        glaze: dish.glaze,
        fg: dish.fg,
        name: raw.name,
        detail: raw.detail ?? raw.name,
        kind: raw.kind,
        baseMinutes: base,
        duration: base,
        minMinutes: raw.minMinutes ?? base,
        maxMinutes: raw.maxMinutes ?? base,
        ovenTempF: raw.ovenTempF,
        appliedTempF: raw.ovenTempF,
        tempFlexible: raw.tempFlexible ?? false,
        hands: raw.hands,
        after: (raw.after ?? []).map((a) => ({
          stepId: `${dish.id}.${a.key}`,
          lagMin: a.lagMin ?? 0,
          maxLagMin: a.maxLagMin,
        })),
        holdMin: raw.holdMin,
        spanToServe: raw.spanToServe ?? false,
        status: "pending",
        pin: false,
        start: UNPLACED,
        end: UNPLACED,
        source: "library",
      });
      for (const touch of raw.handsAt ?? []) {
        steps.push({
          id: `${dish.id}.${touch.key}`,
          dishId: dish.id,
          dishName: dish.name,
          shortDish: dish.shortName,
          summaryOrder: dish.summaryOrder,
          glaze: dish.glaze,
          fg: dish.fg,
          name: touch.name,
          detail: "",
          kind: "check",
          baseMinutes: touch.minutes,
          duration: touch.minutes,
          minMinutes: touch.minutes,
          maxMinutes: touch.minutes,
          tempFlexible: false,
          hands: touch.hands,
          after: [],
          spanToServe: false,
          offsetOf: id,
          offsetMin: touch.offsetMin,
          status: "pending",
          pin: false,
          start: UNPLACED,
          end: UNPLACED,
          source: "library",
        });
      }
    }
  }
  for (const link of links) {
    if (!present.has(link.dish) || !present.has(link.afterDish)) continue;
    const step = steps.find((s) => s.id === `${link.dish}.${link.step}`);
    if (!step) continue;
    const pred = `${link.afterDish}.${link.afterStep}`;
    if (!step.after.some((a) => a.stepId === pred)) {
      step.after.push({ stepId: pred, lagMin: link.lagMin ?? 0, maxLagMin: link.maxLagMin });
    }
  }
  return steps;
}
