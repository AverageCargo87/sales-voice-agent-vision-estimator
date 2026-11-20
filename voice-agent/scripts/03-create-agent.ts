import fs from "node:fs";
import path from "node:path";
import { AGENT_ROOT, DRY_RUN, env } from "./utils/env.js";
import { readState, patchState } from "./utils/state.js";
import { ElevenLabsClient } from "./utils/elevenlabs.js";
import { buildAgentBaseline, pickTtsModel } from "./utils/baseline.js";
import { formatIssues, lintAgentBaseline } from "./utils/lint.js";
import { createLogger } from "../../shared/logger.js";

const log = createLogger("03 agent");
const client = new ElevenLabsClient();

// ── 1. Static config and prompt ────────────────────────────────────────────
const staticConfig = JSON.parse(fs.readFileSync(path.join(AGENT_ROOT, "config", "agent.json"), "utf8")) as Record<string, unknown>;
delete staticConfig["_comment"];
// LF only: a CRLF checkout (or an editor) must not change the payload sent to the API.
const systemPrompt = fs.readFileSync(path.join(AGENT_ROOT, "prompts", "system_prompt.md"), "utf8").replace(/\r\n/g, "\n");
log.info(`System prompt: ${systemPrompt.length} chars`);

// ── 2. Preconditions from earlier steps ────────────────────────────────────
const state = readState();
if (!state.kb_document_id || state.kb_status !== "succeeded") {
  log.error("Knowledge base not uploaded or not indexed yet: run npm run upload-kb first");
  process.exit(1);
}
const toolIds = Object.values(state.tool_ids ?? {}).filter((v): v is string => Boolean(v));
if (toolIds.length === 0) {
  log.error("No tools yet: run npm run create-tools first");
  process.exit(1);
}

const languages = env.agent.languages();
const voiceId = env.elevenlabs.voiceId();
if (!voiceId) {
  log.error("ELEVENLABS_VOICE_ID is not set: pick a multilingual voice in the ElevenLabs voice library");
  process.exit(1);
}

// ── 3. Full baseline = static defaults + dynamic overlay ───────────────────
const baseline = buildAgentBaseline({
  staticConfig,
  systemPrompt,
  name: env.agent.name(),
  llm: env.agent.llmModel(),
  languages,
  voiceId,
  toolIds,
  kbId: state.kb_document_id,
  kbName: "Acme Steel Homes KB v1.0",
  ttsOverride: env.agent.ttsModel(),
});

const primary = languages[0] ?? "en";
log.info(`Agent: ${baseline.name} | LLM ${env.agent.llmModel()} | voice ${voiceId}`);
log.info(`Languages: ${primary}${languages.length > 1 ? " + presets " + languages.slice(1).join(",") : ""} | TTS ${pickTtsModel(primary, env.agent.ttsModel())}`);
log.info(`KB ${state.kb_document_id} | ${toolIds.length} tools`);

// ── 4. Lint before sending: several of these mistakes are silently accepted by the API ──
const issues = lintAgentBaseline(baseline);
if (issues.length) {
  log.error(`Refusing to send an agent baseline that fails the gotcha lint:\n${formatIssues(issues)}`);
  process.exit(1);
}
log.ok("Baseline passes the gotcha lint");

// ── 5. Create, or update with the FULL baseline (gotcha #1) ────────────────
let agentId = state.agent_id;
if (agentId) {
  log.step(`Agent ${agentId} exists: safe PATCH with the full baseline`);
  try {
    await client.updateAgent(agentId, {}, { baseline });
    log.ok("Agent updated");
  } catch (e) {
    const msg = (e as Error).message;
    if (!/404|not found/i.test(msg)) throw e;
    log.warn(`Agent ${agentId} not found: creating a new one`);
    agentId = undefined;
  }
}
if (!agentId) {
  log.step("Creating the agent...");
  agentId = (await client.createAgent(baseline)).agent_id;
  log.ok(`Agent created: ${agentId}`);
}

patchState({ agent_id: agentId, agent_baseline: baseline as unknown as Record<string, unknown> });

console.log();
log.ok("Done.");
if (DRY_RUN) log.info("Dry run: review the payloads under .dry-run/requests/");
else log.info(`Test it in the ElevenLabs dashboard: https://elevenlabs.io/app/conversational-ai/agents/${agentId}`);
