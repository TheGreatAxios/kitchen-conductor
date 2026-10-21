import { describe, expect, it } from "vitest";
import { extractRecipe } from "../src/jsonld.js";

const page = `<html><head>
<script type="application/ld+json">{ "@context": "https://schema.org", "@type": "Recipe", "name": "Pan cookies", "recipeIngredient": ["2 cups flour", "1 cup sugar"], "recipeInstructions": [{ "@type": "HowToStep", "text": "Bake at 375 for 10 minutes." }] }</script>
</head><body><p>not the recipe</p></body></html>`;

describe("extractRecipe", () => {
  it("reads the first schema.org Recipe", () => {
    const recipe = extractRecipe(page);
    expect(recipe?.name).toBe("Pan cookies");
    expect(recipe?.ingredients).toContain("2 cups flour");
    expect(recipe?.instructions).toMatch(/375/);
  });

  it("ignores a page with no recipe", () => {
    expect(extractRecipe("<html><p>hello</p></html>")).toBeUndefined();
  });
});
