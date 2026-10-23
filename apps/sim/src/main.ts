import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { formatDigits, mealNow, type Clock } from "@kc/core";
import { homeModel, renderScreen, type CardModel } from "../../card/src/render.ts";
import { COOK_SCRIPT, pickVoice, type VoiceRole } from "./voices.ts";

interface ToolResult {
  isError?: boolean;
  content?: { type: string; text?: string }[];
  structuredContent?: (CardModel & { mealId?: string }) | null;
}

const screen = document.querySelector("#screen") as HTMLElement;
const utterance = document.querySelector("#utterance") as HTMLInputElement;
const caption = document.querySelector("#caption") as HTMLElement;
const logEl = document.querySelector("#log") as HTMLElement;
const drawer = document.querySelector("#drawer") as HTMLElement;
const offline = document.querySelector("#offline") as HTMLElement;
const bezel = document.querySelector("#bezel") as HTMLElement;
const stage = document.querySelector("#stage") as HTMLElement;

let mealId = localStorage.getItem("kc-meal") ?? "";
let clock: Clock | null = null;
let countdownTo = 0;
let conductorName: string | undefined;
let scriptRunning = false;
const rpc: string[] = [];

function pushLog(line: string): void {
  rpc.push(line);
  logEl.textContent = rpc.slice(-14).join("\n");
}

function fit(): void {
  const scale = Math.min(1, (window.innerWidth - 24) / 1312, (window.innerHeight - 168) / 848);
  bezel.style.transform = `scale(${scale})`;
  stage.style.height = `${848 * scale}px`;
}

function showCaption(text: string, who: string): void {
  caption.textContent = text ? `${who}: ${text}` : "";
}

function show(model: CardModel): void {
  screen.innerHTML = renderScreen(model);
  if (model.screen !== "home") {
    mealId = model.mealId;
    localStorage.setItem("kc-meal", mealId);
    clock = model.clock;
    const digits = screen.querySelector(".digits");
    countdownTo = Number(digits?.getAttribute("data-to") ?? 0);
  } else {
    clock = null;
    countdownTo = 0;
  }
}

function voiceFor(role: VoiceRole): SpeechSynthesisVoice | undefined {
  const synth = window.speechSynthesis;
  if (!synth) return undefined;
  const voices = synth.getVoices();
  const picked = pickVoice(
    voices.map((v) => ({ name: v.name, lang: v.lang })),
    role,
    role === "cook" ? conductorName : undefined,
  );
  if (role === "conductor" && picked) conductorName = picked.name;
  return voices.find((v) => v.name === picked?.name);
}

function speak(text: string, role: VoiceRole): Promise<void> {
  showCaption(text, role === "cook" ? "Cook" : "Conductor");
  const synth = window.speechSynthesis;
  if (!text || !synth) return Promise.resolve();
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    const voice = voiceFor(role);
    if (voice) u.voice = voice;
    u.lang = voice?.lang || "en-US";
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const timer = window.setTimeout(done, 8000);
    u.onend = () => {
      window.clearTimeout(timer);
      done();
    };
    u.onerror = () => {
      window.clearTimeout(timer);
      done();
    };
    synth.cancel();
    synth.speak(u);
  });
}

function chime(): void {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return;
  const ctx = new Ctx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = 880;
  osc.connect(gain);
  gain.connect(ctx.destination);
  gain.gain.setValueAtTime(0.06, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
  osc.start();
  osc.stop(ctx.currentTime + 0.4);
}

const client = new Client({ name: "kitchen-conductor-sim", version: "1.0.0" }, { versionNegotiation: { mode: "auto" } });
const transport = new StreamableHTTPClientTransport(new URL("/mcp", location.origin), {
  fetch: async (input, init) => {
    const body = typeof init?.body === "string" ? init.body : "";
    try {
      const msg = JSON.parse(body) as { method?: string };
      if (msg.method && msg.method !== "notifications/initialized") pushLog(msg.method);
    } catch {
      /* not json */
    }
    return fetch(input, init);
  },
});

async function callTool(name: string, args: Record<string, unknown>, talk = true): Promise<ToolResult> {
  pushLog(`tools/call ${name}`);
  const result = (await client.callTool({ name, arguments: args })) as ToolResult;
  const text = result.content?.find((c) => c.type === "text")?.text ?? "";
  if (result.structuredContent && "screen" in result.structuredContent) show(result.structuredContent);
  if (talk && text) void speak(text, "conductor");
  return result;
}

async function onToolClick(target: HTMLElement): Promise<void> {
  const tool = target.getAttribute("data-tool");
  if (!tool) return;
  try {
    const raw = target.getAttribute("data-args") ?? "%7B%7D";
    const args = JSON.parse(decodeURIComponent(raw)) as Record<string, unknown>;
    if (mealId && args.mealId == null && tool !== "plan_meal") args.mealId = mealId;
    await callTool(tool, args);
  } catch (err) {
    caption.textContent = err instanceof Error ? err.message : "That didn't go through.";
  }
}

async function heard(text: string): Promise<void> {
  if (!mealId) return;
  const res = await fetch("/sim/heard", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mealId, text }),
  });
  if (!res.ok) return;
  show((await res.json()) as CardModel);
}

