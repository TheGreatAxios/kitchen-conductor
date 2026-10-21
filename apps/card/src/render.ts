import { epochToLocalMin, formatDigits, formatSpeech, type HomeView, type ListView, type PlanView } from "@kc/core";

export type CardModel = PlanView | ListView | HomeView;

const GRID = 1084;

export function homeModel(): HomeView {
  return {
    screen: "home",
    title: "Kitchen Conductor",
    headline: "What's for dinner?",
    meta: "Tell me the dishes and when you eat. One oven, four burners, two hands.",
    listening: "Say “turkey, stuffing, potatoes, green beans, gravy and rolls. We eat at five.”",
    heard: false,
  };
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function attrs(tool?: string, args?: Record<string, unknown>): string {
  if (!tool) return "";
  return ` data-tool="${esc(tool)}" data-args="${encodeURIComponent(JSON.stringify(args ?? {}))}"`;
}

function chip(label: string, style: string, tool?: string, args?: Record<string, unknown>): string {
  return `<button class="chip ${style}" type="button"${attrs(tool, args)}>${esc(label)}</button>`;
}

function clockLabel(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  let h = Math.floor(m / 60);
  const mm = m % 60;
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${String(mm).padStart(2, "0")} ${ap}`;
}

function axis(serveMin: number): { t0: number; t1: number } {
  const t0 = Math.floor((serveMin - 150) / 30) * 30;
  return { t0, t1: t0 + 180 };
}

function lanesFor(racks: number, burners: number): [string, string, number][] {
  const rows: [string, string, number][] = [["temp", "Oven", 28]];
  for (let i = 1; i <= racks; i++) rows.push([`r${i}`, `Rack ${i}`, 38]);
  for (let i = 1; i <= burners; i++) rows.push([`b${i}`, i === 1 ? "Burner 1" : `Burner ${i}`, 28]);
  rows.push(["h1", "Hands", 28], ["h2", "", 28], ["rest", "Resting", 28], ["hold", "Keep warm", 28]);
  return rows;
}

function timeline(view: PlanView): string {
  const serveMin = epochToLocalMin(view.serveAt, view.day);
  const nowMin = epochToLocalMin(view.now, view.day);
  const { t0, t1 } = axis(serveMin);
  const x = (m: number) => ((m - t0) / (t1 - t0)) * GRID;
  const glaze = new Map(view.glazes.map((g) => [g.id, g]));
  const ghost = new Map((view.ghosts ?? []).map((g) => [g.stepId, g]));
  const rows = lanesFor(view.racks, view.burners);
  const yOf = new Map<string, [number, number]>();
  let y = 0;
  let labels = "";
  let wells = "";
  for (const [id, label, h] of rows) {
    if (id === "b1" || id === "h1" || id === "rest") y += 8;
    yOf.set(id, [y, h]);
    wells += `<div class="well ${id === "temp" ? "heatwell" : ""}" style="top:${y}px;height:${h - 4}px"></div>`;
    if (label) labels += `<div class="lane-label" style="top:${y}px;height:${h - 4}px">${esc(label)}</div>`;
    y += h;
  }
  const H = y;
  let bars = "";
  const handsBusy: { lane: string; a: number; b: number }[] = [];
  const steps = [...view.steps].filter((s) => s.status !== "skipped").sort((a, b) => a.startAt - b.startAt);
  for (const s of steps) {
    const a = epochToLocalMin(s.startAt, view.day);
    const b = epochToLocalMin(s.endAt, view.day);
    const g = glaze.get(s.dishId) ?? { glaze: "#E9DFC9", fg: "#2A241B", name: s.dishName ?? s.dishId };
    const old = ghost.get(s.id);
    const places: string[] = [];
    if (s.kind === "oven" && s.resource.kind === "oven") places.push(`r${s.resource.rack}`);
    else if (s.kind === "stovetop" && s.resource.kind === "burner") places.push(`b${s.resource.n}`);
    else if (s.kind === "rest") places.push("rest");
    else if (s.kind === "hold") places.push("hold");
    if (s.hands > 0 && s.kind !== "oven" && s.kind !== "hold") {
      const need = s.hands >= 2 ? ["h1", "h2"] : [];
      if (need.length === 0) {
        const lane = ["h1", "h2"].find((laneId) => !handsBusy.some((p) => p.lane === laneId && p.a < b && a < p.b)) ?? "h1";
        need.push(lane);
      }
      for (const lane of need) {
        handsBusy.push({ lane, a, b });
        places.push(lane);
      }
    }
    places.forEach((lane, i) => {
      const pos = yOf.get(lane);
      if (!pos) return;
      const [ly, lh] = pos;
      if (old) {
        const oa = epochToLocalMin(old.startAt, view.day);
        const ob = epochToLocalMin(old.endAt, view.day);
        if (oa !== a || ob !== b) {
          const l = Math.max(0, x(oa));
          const r = Math.min(GRID, x(ob));
          if (r - l > 2) bars += `<div class="ghost" style="left:${l}px;top:${ly}px;width:${r - l}px;height:${lh - 4}px"></div>`;
        }
      }
      const l = Math.max(0, x(a));
      const r = Math.min(GRID, x(b));
      if (r - l < 2) return;
      const deltaMin = old ? Math.round((s.startAt - old.startAt) / 60_000) || Math.round((s.endAt - old.endAt) / 60_000) : 0;
      const text = i === 0 && r - l > 70
        ? `<span class="bt"><b>${esc(g.name)}</b> ${esc(s.detail && s.detail !== s.name ? s.detail : s.name)}</span>`
        : "";
      const delta = deltaMin ? `<i class="delta">${deltaMin > 0 ? "+" : ""}${deltaMin}</i>` : "";
      const note = !delta && s.adjustedNote && r - l > 160 ? `<i class="note">${esc(s.adjustedNote)}</i>` : "";
      const cls = ["bar", lane.startsWith("h") || lane === "rest" || lane.startsWith("b") ? "thin" : "", s.endAt <= view.now ? "done" : "", s.startAt <= view.now && s.endAt > view.now ? "live" : "", x(a) < 0 ? "clip" : ""].filter(Boolean).join(" ");
      bars += `<div class="${cls}" style="left:${l}px;top:${ly}px;width:${r - l}px;height:${lh - 4}px;--g:${g.glaze};--f:${g.fg}">${text}${delta}${note}</div>`;
    });
  }
  const [ty, th] = yOf.get("temp") ?? [0, 28];
  for (const p of view.ovenPhases) {
    const a = epochToLocalMin(p.startAt, view.day);
    const b = epochToLocalMin(p.endAt, view.day);
    const l = Math.max(0, x(a));
    const r = Math.min(GRID, x(b));
    if (r - l < 2) continue;
    const cls = p.ramp || p.preheat && false ? "ramp" : p.tempF >= 400 ? "hot" : "warm";
    const heatCls = p.ramp ? "ramp" : cls;
    const label = p.ramp ? "" : `<span>${p.tempF}°F</span>`;
    bars += `<div class="heat ${heatCls}" style="left:${l}px;top:${ty}px;width:${r - l}px;height:${th - 4}px">${label}</div>`;
  }
  let ticks = "";
  for (let m = t0; m <= t1; m += 30) ticks += `<div class="tick" style="left:${x(m)}px;height:${H}px"><span>${formatSpeech(m)}</span></div>`;
  const now = `<div class="now" style="left:${Math.max(0, Math.min(GRID, x(nowMin)))}px;height:${H + 8}px"><span>${formatSpeech(nowMin)}</span></div>`;
  const serve = `<div class="serve" style="left:${x(serveMin)}px;height:${H}px"><span>Dinner ${formatSpeech(serveMin)}</span></div>`;
  const oldServe = view.previousServeAt
    ? `<div class="serve old" style="left:${x(epochToLocalMin(view.previousServeAt, view.day))}px;height:${H}px"></div>`
    : "";
  return `<div class="lanes"><div class="labels">${labels}</div><div class="grid" style="height:${H}px;width:${GRID}px">${ticks}${wells}${bars}${oldServe}${serve}${now}</div></div>`;
}

function footer(view: PlanView): string {
  const items = view.upNext.map((u) => `<li><time>${formatSpeech(u.atMin)}</time><span>${esc(u.label)}</span><em>${esc(u.hint)}</em></li>`).join("");
  return `<footer><ol class="upnext">${items}</ol><button class="listen ${view.heard ? "heard" : ""}" type="button" id="listen">${esc(view.listening)}</button></footer>`;
}

function screen(view: PlanView): string {
  const nowMin = epochToLocalMin(view.now, view.day);
  const speed = view.clock.mode === "demo" && view.clock.speed !== 1 ? `<span class="pill">${view.clock.speed}×</span>` : "";
  const oven = view.ovenTempNow ? `<span>Oven ${view.ovenTempNow}°F</span><span class="sep"></span>` : "";
  const head = `<header><div class="brand">Kitchen Conductor<span>${esc(view.title)}</span></div><div class="status"><span class="clock">${clockLabel(nowMin)}</span>${speed}<span class="sep"></span>${oven}<span>Dinner ${formatSpeech(epochToLocalMin(view.serveAt, view.day))}</span></div></header>`;
  const chips = view.chips.map((c) => chip(c.label, c.style, c.tool, c.args)).join("");
  const banner = view.banner ? `<p class="banner">${esc(view.banner)}</p>` : "";
  const top = `<section class="next"><div class="lead"><h1>${esc(view.headline)}</h1><p class="meta">${esc(view.meta)}</p><div class="chips">${chips}</div>${banner}</div><div class="count"><div class="digits" data-to="${view.countdownTo}">${formatDigits(view.countdownSec)}</div><div class="what">${esc(view.countdownWhat)}</div><div class="sub">${esc(view.countdownSub)}</div></div></section>`;
  return `<div class="kc-screen" data-meal="${esc(view.mealId)}">${head}${top}${timeline(view)}${footer(view)}</div>`;
}

function list(view: ListView): string {
  const rows = view.items.map((item) => {
    const args = { mealId: view.mealId, items: [item.item], have: !item.have };
    return `<div class="row ${item.have ? "have" : ""}"><span>${esc(item.item)}${item.quantity ? ` <em style="color:var(--ink3);font-style:normal">${esc(item.quantity)}</em>` : ""}</span><button type="button"${attrs("set_have", args)}>${item.have ? "Have" : "Need"}</button></div>`;
  }).join("");
  return `<div class="kc-screen"><header><div class="brand">Kitchen Conductor<span>${esc(view.title)}</span></div></header><section class="next"><div class="lead"><h1>${esc(view.headline)}</h1><div class="chips">${chip("Back to the timeline", "primary", "status", { mealId: view.mealId })}</div></div></section><div class="list">${rows}</div></div>`;
}

function home(view: HomeView): string {
  const args = { dishes: ["turkey", "stuffing", "potatoes", "green beans", "gravy", "rolls"].map((name) => ({ name })), serveAt: "17:00" };
  return `<div class="kc-screen"><header><div class="brand">Kitchen Conductor<span>Thanksgiving</span></div></header><section class="next"><div class="lead"><h1>${esc(view.headline)}</h1><p class="meta">${esc(view.meta)}</p><div class="chips">${chip("Plan Thanksgiving at 5:00", "primary", "plan_meal", args)}</div></div></section><footer><ol class="upnext"></ol><button class="listen" type="button" id="listen">${esc(view.listening)}</button></footer></div>`;
}

export function renderScreen(model: CardModel): string {
  if (model.screen === "home") return home(model);
  if (model.screen === "list") return list(model);
  return screen(model);
}

export function renderDocument(model: CardModel, css: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Kitchen Conductor</title><style>${css}</style></head><body style="margin:0;background:#171513">${renderScreen(model)}</body></html>`;
}
