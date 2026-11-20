/**
 * The lintable ElevenLabs gotchas (#1, 2, 4, 6, 8, 9, 12, 13 in docs/ELEVENLABS_GOTCHAS.md)
 * as executable checks. The other five (#3, 5, 7, 10, 11) are runtime behaviour handled in
 * the client: KB polling, the SIP-trunk phone step, idempotent re-runs, the curl transport.
 *
 * Several of them fail SILENTLY on the API side (a field is accepted and dropped), so the
 * only reliable defence is to refuse to send a payload that would trigger one. The setup
 * scripts lint before every create/update, and `npm run check:agent` lints the shipped
 * config plus a deliberately broken copy for each rule, to prove every rule still fires.
 */

import { sha256 } from "./baseline.js";
import type { AgentBaseline, ConvaiToolDefinition, ToolSchema } from "./elevenlabs.js";

export type LintIssue = { gotcha: number; where: string; message: string };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);

/** ElevenLabs waits at most this long for a webhook tool (gotcha #4). */
export const WEBHOOK_TIMEOUT_CAP_SECS = 30;

/** Models an English-primary agent refuses (gotcha #13). */
const EN_FORBIDDEN_TTS = new Set(["eleven_turbo_v2_5", "eleven_flash_v2_5"]);

function lintSchemaNode(node: ToolSchema, where: string, isRoot: boolean, out: LintIssue[]): void {
  if (!node.type) out.push({ gotcha: 8, where, message: "schema node has no type" });
  // Gotcha #8: every property and every array `items` needs one of these four, or the API answers 422.
  const described =
    (typeof node.description === "string" && node.description.trim() !== "") ||
    typeof node.dynamic_variable === "string" ||
    node.is_system_provided === true ||
    node.constant_value !== undefined;
  if (!isRoot && !described) {
    out.push({ gotcha: 8, where, message: "needs description, dynamic_variable, is_system_provided or constant_value" });
  }
  if (node.enum !== undefined && (!Array.isArray(node.enum) || node.enum.length === 0)) {
    out.push({ gotcha: 8, where, message: "enum must be a non-empty array" });
  }
  if (node.type === "object") {
    const props = node.properties ?? {};
    for (const req of node.required ?? []) {
      if (!(req in props)) out.push({ gotcha: 8, where, message: `required field "${req}" is not in properties` });
    }
    for (const [key, child] of Object.entries(props)) lintSchemaNode(child, `${where}.${key}`, false, out);
  }
  if (node.type === "array") {
    if (!node.items) out.push({ gotcha: 8, where, message: "array without items" });
    else lintSchemaNode(node.items, `${where}[items]`, false, out);
  }
}

export function lintTools(tools: ConvaiToolDefinition[], opts: { expectNames?: readonly string[] } = {}): LintIssue[] {
  const out: LintIssue[] = [];
  const seen = new Set<string>();
  for (const t of tools) {
    const where = `tool ${t.name || "(unnamed)"}`;
    if (!t.name || !/^[a-z][a-z0-9_]*$/.test(t.name)) out.push({ gotcha: 2, where, message: "tool name must be snake_case and stable" });
    if (seen.has(t.name)) out.push({ gotcha: 2, where, message: "duplicate tool name" });
    seen.add(t.name);
    if (!t.description?.trim()) out.push({ gotcha: 8, where, message: "tool has no description" });
    if (t.type !== "webhook" || !t.api_schema) {
      out.push({ gotcha: 2, where, message: "expected a workspace webhook tool with api_schema" });
      continue;
    }
    const url = t.api_schema.url;
    if (!/^https:\/\//.test(url) && !url.startsWith("{{N8N_WEBHOOK_BASE}}")) {
      out.push({ gotcha: 4, where, message: `webhook url must be https (got "${url}")` });
    }
    const timeout = t.response_timeout_secs;
    if (timeout === undefined || timeout < 1 || timeout > WEBHOOK_TIMEOUT_CAP_SECS) {
      out.push({ gotcha: 4, where, message: `response_timeout_secs must be 1..${WEBHOOK_TIMEOUT_CAP_SECS} (got ${String(timeout)})` });
    }
    if (t.api_schema.request_body_schema) lintSchemaNode(t.api_schema.request_body_schema, `${where} body`, true, out);
  }
  for (const name of opts.expectNames ?? []) {
    if (!seen.has(name)) out.push({ gotcha: 2, where: `tool ${name}`, message: "expected tool is missing" });
  }
  return out;
}

