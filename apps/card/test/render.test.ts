import { describe, expect, it } from "vitest";
import { fitBarLabel, homeModel, renderScreen } from "../src/render.js";

describe("card", () => {
  it("renders the home chip that plans Thanksgiving", () => {
    const html = renderScreen(homeModel());
    expect(html).toContain("What&#39;s for dinner?");
    expect(html).toContain("Plan Thanksgiving at 5:00");
    expect(html).toContain("data-tool=\"plan_meal\"");
    expect(html).toContain("kc-screen");
  });

  it("keeps a temperature note beside the dish name", () => {
    const wide = fitBarLabel("Stuffing", "Bake", "Bake · 350° (recipe: 375°)", "375°→350°, +10 min", 289, 15);
    expect(wide).toEqual({ label: "Stuffing Bake", note: "375°→350°, +10 min" });
    const peel = fitBarLabel("Potatoes", "Peel", "Peel", "", 78, 13);
    expect(peel.label).toBe("Peel");
    const mash = fitBarLabel("Potatoes", "Mash", "Mash", "", 48, 13);
    expect(mash.label).toBe("Mash");
    const beans = fitBarLabel("Green beans", "Blanch + sauté", "Blanch + sauté", "", 78, 13);
    expect(beans.label).toBe("Green beans");
  });
});
