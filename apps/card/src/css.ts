import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const cardCss = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "card.css"), "utf8");
