import { createHash, randomBytes } from "node:crypto";
import {
  DEMO_DAY,
  buildView,
  formatSpeech,
  localMinToEpoch,
  mealNow,
  parseClock,
  epochToLocalMin,
  type Clock,
  type Dish,
  type ListItem,
  type ListView,
  type Meal,
  type PlanView,
  type RecipeDish,
} from "@kc/core";
import {
  CROSS_LINKS,
  extractRecipe,
  fetchPublicText,
  matchDish,
  parseRecipes,
  thanksgivingDishes,
  type BedrockSender,
} from "@kc/recipes";
import { plan as schedule, replan } from "@kc/scheduler";
import { Conflict, MemoryStore, type Saved } from "./store.js";

export const MISSING = "I can't find that meal. Say 'plan dinner' to start one.";

const CLOCK_WORD: Record<string, number> = {
  four: 16 * 60, five: 17 * 60, six: 18 * 60, seven: 19 * 60, eight: 20 * 60,
};

export class MissingMeal extends Error {
  constructor() {
    super(MISSING);
    this.name = "MissingMeal";
  }
}

export interface PlanInput {
  dishes: { name: string; recipeText?: string; recipeUrl?: string; servings?: number }[];
  serveAt: string;
  cooks?: 1 | 2;
  oven?: { racks?: number };
  burners?: number;
  mealId?: string;
}

function id(): string {
  return randomBytes(16).toString("base64url");
}

