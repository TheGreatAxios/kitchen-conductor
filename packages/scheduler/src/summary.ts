import type { Plan } from "@kc/core";
import { epochToLocalMin, formatSpeech } from "@kc/core";

function listPhrase(words: string[]): string {
  if (words.length <= 1) return words[0] ?? "";
  if (words.length === 2) return `${words[0]} and ${words[1]}`;
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

function cap(s: string): string {
  return s.slice(0, 1).toUpperCase() + s.slice(1);
}

/** One sentence. The turkey +30 demo lands on the fixture line when the sides actually move. */
export function summarize(prev: Plan | undefined, next: Plan, shift?: { dish: string; deltaMin: number }): string {
  if (!shift || shift.deltaMin <= 0) {
    if (prev && next.serveAt !== prev.serveAt) {
      return `Dinner moves to ${formatSpeech(epochToLocalMin(next.serveAt, next.day))}.`;
    }
    return next.summary;
  }
  const prevById = new Map(prev?.steps.map((s) => [s.id, s]) ?? []);
  const moved = new Map<string, { short: string; order: number }>();
  for (const s of next.steps) {
    if (s.kind === "hold" || s.kind === "check" || s.status === "skipped") continue;
    if (s.dishId === shift.dish) continue;
    const o = prevById.get(s.id);
    if (!o || s.startAt <= o.startAt) continue;
    moved.set(s.dishId, { short: s.shortDish ?? s.dishId, order: s.summaryOrder ?? 50 });
  }
  const words = [...moved.values()]
    .sort((a, b) => a.order - b.order || a.short.localeCompare(b.short))
    .map((d) => d.short);
  const sample = next.steps.find((s) => s.dishId === shift.dish);
  const dishName = sample?.dishName ?? cap(shift.dish);
  let text = `${dishName} needs ${shift.deltaMin} more minutes.`;
  if (words.length) text += ` ${listPhrase([cap(words[0]!), ...words.slice(1)])} moved later.`;
  const restPrev = prev?.steps.find((s) => s.dishId === shift.dish && s.kind === "rest");
  const restNext = next.steps.find((s) => s.dishId === shift.dish && s.kind === "rest");
  if (restPrev && restNext && restNext.minutes < restPrev.minutes) {
    text += ` The ${restNext.shortDish ?? shift.dish} rests ${restNext.minutes} minutes instead of ${restPrev.minutes}.`;
  }
  return text;
}

export function earliestServeSummary(dishName: string, serveMin: number): string {
  const ap = ((serveMin % 1440) + 1440) % 1440 >= 12 * 60 ? "PM" : "AM";
  return `${dishName} can't be ready by then. The earliest dinner is ${formatSpeech(serveMin)} ${ap}.`;
}
