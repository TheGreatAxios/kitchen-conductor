import { McpServer } from "@modelcontextprotocol/server";
import { RESOURCE_MIME_TYPE, registerAppResource, registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { homeModel, renderDocument } from "@kc/card";
import { MissingMeal, Kitchen } from "./kitchen.js";

export const UI = "ui://kitchen-conductor/timeline.html";

const loose = z.object({ mealId: z.string() }).passthrough();

function spoken(text: string, structured: unknown) {
  return { content: [{ type: "text" as const, text }], structuredContent: structured };
}

function fail(err: unknown) {
  const text = err instanceof MissingMeal ? err.message : err instanceof Error ? err.message : "Something went wrong.";
  return { isError: true as const, content: [{ type: "text" as const, text }] };
}

export function buildServer(kitchen: Kitchen, cardHtml: string): McpServer {
  const server = new McpServer({ name: "kitchen-conductor", version: "1.0.0" });
  const ui = { _meta: { ui: { resourceUri: UI } } };

  registerAppTool(server, "plan_meal", {
    title: "Plan a meal",
    description: "Turn the dishes and a serve time into one oven, burner, and hands timeline.",
    inputSchema: z.object({
      dishes: z.array(z.object({
        name: z.string(),
        recipeText: z.string().optional(),
        recipeUrl: z.string().optional(),
        servings: z.number().optional(),
      })).min(1).max(8),
      serveAt: z.string(),
      cooks: z.union([z.literal(1), z.literal(2)]).optional(),
      burners: z.number().optional(),
      mealId: z.string().optional(),
    }),
    outputSchema: loose,
    ...ui,
  }, async (args) => {
    try {
      const { text, view } = await kitchen.planMeal(args);
      return spoken(text, view);
    } catch (err) {
      return fail(err);
    }
  });

  registerAppTool(server, "shift", {
    title: "Shift a step",
    description: "A dish is running early or late. Replan from now.",
    inputSchema: z.object({ mealId: z.string(), target: z.string(), deltaMin: z.number().int().min(-120).max(180), reason: z.string().optional() }),
    outputSchema: loose,
    ...ui,
  }, async ({ mealId, target, deltaMin }) => {
    try {
      const { text, view } = await kitchen.shift(mealId, target, deltaMin);
      return spoken(text, view);
    } catch (err) {
      return fail(err);
    }
  });

  registerAppTool(server, "set_serve_time", {
    title: "Set serve time",
    description: "Move dinner to a new time and replan.",
    inputSchema: z.object({ mealId: z.string(), serveAt: z.string() }),
    outputSchema: loose,
    ...ui,
  }, async ({ mealId, serveAt }) => {
    try {
      const { text, view } = await kitchen.setServe(mealId, serveAt);
      return spoken(text, view);
    } catch (err) {
      return fail(err);
    }
  });

  registerAppTool(server, "choose_option", {
    title: "Choose an option",
    description: "Apply Sounds good or keep the original serve time.",
    inputSchema: z.object({ mealId: z.string(), optionId: z.string() }),
    outputSchema: loose,
    ...ui,
  }, async ({ mealId, optionId }) => {
    try {
      const { text, view } = await kitchen.choose(mealId, optionId);
      return spoken(text, view);
    } catch (err) {
      return fail(err);
    }
  });

  registerAppTool(server, "undo", {
    title: "Undo",
    description: "Restore the previous plan.",
    inputSchema: z.object({ mealId: z.string() }),
    outputSchema: loose,
    ...ui,
  }, async ({ mealId }) => {
    try {
      const { text, view } = await kitchen.undo(mealId);
      return spoken(text, view);
    } catch (err) {
      return fail(err);
    }
  });

  registerAppTool(server, "mark_done", {
    title: "Mark done",
    description: "Mark the current hands-on step done and replan if it finished early.",
    inputSchema: z.object({ mealId: z.string(), stepId: z.string().optional() }),
    outputSchema: loose,
    ...ui,
  }, async ({ mealId, stepId }) => {
    try {
      const { text, view } = await kitchen.markDone(mealId, stepId);
      return spoken(text, view);
    } catch (err) {
      return fail(err);
    }
  });

  registerAppTool(server, "skip_dish", {
    title: "Skip a dish",
    description: "Take a dish off the rest of the plan.",
    inputSchema: z.object({ mealId: z.string(), dish: z.string() }),
    outputSchema: loose,
    annotations: { destructiveHint: true },
    ...ui,
  }, async ({ mealId, dish }) => {
    try {
      const { text, view } = await kitchen.skip(mealId, dish);
      return spoken(text, view);
    } catch (err) {
      return fail(err);
    }
  });

  registerAppTool(server, "status", {
    title: "Status",
    description: "What's happening now, and what's next.",
    inputSchema: z.object({ mealId: z.string(), focus: z.string().optional() }),
    outputSchema: loose,
    annotations: { readOnlyHint: true },
    ...ui,
  }, async ({ mealId, focus }) => {
    try {
      const { text, view } = await kitchen.status(mealId, focus);
      return spoken(text, view);
    } catch (err) {
      return fail(err);
    }
  });

  registerAppTool(server, "add_missing_to_list", {
    title: "Add missing ingredients",
    description: "Add ingredients that are not already in the kitchen to the list.",
    inputSchema: z.object({ mealId: z.string(), items: z.array(z.string()).optional() }),
    outputSchema: loose,
    ...ui,
  }, async ({ mealId, items }) => {
    try {
      const { text, list } = await kitchen.addMissing(mealId, items);
      return spoken(text, list);
    } catch (err) {
      return fail(err);
    }
  });

  registerAppTool(server, "get_list", {
    title: "Get the list",
    description: "Read the ingredient list.",
    inputSchema: z.object({ mealId: z.string() }),
    outputSchema: loose,
    annotations: { readOnlyHint: true },
    ...ui,
  }, async ({ mealId }) => {
    try {
      const { text, list } = await kitchen.getList(mealId);
      return spoken(text, list);
    } catch (err) {
      return fail(err);
    }
  });

  registerAppTool(server, "set_have", {
    title: "Set have",
    description: "Tick ingredients the cook already has.",
    inputSchema: z.object({ mealId: z.string(), items: z.array(z.string()), have: z.boolean() }),
    outputSchema: loose,
    ...ui,
  }, async ({ mealId, items, have }) => {
    try {
      const { text, list } = await kitchen.setHave(mealId, items, have);
      return spoken(text, list);
    } catch (err) {
      return fail(err);
    }
  });

  registerAppResource(server, "Timeline", UI, {}, async () => ({
    contents: [{ uri: UI, mimeType: RESOURCE_MIME_TYPE, text: cardHtml || renderDocument(homeModel(), "") }],
  }));

  return server;
}
