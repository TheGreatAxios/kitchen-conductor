import { describe, expect, it } from "vitest";
import { homeModel, renderScreen } from "../src/render.js";

describe("card", () => {
  it("renders the home chip that plans Thanksgiving", () => {
    const html = renderScreen(homeModel());
    expect(html).toContain("What&#39;s for dinner?");
    expect(html).toContain("Plan Thanksgiving at 5:00");
    expect(html).toContain("data-tool=\"plan_meal\"");
    expect(html).toContain("kc-screen");
  });
});
