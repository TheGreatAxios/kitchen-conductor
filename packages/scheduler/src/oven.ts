/** Oven temperature rules. Adjusted times land on a 5-minute grid. */

export function roundUp5(n: number): number {
  return Math.ceil(n / 5) * 5;
}

/** Minutes to change temperature. Up: ceil(Δ/10) rounded up to 5 (350→425 is 8→10). Down: ceil(Δ/5). */
export function rampMinutes(fromF: number, toF: number): number {
  if (fromF === toF) return 0;
  const d = Math.abs(toF - fromF);
  const raw = toF > fromF ? Math.ceil(d / 10) : Math.ceil(d / 5);
  return roundUp5(raw);
}

/** Cold start to T. ceil((T−70)/25)+5. 350°F → 17 min. */
export function preheatMinutes(tempF: number): number {
  return Math.ceil((tempF - 70) / 25) + 5;
}

/**
 * A flexible dish may run within 50°F of its recipe temperature.
 * Each 25°F low adds 20% and rounds up to 5 min. Each 25°F high removes 15%.
 */
export function compromiseMinutes(base: number, recipeF: number, phaseF: number): { minutes: number; ok: boolean } {
  const delta = phaseF - recipeF;
  if (delta === 0) return { minutes: base, ok: true };
  if (Math.abs(delta) > 50) return { minutes: base, ok: false };
  const factor = delta < 0 ? 1 + (Math.abs(delta) / 25) * 0.2 : 1 - (delta / 25) * 0.15;
  return { minutes: Math.max(5, roundUp5(base * factor)), ok: true };
}
