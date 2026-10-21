import type { CrossLink, RecipeDish, StepKind, StepSource, StepStatus } from "@kc/core";

/** Working step. Times are local minutes from midnight on the meal day. */
export interface WStep {
  id: string;
  dishId: string;
  dishName: string;
  shortDish: string;
  summaryOrder: number;
  glaze: string;
  fg: string;
  name: string;
  detail: string;
  kind: StepKind;
  baseMinutes: number;
  duration: number;
  minMinutes: number;
  maxMinutes: number;
  ovenTempF?: number;
  appliedTempF?: number;
  tempFlexible: boolean;
  hands: 0 | 1 | 2;
  after: { stepId: string; lagMin: number; maxLagMin?: number }[];
  holdMin?: number;
  spanToServe: boolean;
  offsetOf?: string;
  offsetMin?: number;
  status: StepStatus;
  pin: boolean;
  start: number;
  end: number;
  rack?: number;
  burner?: number;
  adjustedNote?: string;
  source: StepSource;
  timeMissing?: boolean;
  /** Set when a not-yet-started step must start at least this late. */
  notBefore?: number;
}

export interface ScheduleCtx {
  mealId: string;
  version: number;
  createdAt: number;
  day: string;
  serveMin: number;
  nowMin: number;
  cooks: 1 | 2;
  racks: number;
  burners: number;
  relaxHold?: boolean;
  mode: "compact" | "late";
}

export interface Expanded {
  steps: WStep[];
  dishes: RecipeDish[];
  links: CrossLink[];
}

export const UNPLACED = Number.NaN;

export function isPlaced(s: WStep): boolean {
  return Number.isFinite(s.start) && Number.isFinite(s.end);
}
