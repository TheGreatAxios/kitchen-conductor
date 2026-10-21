import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "apps/sim/dist");
mkdirSync(out, { recursive: true });

await esbuild.build({
  entryPoints: {
    sim: join(root, "apps/sim/src/main.ts"),
    voiceover: join(root, "apps/sim/src/voiceover.ts"),
  },
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outdir: out,
  logLevel: "warning",
});

for (const file of ["index.html", "sim.css", "voiceover.html"]) {
  cpSync(join(root, "apps/sim/public", file), join(out, file));
}
