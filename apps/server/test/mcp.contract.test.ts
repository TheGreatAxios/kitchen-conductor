import { serve } from "@hono/node-server";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { Kitchen } from "../src/kitchen.js";
import { MemoryStore } from "../src/store.js";

process.env.KC_BEDROCK = "stub";

const SUMMARY = "Turkey needs 30 more minutes. Potatoes, gravy, beans and rolls moved later. The turkey rests 20 minutes instead of 30.";

let port = 0;
let close: (() => void) | undefined;

function base(): string {
  return `http://127.0.0.1:${port}`;
}

function modernClient(name: string): Client {
  return new Client({ name, version: "0.0.0" }, { versionNegotiation: { mode: { pin: "2026-07-28" } } });
}

async function tool(client: Client, name: string, args: Record<string, unknown>) {
  return client.callTool({ name, arguments: args }) as Promise<{
    isError?: boolean;
    content?: { type: string; text?: string }[];
    structuredContent?: Record<string, unknown>;
  }>;
}

beforeAll(async () => {
  const app = createApp({ bedrock: null });
  await new Promise<void>((resolve) => {
    const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }, (info) => {
      port = info.port;
      close = () => server.close();
      resolve();
    });
  });
});

afterAll(() => close?.());

describe("mcp contract", () => {
  it("speaks 2026-07-28, lists 11 tools, and refuses a foreign origin", async () => {
    const client = modernClient("kc-test");
    await client.connect(new StreamableHTTPClientTransport(new URL("/mcp", base())));
    expect(client.getNegotiatedProtocolVersion()).toBe("2026-07-28");
    const listed = await client.listTools();
    expect(listed.tools.map((t) => t.name).sort()).toEqual([
      "add_missing_to_list", "choose_option", "get_list", "mark_done", "plan_meal",
      "set_have", "set_serve_time", "shift", "skip_dish", "status", "undo",
    ]);
    for (const t of listed.tools) {
      const uri = (t as { _meta?: { ui?: { resourceUri?: string } } })._meta?.ui?.resourceUri;
      expect(uri, t.name).toBe("ui://kitchen-conductor/timeline.html");
    }
    const resource = await client.readResource({ uri: "ui://kitchen-conductor/timeline.html" });
    expect(resource.contents[0]?.mimeType).toBe("text/html;profile=mcp-app");
    await client.close();

    const evil = await fetch(`${base()}/mcp`, {
      method: "POST",
      headers: { origin: "https://evil.example", "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    expect(evil.status).toBe(403);
  });

  it("still serves a 2025-11-25 client without the per-request envelope", async () => {
    const client = new Client({ name: "kc-legacy", version: "0.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL("/mcp", base())));
    expect(client.getNegotiatedProtocolVersion()).toBe("2025-11-25");
    const listed = await client.listTools();
    expect(listed.tools).toHaveLength(11);
    await client.close();
  });

  it("runs the demo through tools/call with the stub", async () => {
    const client = modernClient("kc-demo");
    await client.connect(new StreamableHTTPClientTransport(new URL("/mcp", base())));
    const planned = await tool(client, "plan_meal", {
      dishes: ["turkey", "stuffing", "potatoes", "green beans", "gravy", "rolls"].map((name) => ({ name })),
      serveAt: "17:00",
    });
    const view = planned.structuredContent!;
    expect(view.headline).toBe("Stuffing goes in");
    expect(String(planned.content?.[0]?.text)).toMatch(/Six dishes/);
    const mealId = String(view.mealId);

    const clock = await fetch(`${base()}/sim/clock`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mealId, at: "15:40", paused: true }),
    });
    expect(clock.ok).toBe(true);

    const shifted = await tool(client, "shift", { mealId, target: "turkey", deltaMin: 30 });
    expect(shifted.structuredContent?.summary).toBe(SUMMARY);
    expect(shifted.structuredContent?.headline).toBe("Dinner moves to 5:20");

    const chosen = await tool(client, "choose_option", { mealId, optionId: "move_serve_time" });
    expect(chosen.content?.[0]?.text).toMatch(/5:20/);

    const undone = await tool(client, "undo", { mealId });
    expect(undone.content?.[0]?.text).toBe("Undone.");

    const done = await tool(client, "mark_done", { mealId });
    expect(done.content?.[0]?.text).toMatch(/Done|Stuffing's in/);

    const added = await tool(client, "add_missing_to_list", { mealId });
    expect(added.content?.[0]?.text).toMatch(/list/i);
    expect(added.structuredContent?.screen).toBe("list");

    const list = await tool(client, "get_list", { mealId });
    expect(list.content?.[0]?.text).toMatch(/On your list/);
    await client.close();
  });

  it("a grammar miss stays a miss", async () => {
    const res = await fetch(`${base()}/sim/route`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "what's the weather in Seattle" }),
    });
    const body = await res.json() as { miss?: boolean; tool?: string };
    expect(body.miss).toBe(true);
    expect(body.tool).toBeUndefined();
  });

  it("library plan sends nothing, and one unknown recipe sends once", async () => {
    let sends = 0;
    const kitchen = new Kitchen(new MemoryStore(), {
      async send() {
        sends += 1;
        return {
          output: {
            message: {
              content: [{
                text: JSON.stringify({
                  dishes: [{
                    name: "Cookies",
                    steps: [{ key: "bake", name: "Bake", kind: "oven", minutes: 12, ovenTempF: 375, hands: "none", after: [] }],
                  }],
                }),
              }],
            },
          },
        };
      },
    });
    await kitchen.planMeal({ dishes: [{ name: "turkey" }, { name: "gravy" }], serveAt: "17:00" }, "test", false);
    expect(sends).toBe(0);
    expect(kitchen.sends).toBe(0);
    await kitchen.planMeal({
      dishes: [{ name: "Cookies", recipeText: "Bake at 375 for 12 minutes." }],
      serveAt: "17:00",
    }, "test", false);
    expect(sends).toBe(1);
    expect(kitchen.sends).toBe(1);
  });
});
