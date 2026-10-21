/** America/Los_Angeles in November is PST (UTC−8). No tz database: the demo day is fixed. */

export const DEMO_DAY = "2026-11-26";
const PST_MIN = 8 * 60;

export function dayUtcMidnight(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

/** Epoch ms of a local minute on `day` (minutes from local midnight, may exceed 1440). */
export function localMinToEpoch(min: number, day = DEMO_DAY): number {
  return dayUtcMidnight(day) + (min + PST_MIN) * 60_000;
}

export function epochToLocalMin(epoch: number, day = DEMO_DAY): number {
  return Math.round((epoch - dayUtcMidnight(day)) / 60_000 - PST_MIN);
}

export function hm(h: number, m: number): number {
  return h * 60 + m;
}

export function formatSpeech(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  let h = Math.floor(m / 60);
  const mm = m % 60;
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${String(mm).padStart(2, "0")}`;
}

export function formatClock(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  let h = Math.floor(m / 60);
  const mm = m % 60;
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${String(mm).padStart(2, "0")} ${ap}`;
}

export function formatDigits(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export function mealNow(clock: { mode: "real" } | { mode: "demo"; anchorReal: number; anchorMeal: number; speed: number; paused?: boolean }, realNow = Date.now()): number {
  if (clock.mode === "real") return realNow;
  if (clock.paused) return clock.anchorMeal;
  return clock.anchorMeal + (realNow - clock.anchorReal) * clock.speed;
}

/** "17:00", "5", "5:00", "5 pm" → minutes from midnight. Undefined if it isn't a clock time. */
export function parseClock(text: string): number | undefined {
  const t = text.trim().toLowerCase();
  const hmMatch = t.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/);
  if (hmMatch) {
    let h = Number(hmMatch[1]);
    const m = Number(hmMatch[2]);
    const ap = hmMatch[3];
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    if (!ap && h <= 7) h += 12; // "5:00" at dinner is 17:00
    if (h === 24) h = 0;
    return h * 60 + m;
  }
  const hMatch = t.match(/^(\d{1,2})\s*(am|pm)?$/);
  if (hMatch) {
    let h = Number(hMatch[1]);
    const ap = hMatch[2];
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    if (!ap && h <= 7) h += 12;
    return h * 60;
  }
  return undefined;
}
