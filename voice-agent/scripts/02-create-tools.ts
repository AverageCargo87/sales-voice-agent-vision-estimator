import fs from "node:fs";
import path from "node:path";
import { AGENT_ROOT, env } from "./utils/env.js";
import { readState, patchState, TOOL_NAMES, type ToolName } from "./utils/state.js";
import { ElevenLabsClient, type ConvaiToolDefinition } from "./utils/elevenlabs.js";
import { formatIssues, lintTools } from "./utils/lint.js";
import { sha256 } from "./utils/baseline.js";
import { createLogger } from "../../shared/logger.js";

const log = createLogger("02 tools");
const client = new ElevenLabsClient();

const PLACEHOLDER = "{{N8N_WEBHOOK_BASE}}";
/** Without N8N_WEBHOOK_BASE the tools get a valid placeholder URL; re-running after n8n is up PATCHes them. */
const PLACEHOLDER_BASE = "https://example.com";

const rawTools = JSON.parse(fs.readFileSync(path.join(AGENT_ROOT, "config", "tools.json"), "utf8")) as ConvaiToolDefinition[];
const n8nBase = env.n8n.webhookBase();
const base = n8nBase || PLACEHOLDER_BASE;
if (!n8nBase) log.warn(`N8N_WEBHOOK_BASE not set: tools point at ${PLACEHOLDER_BASE} until you re-run create-tools`);

/** Expands the base URL and the human hand-off name into a deep copy of the definition. */
function buildDefinition(tool: ConvaiToolDefinition): ConvaiToolDefinition {
  const json = JSON.stringify(tool).replaceAll(PLACEHOLDER, base).replaceAll("{{OWNER_NAME}}", env.owner.name());
  return JSON.parse(json) as ConvaiToolDefinition;
}

const definitions = rawTools.map(buildDefinition);
const issues = lintTools(definitions, { expectNames: TOOL_NAMES });
if (issues.length) {
  log.error(`Refusing to send tools that fail the gotcha lint:\n${formatIssues(issues)}`);
  process.exit(1);
}

const state = readState();
const existingIds = state.tool_ids ?? {};
const sentHashes = state.tool_hashes ?? {};

for (const definition of definitions) {
  const name = definition.name as ToolName;
  log.step(`Tool: ${name}`);
  const existingId = existingIds[name];
  // The API normalises what it stores, so "unchanged" is decided by a hash of what WE sent last time.
  const hash = sha256(JSON.stringify(definition));

  if (existingId) {
    try {
      await client.getTool(existingId); // still exists?
      if (sentHashes[name] === hash) {
        log.ok(`  unchanged: ${existingId}`);
        continue;
      }
      log.step("  definition changed: updating via PATCH");
      await client.updateTool(existingId, definition);
      patchState({ tool_hashes: { [name]: hash } });
      log.ok(`  updated: ${existingId}`);
      continue;
    } catch {
      log.warn(`  ${existingId} not found: creating a new one`);
    }
  }

  const created = await client.createTool(definition);
  const id = created.id ?? created.tool_id;
  if (!id) throw new Error(`createTool returned no id: ${JSON.stringify(created)}`);
  log.ok(`  created: ${id}`);
  patchState({ tool_ids: { [name]: id }, tool_hashes: { [name]: hash } });
}

const finalIds = readState().tool_ids ?? {};
console.log();
log.ok(`Done. Tools: ${Object.keys(finalIds).length}/${rawTools.length}`);
for (const [name, id] of Object.entries(finalIds)) log.dim(`  ${name.padEnd(24)} ${id}`);
