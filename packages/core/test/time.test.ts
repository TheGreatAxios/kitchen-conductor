import { describe, expect, it } from "vitest";
import { epochToLocalMin, formatSpeech, hm, localMinToEpoch, parseClock } from "../src/time.js";

describe("time", () => {
  it("round-trips 5:00 PM PST on the demo day", () => {
    const epoch = localMinToEpoch(hm(17, 0));
    expect(epochToLocalMin(epoch)).toBe(hm(17, 0));
    expect(new Date(epoch).toISOString()).toBe("2026-11-27T01:00:00.000Z");
  });

  it("speaks 5:20 and parses dinner hours", () => {
    expect(formatSpeech(hm(17, 20))).toBe("5:20");
    expect(parseClock("17:00")).toBe(hm(17, 0));
    expect(parseClock("5")).toBe(hm(17, 0));
    expect(parseClock("6 pm")).toBe(hm(18, 0));
  });
});
