import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { McpServer, WebStandardStreamableHTTPServerTransport, originValidationResponse } from "@modelcontextprotocol/server";
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import type { BedrockSender } from "@kc/recipes";
import { MODEL_ID } from "@kc/recipes";
import { cardCss, homeModel, renderDocument } from "@kc/card";
import { Kitchen } from "./kitchen.js";
import { MemoryStore } from "./store.js";
import { buildServer } from "./mcp.js";
import { routeUtterance } from "./grammar.js";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));

const FONTS: Record<string, string> = {
  "bricolage-grotesque-latin-500-normal.woff2": "@fontsource/bricolage-grotesque",
  "bricolage-grotesque-latin-600-normal.woff2": "@fontsource/bricolage-grotesque",
  "geist-sans-latin-400-normal.woff2": "@fontsource/geist-sans",
  "geist-sans-latin-500-normal.woff2": "@fontsource/geist-sans",
  "geist-sans-latin-600-normal.woff2": "@fontsource/geist-sans",
};

function fontPath(file: string): string | undefined {
  const pkg = FONTS[file];
  if (!pkg) return undefined;
  return join(dirname(require.resolve(`${pkg}/package.json`)), "files", file);
}

export function bedrockFromEnv(): BedrockSender | null {
  if ((process.env.KC_BEDROCK ?? "stub") !== "live") return null;
  const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? "us-east-1" });
  return {
    async send(command) {
      const res = await client.send(command);
      return { output: res.output ? { message: { content: res.output.message?.content?.map((c) => ("text" in c && c.text ? { text: c.text } : {})) } } : undefined };
    },
  };
}

function allowlist(): string[] {
  const extra = (process.env.KC_ALLOWED_ORIGINS ?? "localhost,127.0.0.1").split(",").map((s) => s.trim()).filter(Boolean);
  return [...new Set([...extra, "localhost", "127.0.0.1", "[::1]"])];
}

export interface AppOpts {
  store?: MemoryStore;
  bedrock?: BedrockSender | null;
}

export function createApp(opts: AppOpts = {}): Hono {
  const store = opts.store ?? new MemoryStore();
  const bedrock = "bedrock" in opts ? opts.bedrock ?? null : bedrockFromEnv();
  const kitchen = new Kitchen(store, bedrock);
  const html = renderDocument(homeModel(), cardCss);
  const app = new Hono();

  app.get("/healthz", (c) => c.json({ ok: true, store: "memory", voice: "browser", region: "us-east-1", model: MODEL_ID, bedrock: bedrock ? "live" : "stub" }));

  app.all("/mcp", async (c) => {
    const rejected = originValidationResponse(c.req.raw, allowlist());
    if (rejected) return rejected;
    const mcp: McpServer = buildServer(kitchen, html);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await mcp.connect(transport);
    return transport.handleRequest(c.req.raw);
  });

  app.post("/sim/seed", async (c) => {
    const rejected = originValidationResponse(c.req.raw, allowlist());
    if (rejected) return rejected;
    const { text, view } = await kitchen.seed();
    return c.json({ text, mealId: view.mealId, view });
  });

  app.get("/sim/meal/:id", async (c) => {
    try {
      const { view } = await kitchen.status(c.req.param("id"));
      return c.json(view);
    } catch {
      return c.json({ error: "missing" }, 404);
    }
  });

  app.post("/sim/route", async (c) => {
    const rejected = originValidationResponse(c.req.raw, allowlist());
    if (rejected) return rejected;
    const body = await c.req.json().catch(() => ({})) as { text?: string; mealId?: string };
    const text = body.text?.trim() ?? "";
    const hit = routeUtterance(text);
    if (!hit) {
      return c.json({
        miss: true,
        say: "I didn't catch that. Try: 'the turkey's running 30 minutes late', 'we're eating at six', 'skip the rolls', 'what's next'.",
      });
    }
    if (hit.tool !== "plan_meal") {
      if (!body.mealId) return c.json({ miss: true, say: "Tell me the dishes and when you eat, and I'll start the plan." });
      hit.args.mealId = body.mealId;
      await kitchen.remember(body.mealId, text).catch(() => undefined);
    }
    return c.json(hit);
  });

  app.post("/sim/clock", async (c) => {
    const rejected = originValidationResponse(c.req.raw, allowlist());
    if (rejected) return rejected;
    const body = await c.req.json() as { mealId?: string; at?: string; speed?: number; paused?: boolean };
    if (!body.mealId) return c.json({ error: "mealId" }, 400);
    const view = await kitchen.setClock(body.mealId, body);
    return c.json(view);
  });

  app.post("/sim/event", async (c) => {
    const rejected = originValidationResponse(c.req.raw, allowlist());
    if (rejected) return rejected;
    const body = await c.req.json() as { mealId?: string; eventId?: string };
    if (!body.mealId || !body.eventId) return c.json({ error: "event" }, 400);
    const first = await kitchen.claim(body.mealId, body.eventId);
    return c.json({ first });
  });

  app.post("/sim/heard", async (c) => {
    const rejected = originValidationResponse(c.req.raw, allowlist());
    if (rejected) return rejected;
    const body = await c.req.json() as { mealId?: string; text?: string };
    if (!body.mealId || !body.text) return c.json({ error: "heard" }, 400);
    await kitchen.remember(body.mealId, body.text);
    const { view } = await kitchen.status(body.mealId);
    return c.json(view);
  });

  app.get("/fonts/:file", (c) => {
    const path = fontPath(c.req.param("file"));
    if (!path) return c.notFound();
    return c.body(readFileSync(path), 200, { "content-type": "font/woff2", "cache-control": "public, max-age=86400" });
  });

  app.get("/card.css", (c) => c.body(cardCss, 200, { "content-type": "text/css" }));

  const dist = join(here, "../../sim/dist");
  const readDist = (name: string): string | undefined => {
    try {
      return readFileSync(join(dist, name), "utf8");
    } catch {
      return undefined;
    }
  };
  app.get("/", (c) => {
    const page = readDist("index.html");
    return page ? c.html(page) : c.html("<p>Simulator bundle missing. Run npm run build.</p>", 503);
  });
  app.get("/sim.js", (c) => {
    const js = readDist("sim.js");
    return js ? c.body(js, 200, { "content-type": "text/javascript; charset=utf-8" }) : c.text("missing", 404);
  });
  app.get("/sim.css", (c) => {
    const css = readDist("sim.css");
    return css ? c.body(css, 200, { "content-type": "text/css; charset=utf-8" }) : c.text("missing", 404);
  });
  app.get("/voiceover", (c) => {
    const page = readDist("voiceover.html");
    return page ? c.html(page) : c.html("<p>Simulator bundle missing. Run npm run build.</p>", 503);
  });
  app.get("/voiceover.js", (c) => {
    const js = readDist("voiceover.js");
    return js ? c.body(js, 200, { "content-type": "text/javascript; charset=utf-8" }) : c.text("missing", 404);
  });

  app.get("/resource", (c) => c.html(html));
  return app;
}
