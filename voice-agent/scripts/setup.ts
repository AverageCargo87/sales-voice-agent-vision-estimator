/**
 * npm run setup        -> preflight -> upload-kb -> create-tools -> create-agent
 * npm run setup:dry    -> the same chain against a local fake API (payloads printed and saved)
 * add `-- --fresh`     -> forget the previous dry run first
 *
 * Each step is its own process (as when run one by one); they hand off through state.json.
 * A runner instead of an `a && b && c` npm chain so the dry-run flag reaches every step on
 * every OS. Phone attachment stays a separate, deliberate step (npm run attach-phone).
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resetDryRun } from "./utils/dryrun.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const dry = process.argv.includes("--dry-run") || process.env.DRY_RUN === "1";
if (dry && process.argv.includes("--fresh")) resetDryRun();

const steps = ["00-preflight.ts", "01-upload-kb.ts", "02-create-tools.ts", "03-create-agent.ts"];
const started = Date.now();

for (const step of steps) {
  console.log(`\n=== ${step.replace(/\.ts$/, "")}${dry ? " (dry run)" : ""} ===`);
  const r = spawnSync(process.execPath, ["--import", "tsx", path.join(here, step)], {
    stdio: "inherit",
    env: { ...process.env, ...(dry ? { DRY_RUN: "1" } : {}) },
  });
  if (r.status !== 0) {
    console.error(`\n${step} failed (exit ${r.status ?? "signal"}): fix it and re-run; finished steps are skipped or updated in place.`);
    process.exit(r.status ?? 1);
  }
}

console.log(`\nSetup ${dry ? "dry run " : ""}complete in ${((Date.now() - started) / 1000).toFixed(1)} s.`);
