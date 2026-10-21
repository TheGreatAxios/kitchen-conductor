import { describe, expect, it } from "vitest";
import { routeUtterance } from "../src/grammar.js";

const hits: [string, string, Record<string, unknown>][] = [
  ["plan dinner", "plan_meal", { serveAt: "17:00" }],
  ["Alexa, plan dinner", "plan_meal", { serveAt: "17:00" }],
  ["what's for dinner", "plan_meal", { serveAt: "17:00" }],
  ["We're making turkey, stuffing, potatoes, green beans, gravy and rolls. We eat at five.", "plan_meal", { serveAt: "five" }],
  ["let's make turkey and gravy. we eat at five", "plan_meal", { serveAt: "five" }],
  ["The turkey's running 30 minutes late", "shift", { target: "turkey", deltaMin: 30 }],
  ["The turkey's running thirty minutes late.", "shift", { target: "turkey", deltaMin: 30 }],
  ["the turkey's running late", "shift", { target: "turkey", deltaMin: 30 }],
  ["the bird's running half an hour late", "shift", { target: "turkey", deltaMin: 30 }],
  ["the spuds are running 15 minutes late", "shift", { target: "potatoes", deltaMin: 15 }],
  ["the turkey's running an hour and a half late", "shift", { target: "turkey", deltaMin: 90 }],
  ["five more minutes", "shift", { target: "current", deltaMin: 5 }],
  ["give the turkey 20 more minutes", "shift", { target: "turkey", deltaMin: 20 }],
  ["we're eating at six", "set_serve_time", { serveAt: "six" }],
  ["dinner at 5:00", "set_serve_time", { serveAt: "5:00" }],
  ["we are eating at 6 pm", "set_serve_time", { serveAt: "6 pm" }],
  ["skip the rolls", "skip_dish", { dish: "rolls" }],
  ["skip the dressing", "skip_dish", { dish: "stuffing" }],
  ["skip the spuds", "skip_dish", { dish: "potatoes" }],
  ["what's next", "status", {}],
  ["what's next?", "status", {}],
  ["where are we", "status", {}],
  ["how long is the turkey", "status", { focus: "turkey" }],
  ["undo", "undo", {}],
  ["undo that", "undo", {}],
  ["sounds good", "choose_option", { optionId: "move_serve_time" }],
  ["keep five", "choose_option", { optionId: "keep_serve_time" }],
  ["keep 5:00", "choose_option", { optionId: "keep_serve_time" }],
  ["done", "mark_done", {}],
  ["stuffing's in", "mark_done", { stepId: "stuffing" }],
  ["what's on my list", "get_list", {}],
  ["add what I'm missing to my list", "add_missing_to_list", {}],
  ["add butter to my list", "add_missing_to_list", { items: ["butter"] }],
];

describe("grammar", () => {
  it.each(hits)("%s → %s", (phrase, tool, args) => {
    const hit = routeUtterance(phrase);
    expect(hit?.tool, phrase).toBe(tool);
    expect(hit?.args, phrase).toMatchObject(args);
  });

  it("plan dinner is the six Thanksgiving dishes", () => {
    const hit = routeUtterance("plan dinner");
    const dishes = (hit?.args.dishes as { name: string }[]).map((d) => d.name);
    expect(dishes).toEqual(["turkey", "stuffing", "potatoes", "green beans", "gravy", "rolls"]);
  });

  it("a phrase the grammar misses is a miss, with no tool", () => {
    expect(routeUtterance("what's the weather in Seattle")).toBeUndefined();
    expect(routeUtterance("please preheat the oven to 400")).toBeUndefined();
    expect(routeUtterance("")).toBeUndefined();
  });
});
