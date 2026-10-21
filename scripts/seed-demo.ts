import process from "node:process";

const base = process.env.KC_URL ?? "http://127.0.0.1:8787";
const res = await fetch(`${base}/sim/seed`, { method: "POST" });
if (!res.ok) {
  console.error(`seed failed: ${res.status}`);
  process.exit(1);
}
const body = await res.json() as { mealId?: string };
console.log(body.mealId ?? "demo");
