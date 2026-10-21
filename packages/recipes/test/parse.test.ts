import { describe, expect, it } from "vitest";
import { parseRecipes, type BedrockSender } from "../src/parse.js";

const good = JSON.stringify({
  dishes: [{
    name: "Cookies",
    servings: 12,
    ingredients: [{ item: "flour", quantity: "2 cups" }],
    steps: [{ key: "bake", name: "Bake", kind: "oven", minutes: 12, ovenTempF: 375, hands: "none", after: [], tempFlexible: false, holdMinutes: 20 }],
  }],
});

function sender(text: string, fail = false): BedrockSender & { sends: number } {
  return {
    sends: 0,
    async send() {
      this.sends += 1;
      if (fail) throw new Error("nope");
      return { output: { message: { content: [{ text }] } } };
    },
  };
}

describe("parseRecipes", () => {
  it("sends once for an unknown recipe", async () => {
    const live = sender(good);
    const parsed = await parseRecipes([{ name: "Cookies", text: "Bake 12 minutes at 375." }], live);
    expect(live.sends).toBe(1);
    expect(parsed.sends).toBe(1);
    expect(parsed.dishes[0]?.steps[0]?.minutes).toBe(12);
    expect(parsed.dishes[0]?.steps[0]?.ovenTempF).toBe(375);
  });

  it("a stub sender never sends", async () => {
    const parsed = await parseRecipes([{ name: "Cookies", text: "Bake." }], null);
    expect(parsed.sends).toBe(0);
    expect(parsed.dishes[0]?.steps[0]?.minutes).toBe(15);
  });

  it("bad JSON still counts as one send and does not retry", async () => {
    const live = sender("not json");
    const parsed = await parseRecipes([{ name: "Cookies", text: "Bake." }], live);
    expect(live.sends).toBe(1);
    expect(parsed.sends).toBe(1);
    expect(parsed.warnings[0]).toMatch(/couldn't read/);
  });

  it("a thrown call counts as one send", async () => {
    const live = sender("", true);
    const parsed = await parseRecipes([{ name: "Cookies", text: "Bake." }], live);
    expect(live.sends).toBe(1);
    expect(parsed.sends).toBe(1);
  });

  it("an empty batch sends nothing", async () => {
    const live = sender(good);
    const parsed = await parseRecipes([], live);
    expect(parsed.sends).toBe(0);
    expect(live.sends).toBe(0);
  });
});
