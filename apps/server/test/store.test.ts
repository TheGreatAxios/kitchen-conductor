import { describe, expect, it } from "vitest";
import { Kitchen } from "../src/kitchen.js";
import { Conflict, MemoryStore, type Saved } from "../src/store.js";

describe("memory store", () => {
  it("rejects a stale plan version and replaces the demo seed", async () => {
    const store = new MemoryStore();
    const saved = { meal: { mealId: "m", planVersion: 1 }, versions: [], alternatives: {}, list: [], fired: [] } as unknown as Saved;
    await store.create(saved);
    await expect(store.save(saved, 0)).rejects.toBeInstanceOf(Conflict);
    await store.save({ ...saved, meal: { ...saved.meal, planVersion: 2 } }, 1);

    const kitchen = new Kitchen(store, null);
    const first = await kitchen.seed();
    const second = await kitchen.seed();
    expect(first.view.mealId).toBe("demo");
    expect(second.view.headline).toBe("Stuffing goes in");
    expect(second.view.mealId).toBe("demo");
  });
});
