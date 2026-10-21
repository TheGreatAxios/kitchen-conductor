import type { CrossLink } from "@kc/core";

/** Cross-dish lags for the Thanksgiving library. Dropped when a dish isn't in the meal. */
export const CROSS_LINKS: CrossLink[] = [
  { dish: "potatoes", step: "peel", afterDish: "stuffing", afterStep: "prep", lagMin: 5 },
  { dish: "gravy", step: "simmer", afterDish: "turkey", afterStep: "roast", lagMin: 5 },
  { dish: "beans", step: "cook", afterDish: "potatoes", afterStep: "mash", lagMin: 0 },
];
