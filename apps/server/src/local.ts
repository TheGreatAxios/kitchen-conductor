import { serve } from "@hono/node-server";
import { createApp } from "./app.js";

const port = Number(process.env.KC_PORT ?? 8787);
const hostname = "0.0.0.0";
serve({ fetch: createApp().fetch, port, hostname }, (info) => {
  console.log(`Kitchen Conductor http://127.0.0.1:${info.port}`);
});
