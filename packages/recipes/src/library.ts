import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RecipeDish } from "@kc/core";
import { CROSS_LINKS } from "./links.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "../library");

let cache: RecipeDish[] | undefined;

export function loadLibrary(): RecipeDish[] {
  if (cache) return cache;
  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  cache = files.map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as RecipeDish);
  return cache;
}

export function dishById(id: string): RecipeDish | undefined {
  return loadLibrary().find((d) => d.id === id);
}

export function thanksgivingDishes(): RecipeDish[] {
  const order = ["turkey", "stuffing", "potatoes", "gravy", "beans", "rolls"];
  return order.map((id) => {
    const d = dishById(id);
    if (!d) throw new Error(`missing library dish ${id}`);
    return d;
  });
}

export { CROSS_LINKS };

export function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

/** Alias, id, or name. "mashed potatoes" and "spuds" both hit potatoes. */
export function matchDish(name: string, library = loadLibrary()): RecipeDish | undefined {
  const n = normalizeName(name);
  if (!n) return undefined;
  const exact = library.find((d) => {
    const keys = [d.id, d.name, d.shortName, ...d.aliases].map(normalizeName);
    return keys.includes(n);
  });
  if (exact) return exact;
  return library.find((d) => {
    const keys = [d.id, d.name, d.shortName, ...d.aliases].map(normalizeName);
    return keys.some((k) => k.length > 2 && (n.includes(k) || k.includes(n)));
  });
}
