import { describe, expect, it } from "vitest";
import { COOK_SCRIPT, NARRATION, pickVoice } from "../src/voices.js";

const voices = [
  { name: "Samantha", lang: "en-US" },
  { name: "Google US English", lang: "en-US" },
  { name: "Microsoft Jenny", lang: "en-US" },
  { name: "Daniel", lang: "en-GB" },
];

describe("browser voices", () => {
  it("picks a conductor, a different cook, and a male narrator", () => {
    expect(pickVoice(voices, "conductor")?.name).toBe("Google US English");
    expect(pickVoice(voices, "cook", "Samantha")?.name).toBe("Microsoft Jenny");
    expect(pickVoice(voices, "narrator")?.name).toBe("Daniel");
  });

  it("the cook script is the four demo lines", () => {
    expect(COOK_SCRIPT.map((l) => l.say)).toEqual([
      "We're making turkey, stuffing, potatoes, green beans, gravy and rolls. We eat at five.",
      "The turkey's running thirty minutes late.",
      "Sounds good.",
      "Add what I'm missing to my list.",
    ]);
    expect(NARRATION.at(-1)?.say).toBe("Kitchen Conductor. Dinner, on time.");
  });
});
