import { matchDish } from "@kc/recipes";

export interface RouteHit {
  tool: string;
  args: Record<string, unknown>;
}

const WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  fifteen: 15, twenty: 20, thirty: 30, forty: 40, fortyfive: 45, sixty: 60, ninety: 90,
};

const THANKSGIVING = ["turkey", "stuffing", "potatoes", "green beans", "gravy", "rolls"];

function clean(text: string): string {
  return text.trim().toLowerCase().replace(/^alexa[, ]+/, "").replace(/[“”"]/g, "").replace(/\s+/g, " ").replace(/[.!?]+$/g, "").trim();
}

export function minutesOf(phrase: string): number | undefined {
  const t = phrase.trim().toLowerCase().replace(/-/g, " ");
  if (t === "half an hour" || t === "half hour" || t === "a half hour") return 30;
  if (t === "an hour" || t === "a hour" || t === "one hour") return 60;
  if (t === "an hour and a half" || t === "hour and a half") return 90;
  const num = t.match(/(\d+)/);
  if (num && (/min/.test(t) || /^\d+$/.test(t))) {
    const n = Number(num[1]);
    if (n >= 1 && n <= 180) return n;
  }
  const word = t.replace(/\s*minutes?$/, "").replace(/\s+/g, "");
  return WORDS[word];
}

function dishId(name: string): string {
  return matchDish(name)?.id ?? name.trim().toLowerCase();
}

function splitDishes(list: string): string[] {
  return list.split(/,| and /).map((s) => s.trim()).filter((s) => s && s !== "and");
}

/** Grammar first. Undefined means the phrase is not one of ours. */
export function routeUtterance(text: string): RouteHit | undefined {
  const t = clean(text);
  if (!t) return undefined;

  if (/^(sounds good|sounds great|that works|yes|move it)$/.test(t)) return { tool: "choose_option", args: { optionId: "move_serve_time" } };
  if (/^keep (five o'?clock|5:00|5|five)$/.test(t)) return { tool: "choose_option", args: { optionId: "keep_serve_time" } };
  if (/^undo( that)?$/.test(t)) return { tool: "undo", args: {} };
  if (/^(done|that'?s done|finished)$/.test(t)) return { tool: "mark_done", args: {} };
  const inn = t.match(/^([a-z ]+?)(?:'s| is) in$/);
  if (inn) return { tool: "mark_done", args: { stepId: dishId(inn[1]!) } };
  if (/^what'?s on my list\??$/.test(t) || t === "show my list" || t === "read my list") return { tool: "get_list", args: {} };
  if (/add what i'?m missing( to my list)?/.test(t) || t === "add the missing ingredients") return { tool: "add_missing_to_list", args: {} };
  const put = t.match(/^(?:put|add) (.+?) (?:on|to) (?:my |the )?list$/);
  if (put) return { tool: "add_missing_to_list", args: { items: [put[1]!.trim()] } };
  if (/^what'?s next\??$/.test(t) || t === "status" || t === "where are we") return { tool: "status", args: {} };
  const howLong = t.match(/^how long(?: (?:is|on|until|for))? (?:the )?(.+?)\??$/);
  if (howLong) return { tool: "status", args: { focus: dishId(howLong[1]!) } };
  const skip = t.match(/^skip(?: the)? (.+)$/);
  if (skip) return { tool: "skip_dish", args: { dish: dishId(skip[1]!) } };

  const more = t.match(/^(?:give (?:the )?(.+?) |(?:the )?(.+?) (?:needs?|gets?) )?(\d+|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty|forty five|sixty) more minutes$/);
  if (more) {
    const mins = minutesOf(more[3]!);
    if (mins) return { tool: "shift", args: { target: more[1] || more[2] ? dishId((more[1] || more[2])!) : "current", deltaMin: mins } };
  }
  if (/^five more minutes$/.test(t) || /^5 more minutes$/.test(t)) return { tool: "shift", args: { target: "current", deltaMin: 5 } };

  const late = t.match(/^(?:the )?(.+?)(?:'s| is| are)? running (.+?) late$/);
  if (late) {
    const mins = minutesOf(late[2]!.replace(/ minutes?$/, "")) ?? (late[2] === "late" ? undefined : minutesOf(late[2]!));
    const delta = mins ?? (late[2]!.replace(/ minutes?$/, "") === "" ? 30 : undefined);
    if (delta) return { tool: "shift", args: { target: dishId(late[1]!), deltaMin: delta } };
  }
  const lateShort = t.match(/^(?:the )?(.+?)(?:'s| is| are) running late$/);
  if (lateShort) return { tool: "shift", args: { target: dishId(lateShort[1]!), deltaMin: 30 } };

  const eat = t.match(/^(?:we(?:'re| are) eating|eat|dinner(?: is)?) at (.+?)(?: now)?$/);
  if (eat && !/making|cooking/.test(t)) return { tool: "set_serve_time", args: { serveAt: eat[1]!.trim() } };

  if (t === "plan dinner" || t === "plan the dinner" || t === "what's for dinner") {
    return { tool: "plan_meal", args: { dishes: THANKSGIVING.map((name) => ({ name })), serveAt: "17:00" } };
  }

  const plan = t.match(/^(?:we(?:'re| are) (?:making|cooking)|(?:let's |lets )?make|plan(?: a)? (?:dinner|meal) of) (.+?)(?:\.|,)? (?:we eat|dinner|serve)(?: at| is)? (.+)$/);
  if (plan) {
    const names = splitDishes(plan[1]!);
    if (names.length) return { tool: "plan_meal", args: { dishes: names.map((name) => ({ name })), serveAt: plan[2]!.trim() } };
  }
  return undefined;
}