function hash(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function clockAt(at = "15:12"): Extract<Clock, { mode: "demo" }> {
  const min = parseClock(at) ?? 15 * 60 + 12;
  return { mode: "demo", anchorReal: Date.now(), anchorMeal: localMinToEpoch(min, DEMO_DAY), speed: 1 };
}

function serveEpoch(text: string): number {
  const bare = text.trim().toLowerCase().replace(/\s*(pm|o'clock|oclock)$/g, "").trim();
  if (CLOCK_WORD[bare] != null) return localMinToEpoch(CLOCK_WORD[bare]!, DEMO_DAY);
  const min = parseClock(text);
  if (min == null) throw new Error("I didn't catch the time. Try 'we eat at five'.");
  return localMinToEpoch(min, DEMO_DAY);
}

function toDish(d: RecipeDish): Dish {
  return {
    id: d.id,
    name: d.name,
    glaze: d.glaze,
    fg: d.fg,
    servings: d.servings,
    ingredients: d.ingredients,
    steps: [],
  };
}

function titleOf(dishes: Dish[]): string {
  const n = dishes.length;
  const noun = n === 1 ? "dish" : "dishes";
  const holiday = dishes.some((d) => d.id === "turkey") ? "Thanksgiving" : "Dinner";
  const same = dishes.every((d) => d.servings && d.servings === dishes[0]?.servings);
  const serves = same && dishes[0]?.servings ? ` · serves ${dishes[0].servings}` : "";
  return `${holiday} · ${n} ${noun}${serves}`;
}

function listFrom(dishes: Dish[]): ListItem[] {
  const map = new Map<string, ListItem>();
  for (const d of dishes) {
    for (const ing of d.ingredients) {
      const key = ing.item.toLowerCase();
      const cur = map.get(key);
      if (!cur) {
        map.set(key, { item: ing.item, quantity: ing.quantity, dishIds: [d.id], have: Boolean(ing.pantry), onList: false });
      } else if (!cur.dishIds.includes(d.id)) {
        cur.dishIds.push(d.id);
      }
    }
  }
  return [...map.values()];
}

function phrase(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function countWord(n: number): string {
  return ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight"][n] ?? String(n);
}

export class Kitchen {
  sends = 0;

  constructor(
    private store: MemoryStore,
    private bedrock: BedrockSender | null,
    private cap = Number(process.env.KC_BEDROCK_DAILY_CAP ?? 300),
  ) {}

  async get(mealId: string): Promise<Saved> {
    const saved = await this.store.get(mealId);
    if (!saved) throw new MissingMeal();
    return saved;
  }

  private now(saved: Saved): number {
    return mealNow(saved.meal.clock);
  }

  private view(saved: Saved, now = this.now(saved)): PlanView {
    const plan = saved.versions.at(-1)!;
    return buildView(plan, now, {
      title: saved.meal.title,
      glazes: saved.meal.dishes.map((d) => ({ id: d.id, name: d.name, glaze: d.glaze, fg: d.fg })),
      heard: saved.meal.heard,
      clock: saved.meal.clock,
      canUndo: saved.versions.length > 1,
      ghost: saved.ghost,
      fired: saved.fired,
    });
  }

  private async write(saved: Saved, expected: number): Promise<void> {
    await this.store.save(saved, expected);
  }

  async seed(): Promise<{ text: string; view: PlanView }> {
    await this.store.remove("demo");
    return this.planMeal({
      mealId: "demo",
      dishes: demoDishes(),
      serveAt: "17:00",
    }, "seed", false);
  }

  async planMeal(input: PlanInput, ip = "local", limit = true): Promise<{ text: string; view: PlanView }> {
    const hour = new Date().toISOString().slice(0, 13);
    if (limit && !(await this.store.allow(hash(ip).slice(0, 12), hour, 30))) {
      throw new Error("That's enough new meals for this hour. The one on screen is still good.");
    }
    const serveAt = serveEpoch(input.serveAt);
    const known: RecipeDish[] = [];
    const unknown: { name: string; text: string }[] = [];
    const warnings: string[] = [];
    for (const raw of input.dishes) {
      const lib = matchDish(raw.name);
      if (lib && !raw.recipeText && !raw.recipeUrl) {
        known.push(structuredClone(lib));
        continue;
      }
      let text = raw.recipeText?.trim() ?? "";
      if (raw.recipeUrl) {
        try {
          const page = await fetchPublicText(raw.recipeUrl);
          const extracted = extractRecipe(page);
          text = extracted
            ? `${extracted.name ?? raw.name}\n${extracted.ingredients.join("\n")}\n${extracted.instructions}`
            : page;
        } catch {
          warnings.push(`I couldn't open a recipe link for ${raw.name}.`);
        }
      }
      if (!text && lib) {
        known.push(structuredClone(lib));
        continue;
      }
      if (!text) {
        warnings.push(`I don't know ${raw.name}. Paste the recipe or pick a dish I know.`);
        continue;
      }
      const cached = await this.store.getRecipe(hash(text));
      if (cached) known.push(cached);
      else unknown.push({ name: raw.name, text });
    }
    if (known.length + unknown.length === 0) throw new Error(warnings[0] ?? "Tell me at least one dish.");
    if (unknown.length) {
      const day = new Date().toISOString().slice(0, 10);
      const n = await this.store.bumpCap(day);
      const sender = n > this.cap ? null : this.bedrock;
      const parsed = await parseRecipes(unknown, sender);
      this.sends += parsed.sends;
      warnings.push(...parsed.warnings);
      for (let i = 0; i < parsed.dishes.length; i++) {
        known.push(parsed.dishes[i]!);
        const src = unknown[i];
        if (src) await this.store.putRecipe(hash(src.text), parsed.dishes[i]!);
      }
    }
    const dishes = known;
    const ids = new Set(dishes.map((d) => d.id));
    const links = CROSS_LINKS.filter((l) => ids.has(l.dish) && ids.has(l.afterDish));
    const nowClock = clockAt();
    // Place the meal from 1:00 PM. The clock the cook sees stays at 3:12.
    const now = localMinToEpoch(13 * 60, DEMO_DAY);
    const mealId = input.mealId ?? id();
    const made = schedule({
      mealId,
      dishes,
      links,
      serveAt,
      now,
      day: DEMO_DAY,
      cooks: input.cooks ?? 1,
      racks: input.oven?.racks ?? 2,
      burners: input.burners ?? 4,
    });
    made.warnings = [...warnings, ...made.warnings];
    const mealDishes = dishes.map(toDish);
    const meal: Meal = {
      mealId,
      title: titleOf(mealDishes),
      tz: "America/Los_Angeles",
      cooks: made.cooks,
      racks: made.racks,
      burners: made.burners,
      dishes: mealDishes,
      planVersion: made.version,
      serveAt: made.serveAt,
      clock: nowClock,
      createdAt: now,
      ttl: Math.floor(now / 1000) + 30 * 24 * 3600,
      day: DEMO_DAY,
      choicePending: made.choicePending,
    };
    const saved: Saved = { meal, versions: [made], alternatives: {}, list: listFrom(mealDishes), fired: [] };
    await this.store.create(saved);
    const first = [...made.steps].filter((s) => s.kind !== "hold").sort((a, b) => a.startAt - b.startAt)[0];
    const serve = formatSpeech(epochToLocalMin(made.serveAt, made.day));
    const firstBit = first
      ? ` First up: ${(first.dishName ?? first.dishId).toLowerCase()} ${first.name.toLowerCase()} at ${formatSpeech(epochToLocalMin(first.startAt, made.day))}.`
      : "";
    const extra = warnings.length ? ` ${warnings[0]}` : "";
    return { text: `Okay. ${countWord(dishes.length)} dishes, dinner at ${serve}.${firstBit}${extra}`, view: this.view(saved, nowClock.anchorMeal) };
  }

  private async edit(mealId: string, apply: (saved: Saved, now: number) => Saved): Promise<Saved> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const saved = await this.get(mealId);
      const expected = saved.meal.planVersion;
      const now = this.now(saved);
      const next = apply(saved, now);
      try {
        await this.write(next, expected);
        return next;
      } catch (err) {
        if (!(err instanceof Conflict) || attempt === 1) throw err;
      }
    }
    throw new Conflict();
  }

  async shift(mealId: string, target: string, deltaMin: number): Promise<{ text: string; view: PlanView }> {
    const saved = await this.edit(mealId, (cur, now) => {
      const prev = cur.versions.at(-1)!;
      const { plan, alternatives } = replan(prev, { type: "shift", target, deltaMin }, now);
      plan.version = prev.version + 1;
      return {
        ...cur,
        versions: [...cur.versions, plan],
        alternatives,
        ghost: prev,
        meal: { ...cur.meal, planVersion: plan.version, serveAt: plan.serveAt, choicePending: plan.choicePending },
      };
    });
    const plan = saved.versions.at(-1)!;
    const keep = plan.options.find((o) => o.id === "keep_serve_time");
    let text = `Got it. ${plan.summary}`;
    if (!text.endsWith(".")) text += ".";
    if (plan.choicePending && keep) {
      const keepAt = formatSpeech(epochToLocalMin(keep.serveAt, plan.day));
      text += ` Want to keep ${keepAt} instead?`;
      if (keep.lateDishes.includes("rolls")) text += " The rolls would come late.";
    }
    return { text, view: this.view(saved) };
  }

  async setServe(mealId: string, serveAt: string): Promise<{ text: string; view: PlanView }> {
    const at = serveEpoch(serveAt);
    const saved = await this.edit(mealId, (cur, now) => {
      const prev = cur.versions.at(-1)!;
      const { plan, alternatives } = replan(prev, { type: "set_serve_time", serveAt: at }, now);
      plan.version = prev.version + 1;
      return {
        ...cur,
        versions: [...cur.versions, plan],
        alternatives,
        ghost: prev,
        meal: { ...cur.meal, planVersion: plan.version, serveAt: plan.serveAt, choicePending: false },
      };
    });
    const plan = saved.versions.at(-1)!;
    return { text: plan.summary || `Dinner moves to ${formatSpeech(epochToLocalMin(plan.serveAt, plan.day))}.`, view: this.view(saved) };
  }

  async choose(mealId: string, optionId: string): Promise<{ text: string; view: PlanView }> {
    const saved = await this.edit(mealId, (cur) => {
      const current = cur.versions.at(-1)!;
      const picked = optionId === "keep_serve_time" ? cur.alternatives.keep_serve_time : current;
      if (!picked) return cur;
      const plan = structuredClone(picked);
      plan.choicePending = false;
      plan.options = [];
      plan.version = current.version;
      const versions = cur.versions.slice();
      versions[versions.length - 1] = plan;
      return {
        ...cur,
        versions,
        alternatives: {},
        meal: { ...cur.meal, serveAt: plan.serveAt, choicePending: false, planVersion: plan.version },
      };
    });
    const plan = saved.versions.at(-1)!;
    const spoken = optionId === "keep_serve_time"
      ? `Keeping ${formatSpeech(epochToLocalMin(plan.serveAt, plan.day))}.`
      : `Dinner stays at ${formatSpeech(epochToLocalMin(plan.serveAt, plan.day))}.`;
    return { text: spoken, view: this.view(saved) };
  }

  async undo(mealId: string): Promise<{ text: string; view: PlanView }> {
    let popped = false;
    const saved = await this.edit(mealId, (cur) => {
      if (cur.versions.length < 2) return cur;
      popped = true;
      const versions = cur.versions.slice(0, -1);
      const plan = versions.at(-1)!;
      return {
        ...cur,
        versions,
        alternatives: {},
        ghost: undefined,
        meal: { ...cur.meal, planVersion: plan.version, serveAt: plan.serveAt, choicePending: false },
      };
    });
    return { text: popped ? "Undone." : "Nothing to undo.", view: this.view(saved) };
  }

  async markDone(mealId: string, stepId?: string): Promise<{ text: string; view: PlanView }> {
    let line = "Done.";
    const saved = await this.edit(mealId, (cur, now) => {
      const prev = cur.versions.at(-1)!;
      let id = stepId;
      if (id && !prev.steps.some((s) => s.id === id)) {
        const hit = prev.steps.find((s) => s.dishId === id || s.dishName?.toLowerCase() === id!.toLowerCase() || s.id.endsWith(`.${id}`));
        const running = prev.steps.find((s) => (s.dishId === hit?.dishId) && s.status === "running" && s.hands > 0);
        id = running?.id ?? hit?.id;
      }
      const { plan } = replan(prev, { type: "mark_done", stepId: id }, now);
      plan.version = prev.version + 1;
      plan.choicePending = false;
      const finished = plan.steps.filter((s) => {
        const old = prev.steps.find((o) => o.id === s.id);
        return old && old.status !== "done" && s.status === "done" && s.kind === "oven" && s.dishId === "stuffing";
      });
      if (stepId === "stuffing" || finished.length) line = "Stuffing's in.";
      return {
        ...cur,
        versions: [...cur.versions, plan],
        alternatives: {},
        ghost: prev,
        meal: { ...cur.meal, planVersion: plan.version, serveAt: plan.serveAt, choicePending: false },
      };
    });
    return { text: line, view: this.view(saved) };
  }

  async skip(mealId: string, dish: string): Promise<{ text: string; view: PlanView }> {
    const saved = await this.edit(mealId, (cur, now) => {
      const prev = cur.versions.at(-1)!;
      const { plan } = replan(prev, { type: "skip_dish", dish }, now);
      plan.version = prev.version + 1;
      return {
        ...cur,
        versions: [...cur.versions, plan],
        alternatives: {},
        ghost: prev,
        meal: {
          ...cur.meal,
          planVersion: plan.version,
          serveAt: plan.serveAt,
          choicePending: false,
          dishes: cur.meal.dishes.filter((d) => d.id !== dish && d.name.toLowerCase() !== dish.toLowerCase()),
        },
      };
    });
    return { text: `${dish.charAt(0).toUpperCase()}${dish.slice(1)} is off the plan.`, view: this.view(saved) };
  }

  async status(mealId: string, focus?: string): Promise<{ text: string; view: PlanView }> {
    const saved = await this.get(mealId);
    const now = this.now(saved);
    const view = this.view(saved, now);
    const steps = view.steps.filter((s) => s.status !== "skipped" && s.status !== "done");
    const focused = focus
      ? steps.find((s) => s.dishId === focus || s.dishName?.toLowerCase() === focus || s.shortDish === focus)
      : undefined;
    const next = focused ?? steps.find((s) => s.hands > 0 && s.startAt >= now) ?? steps.find((s) => s.startAt >= now);
    if (!next) return { text: `Nothing else needs you. Dinner is at ${formatSpeech(epochToLocalMin(view.serveAt, view.day))}.`, view };
    const mins = Math.round((next.startAt - now) / 60_000);
    const when = mins <= 0 ? "now" : `in ${mins} ${mins === 1 ? "minute" : "minutes"}`;
    return { text: `Next is ${next.name.toLowerCase()}, ${when}.`, view };
  }

  async addMissing(mealId: string, items?: string[]): Promise<{ text: string; list: ListView }> {
    const saved = await this.edit(mealId, (cur) => {
      const list = cur.list.map((row) => ({ ...row }));
      const wanted = items?.map((i) => i.toLowerCase());
      for (const row of list) {
        const hit = !wanted || wanted.some((w) => row.item.toLowerCase().includes(w) || w.includes(row.item.toLowerCase()));
        if (hit && !row.have) {
          row.onList = true;
          row.addedAt = row.addedAt ?? Date.now();
        }
      }
      if (wanted) {
        for (const w of items ?? []) {
          if (!list.some((row) => row.item.toLowerCase() === w.toLowerCase())) {
            list.push({ item: w, dishIds: [], have: false, onList: true, addedAt: Date.now() });
          }
        }
      }
      return { ...cur, list };
    });
    const added = saved.list.filter((i) => i.onList && !i.have).map((i) => i.item);
    const named = items?.length ? saved.list.filter((i) => i.onList && items.some((w) => i.item.toLowerCase().includes(w.toLowerCase()))).map((i) => i.item) : added;
    const text = named.length ? `Added ${phrase(named.slice(0, 3))}${named.length > 3 ? ` and ${named.length - 3} more` : ""} to your Kitchen Conductor list.` : "Your list already has those.";
    return { text, list: this.listView(saved, named) };
  }

  async getList(mealId: string): Promise<{ text: string; list: ListView }> {
    const saved = await this.get(mealId);
    const on = saved.list.filter((i) => i.onList).map((i) => i.item);
    const text = on.length ? `On your list: ${phrase(on.slice(0, 6))}.` : "Your list is empty.";
    return { text, list: this.listView(saved, []) };
  }

  async setHave(mealId: string, items: string[], have: boolean): Promise<{ text: string; list: ListView }> {
    const saved = await this.edit(mealId, (cur) => {
      const list = cur.list.map((row) => {
        const hit = items.some((w) => row.item.toLowerCase() === w.toLowerCase() || row.item.toLowerCase().includes(w.toLowerCase()));
        return hit ? { ...row, have, onList: have ? false : row.onList } : row;
      });
      return { ...cur, list };
    });
    return { text: have ? "Marked as in the kitchen." : "Put back on the list.", list: this.listView(saved, []) };
  }

  async remember(mealId: string, heard: string): Promise<void> {
    await this.edit(mealId, (cur) => ({ ...cur, meal: { ...cur.meal, heard } }));
  }

  async setClock(mealId: string, patch: { at?: string; speed?: number; paused?: boolean }): Promise<PlanView> {
    const saved = await this.edit(mealId, (cur) => {
      const prev = cur.meal.clock;
      const anchorMeal = patch.at ? serveEpoch(patch.at) : prev.mode === "demo" ? prev.anchorMeal : this.now(cur);
      const clock: Clock = {
        mode: "demo",
        anchorReal: Date.now(),
        anchorMeal,
        speed: patch.speed ?? (prev.mode === "demo" ? prev.speed : 1),
        paused: patch.paused ?? (prev.mode === "demo" ? prev.paused : false),
      };
      return { ...cur, meal: { ...cur.meal, clock } };
    });
    return this.view(saved);
  }

  async claim(mealId: string, eventId: string): Promise<boolean> {
    let first = false;
    await this.edit(mealId, (cur) => {
      if (cur.fired.includes(eventId)) return cur;
      first = true;
      return { ...cur, fired: [...cur.fired, eventId] };
    });
    return first;
  }

  private listView(saved: Saved, added: string[]): ListView {
    return {
      mealId: saved.meal.mealId,
      screen: "list",
      title: saved.meal.title,
      headline: added.length ? "Added to your list" : "Your list",
      items: saved.list,
      added,
      listening: saved.meal.heard ? `“${saved.meal.heard}”` : "Say “add what I'm missing to my list”",
      heard: Boolean(saved.meal.heard),
      clock: saved.meal.clock,
      now: this.now(saved),
    };
  }
}

export function demoDishes(): { name: string }[] {
  return thanksgivingDishes().map((d) => ({ name: d.name }));
}
