export interface ExtractedRecipe {
  name?: string;
  ingredients: string[];
  instructions: string;
  cookTime?: string;
  prepTime?: string;
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function isRecipe(node: Record<string, unknown>): boolean {
  const t = node["@type"];
  const types = asArray(t).map((x) => String(x).toLowerCase());
  return types.some((x) => x === "recipe" || x.endsWith("/recipe"));
}

function textOf(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object" && v && "text" in v) return String((v as { text: unknown }).text ?? "");
  if (Array.isArray(v)) return v.map(textOf).filter(Boolean).join("\n");
  return "";
}

function walk(node: unknown, out: Record<string, unknown>[]): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const n of node) walk(n, out);
    return;
  }
  const rec = node as Record<string, unknown>;
  if (isRecipe(rec)) out.push(rec);
  if (Array.isArray(rec["@graph"])) walk(rec["@graph"], out);
}

/** Pull the first schema.org Recipe out of JSON-LD script tags. */
export function extractRecipe(html: string): ExtractedRecipe | undefined {
  const blocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const found: Record<string, unknown>[] = [];
  for (const b of blocks) {
    try {
      walk(JSON.parse(b[1] ?? ""), found);
    } catch {
      // A page can contain broken JSON-LD beside a real recipe. Skip the bad block.
    }
  }
  const rec = found[0];
  if (!rec) return undefined;
  const ingredients = asArray(rec.recipeIngredient).map((x) => String(x)).filter(Boolean);
  const instructions = textOf(rec.recipeInstructions).slice(0, 12_000);
  if (!ingredients.length && !instructions) return undefined;
  return {
    name: typeof rec.name === "string" ? rec.name : undefined,
    ingredients,
    instructions,
    cookTime: typeof rec.cookTime === "string" ? rec.cookTime : undefined,
    prepTime: typeof rec.prepTime === "string" ? rec.prepTime : undefined,
  };
}
