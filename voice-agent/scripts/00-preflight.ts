import fs from "node:fs";
import path from "node:path";
import { AGENT_ROOT, DRY_RUN, REPO_ROOT, env } from "./utils/env.js";
import { readState, TOOL_NAMES } from "./utils/state.js";
import { ElevenLabsClient, type ConvaiToolDefinition } from "./utils/elevenlabs.js";
import { formatIssues, lintTools } from "./utils/lint.js";
import { createLogger } from "../../shared/logger.js";

const log = createLogger("00 preflight");
let warnings = 0;
let fatals = 0;
const fatal = (msg: string) => (log.error(msg), fatals++);
const warn = (msg: string) => (log.warn(msg), warnings++);

if (DRY_RUN) log.info("DRY RUN: ElevenLabs is answered by a local fake API, nothing leaves this machine");

// ── 1. Files ────────────────────────────────────────────────────────────────
const kbPath = env.agent.kbPath();
const required = [kbPath, path.join(AGENT_ROOT, "config/tools.json"), path.join(AGENT_ROOT, "config/agent.json"), path.join(AGENT_ROOT, "prompts/system_prompt.md")];
if (!DRY_RUN) required.push(path.join(REPO_ROOT, ".env"));
for (const abs of required) {
  const rel = path.relative(REPO_ROOT, abs).replace(/\\/g, "/");
  if (fs.existsSync(abs)) log.ok(`${rel} (${fs.statSync(abs).size} bytes)`);
  else fatal(`Missing required file: ${rel}`);
}
if (kbPath.endsWith("knowledge_base.example.md")) {
  warn("Using the public example knowledge base: put the real one in voice-agent/knowledge_base.md (gitignored)");
}

// ── 2. Tool definitions: lint against the known API gotchas before anything is sent ──
try {
  const tools = JSON.parse(fs.readFileSync(path.join(AGENT_ROOT, "config/tools.json"), "utf8")) as ConvaiToolDefinition[];
  const issues = lintTools(tools, { expectNames: TOOL_NAMES });
  if (issues.length) fatal(`tools.json fails ${issues.length} check(s):\n${formatIssues(issues)}`);
  else log.ok(`tools.json: ${tools.length} webhook tools pass the gotcha lint`);
} catch (e) {
  fatal(`tools.json unreadable: ${(e as Error).message}`);
}

// ── 3. Environment ──────────────────────────────────────────────────────────
let apiKey = "";
try {
  apiKey = env.elevenlabs.apiKey();
  log.ok(DRY_RUN ? "ELEVENLABS_API_KEY not needed for a dry run" : `ELEVENLABS_API_KEY set (length ${apiKey.length})`);
} catch {
  fatal("ELEVENLABS_API_KEY missing: add it to .env");
}

const voiceId = env.elevenlabs.voiceId();
if (voiceId) log.ok(`ELEVENLABS_VOICE_ID: ${voiceId}`);
else warn("ELEVENLABS_VOICE_ID not set: create-agent will stop until a multilingual voice is chosen");

const n8nBase = env.n8n.webhookBase();
if (n8nBase) log.ok(`N8N_WEBHOOK_BASE: ${n8nBase}`);
else warn("N8N_WEBHOOK_BASE not set: tools get a placeholder URL; re-run create-tools once n8n is up");

log.info(`AGENT_NAME: ${env.agent.name()} | LLM_MODEL: ${env.agent.llmModel()} | AGENT_LANGUAGES: ${env.agent.languages().join(", ")}`);

// ── 4. ElevenLabs API ping ──────────────────────────────────────────────────
if (apiKey) {
  const client = new ElevenLabsClient(apiKey);
  try {
    const r = await client.listAgents({ pageSize: 5 });
    log.ok(`ElevenLabs API reachable: ${r.agents.length} agent(s) in the workspace`);
  } catch (e) {
    fatal(`ElevenLabs API ping failed: ${(e as Error).message.split("\n")[0]}`);
  }
  if (voiceId) {
    try {
      const v = await client.getVoice(voiceId);
      log.ok(`Voice "${v.name}" is valid`);
    } catch (e) {
      warn(`Could not verify the voice (needs Voices=Read, or the id is wrong): ${(e as Error).message.split("\n")[0]}`);
    }
  }
}

// ── 5. n8n ping (optional) ─────────────────────────────────────────────────
if (n8nBase && !DRY_RUN) {
  try {
    const res = await fetch(n8nBase, { method: "GET", signal: AbortSignal.timeout(5000) });
    if (res.ok || res.status === 404) log.ok(`n8n reachable (${res.status})`);
    else warn(`n8n answered ${res.status}: the base URL responds, webhook paths are checked per tool`);
  } catch (e) {
    warn(`n8n unreachable at ${n8nBase}: ${(e as Error).message}`);
  }
}

// ── 6. State summary ───────────────────────────────────────────────────────
const state = readState();
log.info("state:");
log.dim(`  kb_document_id:  ${state.kb_document_id ?? "-"} (${state.kb_status ?? "-"})`);
log.dim(`  tool_ids:        ${state.tool_ids ? Object.keys(state.tool_ids).length : 0}/${TOOL_NAMES.length}`);
log.dim(`  agent_id:        ${state.agent_id ?? "-"}`);
log.dim(`  phone_number_id: ${state.phone_number_id ?? "-"}`);

console.log();
if (fatals > 0) {
  log.error(`Preflight FAILED: ${fatals} fatal, ${warnings} warning(s)`);
  process.exit(1);
}
if (warnings > 0) log.warn(`Preflight passed with ${warnings} warning(s)`);
else log.ok("Preflight passed");
