/** Shared meal model. Epoch milliseconds are on the meal clock. */

export type StepKind = "prep" | "oven" | "stovetop" | "rest" | "hold" | "check";
export type StepStatus = "pending" | "running" | "done" | "skipped";
export type StepSource = "library" | "bedrock" | "manual";

export type Resource =
  | { kind: "oven"; rack: number }
  | { kind: "burner"; n: number }
  | { kind: "hands" }
  | { kind: "counter" };

export interface StepLink {
  stepId: string;
  lagMin?: number;
  maxLagMin?: number;
}

export interface Step {
  id: string;
  dishId: string;
  name: string;
  detail?: string;
  kind: StepKind;
  /** Placed duration. */
  minutes: number;
  /** Recipe duration before temperature compromise. */
  baseMinutes?: number;
  minMinutes?: number;
  maxMinutes?: number;
  ovenTempF?: number;
  appliedTempF?: number;
  tempFlexible?: boolean;
  hands: 0 | 1 | 2;
  after: StepLink[];
  holdMin?: number;
  source: StepSource;
  timeMissing?: boolean;
  /** Copied from the dish so a plan can be summarized without the recipe book. */
  dishName?: string;
  shortDish?: string;
  summaryOrder?: number;
  /** Child of an oven step, placed at parent.start + offsetMin (basting). */
  offsetOf?: string;
  offsetMin?: number;
}

export interface ScheduledStep extends Step {
  startAt: number;
  endAt: number;
  resource: Resource;
  ovenPhaseId?: string;
  adjustedNote?: string;
  status: StepStatus;
}

export interface OvenPhase {
  id: string;
  tempF: number;
  startAt: number;
  endAt: number;
  ramp: boolean;
  /** Food may enter at readyAt. Preheat occupies [startAt, readyAt). */
  readyAt?: number;
  preheat?: boolean;
}

export interface PlanChange {
  stepId: string;
  oldStartAt: number;
  newStartAt: number;
  deltaMin: number;
}

export interface PlanOption {
  id: "keep_serve_time" | "move_serve_time";
  label: string;
  serveAt: number;
  lateDishes: string[];
}

export interface Plan {
  mealId: string;
  version: number;
  serveAt: number;
  createdAt: number;
  /** Local calendar day the minute math used, YYYY-MM-DD. */
  day: string;
  steps: ScheduledStep[];
  ovenPhases: OvenPhase[];
  changes: PlanChange[];
  options: PlanOption[];
  summary: string;
  warnings: string[];
  /** Set when a shift is waiting on Sounds good / keep 5:00. */
  choicePending?: boolean;
  cooks: 1 | 2;
  racks: number;
  burners: number;
}

export interface Ingredient {
  item: string;
  quantity?: string;
  pantry?: boolean;
}

export interface HandsTouch {
  key: string;
  name: string;
  offsetMin: number;
  minutes: number;
  hands: 0 | 1 | 2;
}

export interface RecipeStep {
  key: string;
  name: string;
  detail?: string;
  kind: StepKind;
  minutes: number;
  minMinutes?: number;
  maxMinutes?: number;
  ovenTempF?: number;
  tempFlexible?: boolean;
  hands: 0 | 1 | 2;
  after?: { key: string; lagMin?: number; maxLagMin?: number }[];
  holdMin?: number;
  /** Stretch from the predecessor's end up to serve, capped by holdMin. */
  spanToServe?: boolean;
  handsAt?: HandsTouch[];
}

export interface RecipeDish {
  id: string;
  name: string;
  /** Lowercase word used in the one-sentence reflow summary. */
  shortName: string;
  aliases: string[];
  glaze: string;
  fg: string;
  servings?: number;
  summaryOrder: number;
  ingredients: Ingredient[];
  steps: RecipeStep[];
}

export interface CrossLink {
  dish: string;
  step: string;
  afterDish: string;
  afterStep: string;
  lagMin?: number;
  maxLagMin?: number;
}

export interface Dish {
  id: string;
  name: string;
  glaze: string;
  fg: string;
  servings?: number;
  ingredients: Ingredient[];
  steps: Step[];
}

export type Clock =
  | { mode: "real" }
  | { mode: "demo"; anchorReal: number; anchorMeal: number; speed: number; paused?: boolean };

export interface Meal {
  mealId: string;
  title: string;
  tz: string;
  cooks: 1 | 2;
  racks: number;
  burners: number;
  dishes: Dish[];
  planVersion: number;
  serveAt: number;
  clock: Clock;
  createdAt: number;
  ttl: number;
  day: string;
  choicePending?: boolean;
  heard?: string;
}

export interface PlanView extends Plan {
  now: number;
  nextStepId?: string;
  ovenTempNow?: number;
  minutesToServe: number;
  title: string;
  headline: string;
  meta: string;
  countdownSec: number;
  /** Meal-clock epoch the digits count toward. */
  countdownTo: number;
  countdownWhat: string;
  countdownSub: string;
  upNext: { atMin: number; label: string; hint: string }[];
  chips: { id: string; label: string; style: "primary" | "default" | "skip" | "ghost"; tool?: string; args?: Record<string, unknown> }[];
  listening: string;
  heard: boolean;
  screen: "timeline";
  glazes: { id: string; name: string; glaze: string; fg: string }[];
  ghosts?: { stepId: string; startAt: number; endAt: number }[];
  previousServeAt?: number;
  clock: Clock;
  canUndo: boolean;
  banner?: string;
  fired: string[];
}

export interface ListItem {
  item: string;
  quantity?: string;
  dishIds: string[];
  have: boolean;
  onList: boolean;
  addedAt?: number;
}

export interface ListView {
  mealId: string;
  screen: "list";
  title: string;
  headline: string;
  items: ListItem[];
  added: string[];
  listening: string;
  heard: boolean;
  clock: Clock;
  now: number;
}

export interface HomeView {
  screen: "home";
  title: string;
  headline: string;
  meta: string;
  listening: string;
  heard: boolean;
}
