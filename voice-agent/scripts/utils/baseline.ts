import crypto from "node:crypto";
import { deepMerge, type AgentBaseline } from "./elevenlabs.js";

export function sha256(s: string): string {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

export const FIRST_MESSAGES: Readonly<Record<string, string>> = {
  ru: "Здравствуйте! Eric из Acme Steel Homes. Чем могу помочь? Говорю по-русски, English и ελληνικά.",
  en: "Hi, I'm Eric from Acme Steel Homes. How can I help? I speak English, Greek and Russian.",
  el: "Γεια σας! Είμαι ο Eric από την Acme Steel Homes. Πώς μπορώ να βοηθήσω; Μιλάω ελληνικά, English και по-русски.",
};

/**
 * Gotcha #13: an English-primary agent rejects the multilingual turbo/flash v2_5 models,
 * and a per-language TTS override in language_presets is silently dropped. So the BASE
 * model must already be multilingual: en-primary -> eleven_multilingual_v2, any other
 * primary -> the faster eleven_turbo_v2_5. TTS_MODEL overrides.
 */
export function pickTtsModel(primaryLanguage: string, override?: string): string {
  if (override) return override;
  return primaryLanguage === "en" ? "eleven_multilingual_v2" : "eleven_turbo_v2_5";
}

export type BaselineInput = {
  /** config/agent.json without its _comment */
  staticConfig: Record<string, unknown>;
  systemPrompt: string;
  name: string;
  llm: string;
  languages: string[];
  voiceId: string;
  toolIds: string[];
  kbId: string;
  kbName: string;
  ttsOverride?: string;
};

/**
 * Static defaults (config/agent.json) + the dynamic overlay (prompt, LLM, tools, KB, voice,
 * languages) = the FULL baseline sent on create and on every update (gotcha #1).
 */
export function buildAgentBaseline(input: BaselineInput): AgentBaseline {
  const primary = input.languages[0] ?? "en";
  const additional = input.languages.slice(1);
  const firstMessage = FIRST_MESSAGES[primary] ?? FIRST_MESSAGES.en!;

  const overlay: Record<string, unknown> = {
    name: input.name,
    conversation_config: {
      agent: {
        language: primary,
        first_message: firstMessage,
        prompt: {
          prompt: input.systemPrompt,
          llm: input.llm,
          tool_ids: input.toolIds,
          // usage_mode "auto" = RAG retrieval on demand; "prompt" would inline the whole document (gotcha #6)
          knowledge_base: [{ id: input.kbId, name: input.kbName, type: "text", usage_mode: "auto" }],
        },
      },
      tts: { voice_id: input.voiceId, model_id: pickTtsModel(primary, input.ttsOverride) },
    },
  };

  // Gotcha #9: agent.additional_languages is silently dropped; extra languages live in
  // conversation_config.language_presets. Gotcha #12: a translated first message must
  // carry source_hash = SHA-256 of the primary first message.
  if (additional.length > 0) {
    const sourceHash = sha256(firstMessage);
    const presets: Record<string, unknown> = {};
    for (const lang of additional) {
      const translated = FIRST_MESSAGES[lang];
      presets[lang] = {
        overrides: { agent: { language: lang } },
        ...(translated ? { first_message_translation: { source_hash: sourceHash, text: translated } } : {}),
      };
    }
    (overlay.conversation_config as Record<string, unknown>).language_presets = presets;
  }

  return deepMerge(input.staticConfig, overlay) as unknown as AgentBaseline;
}
