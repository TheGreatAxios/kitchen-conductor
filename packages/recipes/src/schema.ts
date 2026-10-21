/** Bedrock structured-output schema. No numeric bounds: those are checked in code. */
export const RECIPE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["dishes"],
  properties: {
    dishes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "servings", "ingredients", "steps"],
        properties: {
          name: { type: "string" },
          servings: { anyOf: [{ type: "integer" }, { type: "null" }] },
          ingredients: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["item", "quantity"],
              properties: {
                item: { type: "string" },
                quantity: { anyOf: [{ type: "string" }, { type: "null" }] },
              },
            },
          },
          steps: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["key", "name", "kind", "minutes", "ovenTempF", "hands", "after", "tempFlexible", "holdMinutes"],
              properties: {
                key: { type: "string" },
                name: { type: "string" },
                kind: { type: "string", enum: ["prep", "oven", "stovetop", "rest", "hold", "check", "other"] },
                minutes: { anyOf: [{ type: "integer" }, { type: "null" }] },
                ovenTempF: { anyOf: [{ type: "integer" }, { type: "null" }] },
                hands: { type: "string", enum: ["none", "one", "both"] },
                after: { type: "array", items: { type: "string" } },
                tempFlexible: { type: "boolean" },
                holdMinutes: { anyOf: [{ type: "integer" }, { type: "null" }] },
              },
            },
          },
        },
      },
    },
  },
} as const;

export const PARSE_SYSTEM = "Convert each recipe into kitchen steps. Use only times and temperatures stated or clearly implied by the recipe. If a time is missing, set minutes to null. Do not invent steps. Classify hands as none, one or both.";
