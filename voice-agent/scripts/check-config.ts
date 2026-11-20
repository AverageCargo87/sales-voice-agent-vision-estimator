/**
 * npm run check:agent: offline, no keys.
 *
 *   1. The shipped tools.json and the agent baseline built from agent.json pass the gotcha lint.
 *   2. Every lint rule still fires: a deliberately broken copy per rule must be rejected.
 *   3. Contract between layers: for every tool whose n8n workflow is built, the webhook path,
 *      the "respond first" shape (gotcha #4), the fields the workflow reads and the CRM columns
 *      it writes must match tools.json and the sheet schema in setup-crm-sheet.gs.
 */

import fs from "node:fs";
import path from "node:path";
import { AGENT_ROOT, REPO_ROOT } from "./utils/env.js";
import { TOOL_NAMES } from "./utils/state.js";
import { buildAgentBaseline, pickTtsModel } from "./utils/baseline.js";
import { deepMerge, type AgentBaseline, type ConvaiToolDefinition, type ToolSchema } from "./utils/elevenlabs.js";
import { lintAgentBaseline, lintTools, type LintIssue } from "./utils/lint.js";

const tty = process.stdout.isTTY === true;
const OK = tty ? "\x1b[32m✓\x1b[0m" : "✓";
const NO = tty ? "\x1b[31m✗\x1b[0m" : "✗";
let failures = 0;
let passes = 0;
function check(pass: boolean, label: string): void {
  if (pass) passes++;
  else failures++;
  console.log(`${pass ? OK : NO} ${label}`);
}
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// ─────────────────────────────────────────────────────────────────────────────
// 1. Shipped config
// ─────────────────────────────────────────────────────────────────────────────

const tools = JSON.parse(fs.readFileSync(path.join(AGENT_ROOT, "config/tools.json"), "utf8")) as ConvaiToolDefinition[];
const staticConfig = JSON.parse(fs.readFileSync(path.join(AGENT_ROOT, "config/agent.json"), "utf8")) as Record<string, unknown>;
delete staticConfig._comment;
const systemPrompt = fs.readFileSync(path.join(AGENT_ROOT, "prompts/system_prompt.md"), "utf8").replace(/\r\n/g, "\n");

const baselineFor = (languages: string[], ttsOverride?: string): AgentBaseline =>
  buildAgentBaseline({
    staticConfig: clone(staticConfig),
    systemPrompt,
    name: "Eric - Acme Steel Homes",
    llm: "claude-haiku-4-5",
    languages,
    voiceId: "voice_example",
    toolIds: TOOL_NAMES.map((n) => `tool_${n}`),
    kbId: "kb_example",
    kbName: "Acme Steel Homes KB v1.0",
    ...(ttsOverride ? { ttsOverride } : {}),
  });

console.log("\n-- SHIPPED CONFIG --");
const toolIssues = lintTools(tools, { expectNames: TOOL_NAMES });
check(toolIssues.length === 0, `tools.json: ${tools.length} webhook tools pass the lint${toolIssues.length ? ": " + JSON.stringify(toolIssues) : ""}`);
for (const langs of [["en", "ru", "el"], ["ru", "en", "el"], ["el", "en", "ru"]]) {
  const b = baselineFor(langs);
  const issues = lintAgentBaseline(b);
  const tts = (b.conversation_config.tts as Record<string, unknown>).model_id;
  check(issues.length === 0, `agent baseline, primary ${langs[0]} + presets ${langs.slice(1).join(",")}: passes (TTS ${String(tts)})${issues.length ? ": " + JSON.stringify(issues) : ""}`);
}
check(pickTtsModel("en") === "eleven_multilingual_v2" && pickTtsModel("ru") === "eleven_turbo_v2_5", "TTS auto-pick: en -> multilingual_v2, ru -> turbo_v2_5 (gotcha #13)");

