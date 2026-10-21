import { describe, expect, it } from "vitest";
import { loadLibrary, matchDish, thanksgivingDishes } from "../src/index.js";

describe("library", () => {
  it("has the six Thanksgiving dishes plus the extras", () => {
    const ids = loadLibrary().map((d) => d.id).sort();
    expect(ids).toEqual(["beans", "brussels", "gravy", "mac", "pie", "potatoes", "rolls", "stuffing", "turkey"]);
    expect(thanksgivingDishes().map((d) => d.id)).toEqual(["turkey", "stuffing", "potatoes", "gravy", "beans", "rolls"]);
  });

  it("matches aliases", () => {
    expect(matchDish("bird")?.id).toBe("turkey");
    expect(matchDish("spuds")?.id).toBe("potatoes");
    expect(matchDish("green beans")?.id).toBe("beans");
    expect(matchDish("not a food")).toBeUndefined();
  });
});