async function say(text: string, talkCook = true): Promise<void> {
  const line = text.trim();
  if (!line) return;
  try {
    if (talkCook) await speak(line, "cook");
    const res = await fetch("/sim/route", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: line, mealId: mealId || undefined }),
    });
    const hit = (await res.json()) as { miss?: boolean; say?: string; tool?: string; args?: Record<string, unknown> };
    if (hit.miss || !hit.tool) {
      await speak(hit.say ?? "I didn't catch that.", "conductor");
      return;
    }
    const result = await callTool(hit.tool, hit.args ?? {}, false);
    const reply = result.content?.find((c) => c.type === "text")?.text ?? "";
    if (hit.tool === "plan_meal") await heard(line);
    if (reply) await speak(reply, "conductor");
  } catch (err) {
    caption.textContent = err instanceof Error ? err.message : "That didn't go through.";
  }
}

function seenKey(id: string): string {
  return `${mealId}:${id}`;
}

function alreadyRang(id: string): boolean {
  const raw = localStorage.getItem("kc-fired") ?? "[]";
  return (JSON.parse(raw) as string[]).includes(seenKey(id));
}

function markRang(id: string): void {
  const raw = JSON.parse(localStorage.getItem("kc-fired") ?? "[]") as string[];
  const key = seenKey(id);
  if (!raw.includes(key)) raw.push(key);
  localStorage.setItem("kc-fired", JSON.stringify(raw.slice(-200)));
}

async function claimDue(ring: boolean): Promise<void> {
  if (!mealId || !clock) return;
  const now = mealNow(clock);
  const viewRes = await fetch(`/sim/meal/${mealId}`);
  if (!viewRes.ok) return;
  const view = (await viewRes.json()) as CardModel & {
    steps?: { id: string; name: string; hands: number; startAt: number; kind: string }[];
    fired?: string[];
  };
  if (view.screen === "home") return;
  clock = view.clock;
  for (const step of view.steps ?? []) {
    if (step.hands <= 0 || step.kind === "hold" || step.startAt > now) continue;
    if (view.fired?.includes(step.id) || alreadyRang(step.id)) continue;
    const claim = await fetch("/sim/event", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mealId, eventId: step.id }),
    });
    const body = (await claim.json()) as { first?: boolean };
    markRang(step.id);
    if (body.first && ring) {
      chime();
      void speak(`Time to ${step.name.toLowerCase()}.`, "conductor");
    }
  }
}

async function jump(at: string): Promise<void> {
  if (!mealId) return;
  const res = await fetch("/sim/clock", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mealId, at, paused: true }),
  });
  if (!res.ok) return;
  show((await res.json()) as CardModel);
  await claimDue(false);
}

async function seed(): Promise<void> {
  const res = await fetch("/sim/seed", { method: "POST" });
  const body = (await res.json()) as { mealId: string; view: CardModel; text: string };
  mealId = body.mealId;
  localStorage.setItem("kc-meal", mealId);
  show(body.view);
  await claimDue(false);
}

async function playScript(): Promise<void> {
  if (scriptRunning) return;
  scriptRunning = true;
  try {
    for (const line of COOK_SCRIPT) {
      if (line.at && mealId) await jump(line.at);
      await say(line.say);
    }
  } finally {
    scriptRunning = false;
  }
}