// ─────────────────────────────────────────────────────────────────────────────
// 2. Every rule fires on a broken copy
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n-- EACH RULE REJECTS A BROKEN COPY --");
const firesFor = (issues: LintIssue[], gotcha: number) => issues.some((i) => i.gotcha === gotcha);
const bodyOf = (t: ConvaiToolDefinition[], name: string): ToolSchema => t.find((x) => x.name === name)!.api_schema!.request_body_schema!;

{
  const t = clone(tools);
  delete bodyOf(t, "create_lead").properties!.phone!.description;
  check(firesFor(lintTools(t), 8), "#8  property without a description -> rejected");
}
{
  const t = clone(tools);
  delete bodyOf(t, "send_materials").properties!.materials!.items!.description;
  check(firesFor(lintTools(t), 8), "#8  array items without a description -> rejected");
}
{
  const t = clone(tools);
  bodyOf(t, "book_consultation").required!.push("budget");
  check(firesFor(lintTools(t), 8), "#8  required field missing from properties -> rejected");
}
{
  const t = clone(tools);
  t[0]!.response_timeout_secs = 45;
  check(firesFor(lintTools(t), 4), "#4  webhook timeout above the 30 s platform cap -> rejected");
}
{
  const t = clone(tools).filter((x) => x.name !== "end_call_summary");
  check(firesFor(lintTools(t, { expectNames: TOOL_NAMES }), 2), "#2  one of the 6 tools missing -> rejected");
}
const mutate = (fn: (b: Record<string, any>) => void): LintIssue[] => {
  const b = clone(baselineFor(["en", "ru", "el"])) as unknown as Record<string, any>;
  fn(b);
  return lintAgentBaseline(b as unknown as AgentBaseline);
};
check(firesFor(mutate((b) => delete b.platform_settings), 1), "#1  partial baseline (no platform_settings) -> rejected");
check(firesFor(mutate((b) => delete b.conversation_config.tts.voice_id), 1), "#1  partial baseline (no voice) -> rejected");
check(firesFor(mutate((b) => (b.conversation_config.agent.prompt.tools = [{ name: "x" }])), 2), "#2  inline tools on the agent -> rejected");
check(firesFor(mutate((b) => (b.conversation_config.agent.prompt.knowledge_base[0].usage_mode = "rag")), 6), "#6  unknown KB usage_mode -> rejected");
check(firesFor(mutate((b) => (b.conversation_config.agent.additional_languages = ["ru", "el"])), 9), "#9  additional_languages (silently dropped) -> rejected");
check(firesFor(mutate((b) => (b.conversation_config.language_presets.ru.first_message_translation.source_hash = "0".repeat(64))), 12), "#12 stale first_message source_hash -> rejected");
check(firesFor(mutate((b) => (b.conversation_config.tts.model_id = "eleven_turbo_v2_5")), 13), "#13 English primary + turbo_v2_5 -> rejected");
check(firesFor(mutate((b) => (b.conversation_config.language_presets.el.overrides.tts = { model_id: "eleven_turbo_v2_5" })), 13), "#13 per-language TTS override (silently dropped) -> rejected");
{
  const full = baselineFor(["en", "ru", "el"]);
  const merged = deepMerge(full as unknown as Record<string, unknown>, { name: "Renamed" }) as unknown as AgentBaseline;
  check(lintAgentBaseline(merged).length === 0 && merged.name === "Renamed", "#1  updateAgent merges a delta into the full baseline, nothing is wiped");
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Contract: tools.json <-> n8n workflows <-> CRM sheet schema
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n-- CONTRACT: tool schema <-> n8n workflow <-> CRM sheet --");
type N8nNode = { name: string; type: string; parameters: Record<string, any> };
type N8nWorkflow = { name: string; nodes: N8nNode[]; connections: Record<string, { main: Array<Array<{ node: string }>> }> };

const gs = fs.readFileSync(path.join(REPO_ROOT, "command-center/sheets/setup-crm-sheet.gs"), "utf8");
function sheetColumns(tab: string): string[] {
  const m = new RegExp(`\\b${tab}:\\s*\\[([\\s\\S]*?)\\]`).exec(gs);
  return m ? [...m[1]!.matchAll(/"([a-z0-9_]+)"/g)].map((x) => x[1]!) : [];
}
function enumValues(name: string): string[] {
  const m = new RegExp(`\\b${name}:\\s*\\[([\\s\\S]*?)\\]`).exec(gs.slice(gs.indexOf("const ENUMS")));
  return m ? [...m[1]!.matchAll(/"([a-z0-9_]+)"/g)].map((x) => x[1]!) : [];
}

const BUILT: Array<{ tool: string; file: string; tab: string; statusEnum: string }> = [
  { tool: "create_lead", file: "acme-tool-create-lead.json", tab: "Leads", statusEnum: "lead_status" },
  { tool: "book_consultation", file: "acme-tool-book-consultation.json", tab: "Bookings", statusEnum: "booking_status" },
];

for (const c of BUILT) {
  const wf = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "command-center/n8n", c.file), "utf8")) as N8nWorkflow;
  const tool = tools.find((t) => t.name === c.tool)!;
  const hook = wf.nodes.find((n) => n.type === "n8n-nodes-base.webhook");
  const toolPath = new URL(tool.api_schema!.url.replace("{{N8N_WEBHOOK_BASE}}", "https://n8n.example.com")).pathname;
  check(!!hook && toolPath === `/webhook/${String(hook.parameters.path)}`, `${c.tool}: tools.json URL path ${toolPath} matches the n8n webhook`);

  const first = hook ? wf.connections[hook.name]?.main[0]?.[0]?.node : undefined;
  const firstNode = wf.nodes.find((n) => n.name === first);
  check(
    hook?.parameters.responseMode === "responseNode" && firstNode?.type === "n8n-nodes-base.respondToWebhook",
    `${c.tool}: answers first ("${first}") and works after, inside the 30 s tool timeout (#4)`,
  );

  const schemaFields = Object.keys(tool.api_schema!.request_body_schema!.properties ?? {}).sort();
  const normalize = wf.nodes.find((n) => n.type === "n8n-nodes-base.set");
  const readFields = ((normalize?.parameters.assignments?.assignments ?? []) as Array<{ name: string }>).map((a) => a.name).sort();
  check(JSON.stringify(schemaFields) === JSON.stringify(readFields), `${c.tool}: workflow reads exactly the ${schemaFields.length} fields the tool schema sends`);

  const sheetNode = wf.nodes.find((n) => n.type === "n8n-nodes-base.googleSheets");
  const written = Object.keys(sheetNode?.parameters.columns?.value ?? {});
  const columns = sheetColumns(c.tab);
  const unknown = written.filter((w) => !columns.includes(w));
  check(columns.length > 0 && unknown.length === 0, `${c.tool}: all ${written.length} columns written exist in the ${c.tab} tab${unknown.length ? " (unknown: " + unknown.join(", ") + ")" : ""}`);

  const status = String(sheetNode?.parameters.columns?.value?.status ?? "");
  const allowed = enumValues(c.statusEnum);
  check(allowed.includes(status), `${c.tool}: status "${status}" is in the ${c.tab} validation list`);

  for (const field of ["segment", "language", "meeting_type"]) {
    const toolEnum = tool.api_schema!.request_body_schema!.properties?.[field]?.enum as string[] | undefined;
    const sheetEnum = enumValues(field);
    if (toolEnum && sheetEnum.length) {
      const missing = toolEnum.filter((v) => !sheetEnum.includes(v));
      check(missing.length === 0, `${c.tool}: every ${field} value the agent can send is valid in the sheet`);
    }
  }
}

const designed = TOOL_NAMES.filter((n) => !BUILT.some((b) => b.tool === n));
console.log(`   (designed, workflow not built yet: ${designed.join(", ")})`);

console.log(failures === 0 ? `\n${OK} CHECK PASS (${passes} checks)` : `\n${NO} CHECK FAILED: ${failures} of ${passes + failures}`);
process.exit(failures === 0 ? 0 : 1);