export function lintAgentBaseline(b: AgentBaseline): LintIssue[] {
  const out: LintIssue[] = [];
  const cc = isObj(b.conversation_config) ? b.conversation_config : {};
  const agent = isObj(cc.agent) ? cc.agent : {};
  const prompt = isObj(agent.prompt) ? agent.prompt : {};
  const tts = isObj(cc.tts) ? cc.tts : {};
  const language = typeof agent.language === "string" ? agent.language : "";

  // Gotcha #1: a PATCH replaces top-level objects, so the baseline must be complete.
  const mustHave: Array<[string, unknown]> = [
    ["name", b.name],
    ["conversation_config.agent.language", agent.language],
    ["conversation_config.agent.first_message", agent.first_message],
    ["conversation_config.agent.prompt.prompt", prompt.prompt],
    ["conversation_config.agent.prompt.llm", prompt.llm],
    ["conversation_config.tts.voice_id", tts.voice_id],
    ["conversation_config.tts.model_id", tts.model_id],
    ["platform_settings", b.platform_settings],
  ];
  for (const [path, v] of mustHave) {
    if (v === undefined || v === null || v === "") out.push({ gotcha: 1, where: path, message: "missing: a partial baseline would wipe this field on PATCH" });
  }

  // Gotcha #2: tools by reference only.
  if ("tools" in prompt) out.push({ gotcha: 2, where: "conversation_config.agent.prompt.tools", message: "inline tools are deprecated: use tool_ids" });
  if (!Array.isArray(prompt.tool_ids) || prompt.tool_ids.length === 0) {
    out.push({ gotcha: 2, where: "conversation_config.agent.prompt.tool_ids", message: "no tool_ids" });
  }

  // Gotcha #6: knowledge base entries are objects with a usage mode.
  const kb = Array.isArray(prompt.knowledge_base) ? prompt.knowledge_base : [];
  if (kb.length === 0) out.push({ gotcha: 6, where: "conversation_config.agent.prompt.knowledge_base", message: "no knowledge base attached" });
  kb.forEach((entry, i) => {
    const e = isObj(entry) ? entry : {};
    for (const k of ["id", "name", "type", "usage_mode"]) {
      if (!e[k]) out.push({ gotcha: 6, where: `knowledge_base[${i}].${k}`, message: "missing" });
    }
    if (e.usage_mode && e.usage_mode !== "auto" && e.usage_mode !== "prompt") {
      out.push({ gotcha: 6, where: `knowledge_base[${i}].usage_mode`, message: `must be "auto" (RAG) or "prompt"` });
    }
  });

  // Gotcha #9: additional_languages is silently dropped.
  if ("additional_languages" in agent) {
    out.push({ gotcha: 9, where: "conversation_config.agent.additional_languages", message: "silently ignored by the API: use conversation_config.language_presets" });
  }

  // Gotchas #12 and #13 inside the presets.
  const presets = isObj(cc.language_presets) ? cc.language_presets : {};
  const expectedHash = typeof agent.first_message === "string" ? sha256(agent.first_message) : "";
  for (const [lang, raw] of Object.entries(presets)) {
    const p = isObj(raw) ? raw : {};
    const where = `language_presets.${lang}`;
    if (lang === language) out.push({ gotcha: 9, where, message: "preset duplicates the primary language" });
    const tr = p.first_message_translation;
    if (tr !== undefined) {
      const t = isObj(tr) ? tr : {};
      if (!t.text) out.push({ gotcha: 12, where: `${where}.first_message_translation.text`, message: "missing" });
      if (t.source_hash !== expectedHash) {
        out.push({ gotcha: 12, where: `${where}.first_message_translation.source_hash`, message: "must be SHA-256 of the primary first_message" });
      }
    }
    const ov = isObj(p.overrides) ? p.overrides : {};
    if (isObj(ov.tts) && "model_id" in ov.tts) {
      out.push({ gotcha: 13, where: `${where}.overrides.tts.model_id`, message: "silently dropped: the base TTS model must be multilingual" });
    }
  }

  // Gotcha #13: English-primary agents refuse turbo/flash v2_5.
  if (language === "en" && typeof tts.model_id === "string" && EN_FORBIDDEN_TTS.has(tts.model_id)) {
    out.push({ gotcha: 13, where: "conversation_config.tts.model_id", message: `"${tts.model_id}" is rejected for English-primary agents: use eleven_multilingual_v2` });
  }

  return out;
}

export function formatIssues(issues: LintIssue[]): string {
  return issues.map((i) => `  gotcha #${i.gotcha}  ${i.where}: ${i.message}`).join("\n");
}