function listen(): void {
  const Rec = (window as unknown as { SpeechRecognition?: new () => Recog; webkitSpeechRecognition?: new () => Recog }).SpeechRecognition
    ?? (window as unknown as { webkitSpeechRecognition?: new () => Recog }).webkitSpeechRecognition;
  if (!Rec) {
    utterance.focus();
    return;
  }
  const rec = new Rec();
  rec.lang = "en-US";
  rec.onresult = (ev) => {
    utterance.value = ev.results[0]?.[0]?.transcript ?? "";
    void say(utterance.value);
    utterance.value = "";
  };
  rec.onerror = () => utterance.focus();
  rec.start();
}

interface Recog {
  lang: string;
  onresult: ((ev: { results: { 0?: { 0?: { transcript: string } } } }) => void) | null;
  onerror: (() => void) | null;
  start: () => void;
}

document.addEventListener("click", (ev) => {
  const tool = (ev.target as HTMLElement).closest("[data-tool]") as HTMLElement | null;
  if (tool) void onToolClick(tool);
  if ((ev.target as HTMLElement).id === "listen") listen();
});

document.querySelector("#say")?.addEventListener("submit", (ev) => {
  ev.preventDefault();
  const text = utterance.value;
  utterance.value = "";
  void say(text);
});
document.querySelector("#mic")?.addEventListener("click", () => listen());
document.querySelector("#script")?.addEventListener("click", () => void playScript());
document.querySelector("#seed")?.addEventListener("click", () => void seed());
document.querySelector("#jump-312")?.addEventListener("click", () => void jump("15:12"));
document.querySelector("#jump-340")?.addEventListener("click", () => void jump("15:40"));
document.querySelector("#pause")?.addEventListener("click", () => {
  if (!mealId) return;
  void fetch("/sim/clock", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mealId, paused: true }),
  }).then((r) => r.json()).then((view) => show(view as CardModel));
});
document.querySelector("#speed")?.addEventListener("click", () => {
  if (!mealId || !clock || clock.mode !== "demo") return;
  const speed = clock.speed === 60 ? 1 : 60;
  void fetch("/sim/clock", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mealId, speed, paused: false }),
  }).then((r) => r.json()).then((view) => show(view as CardModel));
});
document.querySelector("#late")?.addEventListener("click", () => void say("The turkey's running thirty minutes late.", false));

document.addEventListener("keydown", (ev) => {
  const typing = ev.target instanceof HTMLInputElement || ev.target instanceof HTMLTextAreaElement;
  if (ev.key === "d" && !typing && !ev.metaKey && !ev.ctrlKey) {
    drawer.hidden = !drawer.hidden;
  }
  if (ev.key === " " && !typing) {
    ev.preventDefault();
    listen();
  }
});

window.addEventListener("resize", fit);
window.addEventListener("online", () => { offline.hidden = true; });
window.addEventListener("offline", () => { offline.hidden = false; });
offline.hidden = navigator.onLine;
fit();
show(homeModel());
window.speechSynthesis?.addEventListener("voiceschanged", () => voiceFor("conductor"));

window.setInterval(() => {
  const digits = screen.querySelector(".digits");
  if (!digits || !clock || !countdownTo) return;
  const sec = Math.max(0, Math.round((countdownTo - mealNow(clock)) / 1000));
  digits.textContent = formatDigits(sec);
}, 250);

window.setInterval(async () => {
  if (!mealId || scriptRunning || !clock || clock.mode !== "demo" || clock.paused) return;
  if (clock.speed > 1) {
    const res = await fetch(`/sim/meal/${mealId}`);
    if (res.ok) show((await res.json()) as CardModel);
  }
  void claimDue(true);
}, 1000);

async function boot(): Promise<void> {
  try {
    await client.connect(transport);
    pushLog(`protocol ${client.getNegotiatedProtocolVersion() ?? ""}`);
  } catch {
    caption.textContent = "Can't reach the server.";
  }
  if (!mealId) return;
  const res = await fetch(`/sim/meal/${mealId}`);
  if (!res.ok) {
    mealId = "";
    localStorage.removeItem("kc-meal");
    return;
  }
  show((await res.json()) as CardModel);
  await claimDue(false);
}

void boot();
