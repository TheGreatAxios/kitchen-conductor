import type { ListItem, Meal, Plan } from "@kc/core";
import type { RecipeDish } from "@kc/core";

/** Thrown when two writers change the same plan version. Callers retry once. */
export class Conflict extends Error {
  constructor() {
    super("conflict");
    this.name = "Conflict";
  }
}

export interface Saved {
  meal: Meal;
  versions: Plan[];
  alternatives: Record<string, Plan>;
  ghost?: Plan;
  list: ListItem[];
  fired: string[];
}

export interface Store {
  get(mealId: string): Promise<Saved | undefined>;
  create(saved: Saved): Promise<void>;
  save(saved: Saved, expectedVersion: number): Promise<void>;
  bumpCap(day: string): Promise<number>;
  getRecipe(hash: string): Promise<RecipeDish | undefined>;
  putRecipe(hash: string, dish: RecipeDish): Promise<void>;
  allow(ipHash: string, hour: string, limit: number): Promise<boolean>;
}

export class MemoryStore implements Store {
  private meals = new Map<string, Saved>();
  private caps = new Map<string, number>();
  private recipes = new Map<string, RecipeDish>();
  private rates = new Map<string, number>();

  async get(mealId: string): Promise<Saved | undefined> {
    const row = this.meals.get(mealId);
    return row ? structuredClone(row) : undefined;
  }

  async create(saved: Saved): Promise<void> {
    if (this.meals.has(saved.meal.mealId)) throw new Conflict();
    this.meals.set(saved.meal.mealId, structuredClone(saved));
  }

  async remove(mealId: string): Promise<void> {
    this.meals.delete(mealId);
  }

  async save(saved: Saved, expectedVersion: number): Promise<void> {
    const cur = this.meals.get(saved.meal.mealId);
    if (!cur || cur.meal.planVersion !== expectedVersion) throw new Conflict();
    this.meals.set(saved.meal.mealId, structuredClone(saved));
  }

  async bumpCap(day: string): Promise<number> {
    const n = (this.caps.get(day) ?? 0) + 1;
    this.caps.set(day, n);
    return n;
  }

  async getRecipe(hash: string): Promise<RecipeDish | undefined> {
    const d = this.recipes.get(hash);
    return d ? structuredClone(d) : undefined;
  }

  async putRecipe(hash: string, dish: RecipeDish): Promise<void> {
    this.recipes.set(hash, structuredClone(dish));
  }

  async allow(ipHash: string, hour: string, limit: number): Promise<boolean> {
    const key = `${ipHash}#${hour}`;
    const n = (this.rates.get(key) ?? 0) + 1;
    this.rates.set(key, n);
    return n <= limit;
  }
}
