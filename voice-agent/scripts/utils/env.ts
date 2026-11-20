import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** voice-agent/ */
export const AGENT_ROOT = path.resolve(here, "..", "..");
/** Repository root (holds .env, package.json, .dry-run/) */
export const REPO_ROOT = path.resolve(AGENT_ROOT, "..");

dotenv.config({ path: path.join(REPO_ROOT, ".env"), quiet: true } as dotenv.DotenvConfigOptions);

/**
 * Dry-run: every ElevenLabs call is answered by a local fake API (utils/dryrun.ts),
 * payloads are printed and saved under .dry-run/requests/, state goes to .dry-run/state.json.
 * Enabled by `--dry-run` or DRY_RUN=1 (the setup runner passes it on to each step).
 */
export const DRY_RUN = process.env.DRY_RUN === "1" || process.argv.includes("--dry-run");

function read(key: string, fallback?: string): string {
  const v = process.env[key];
  if (v === undefined || v.trim() === "") return fallback ?? "";
  return v.trim();
}

function required(key: string, dryRunValue: string): string {
  const v = read(key);
  if (v) return v;
  if (DRY_RUN) return dryRunValue;
  throw new Error(`Missing required env var: ${key}`);
}

/** The private production KB wins; the public, sanitised example is the fallback. */
function resolveKbPath(): string {
  const explicit = read("KB_PATH");
  if (explicit) return path.resolve(REPO_ROOT, explicit);
  const privateKb = path.join(AGENT_ROOT, "knowledge_base.md");
  return fs.existsSync(privateKb) ? privateKb : path.join(AGENT_ROOT, "knowledge_base.example.md");
}

export const env = {
  elevenlabs: {
    apiKey: () => required("ELEVENLABS_API_KEY", "dry-run-key"),
    voiceId: () => read("ELEVENLABS_VOICE_ID", DRY_RUN ? "dry-run-voice" : ""),
  },
  agent: {
    name: () => read("AGENT_NAME", "Eric - Acme Steel Homes"),
    llmModel: () => read("LLM_MODEL", "claude-haiku-4-5"),
    /** Optional TTS override; empty = picked from the primary language (gotcha #13). */
    ttsModel: () => read("TTS_MODEL"),
    languages: (): string[] =>
      read("AGENT_LANGUAGES", "en,ru,el")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    kbPath: resolveKbPath,
  },
  n8n: {
    webhookBase: () => read("N8N_WEBHOOK_BASE").replace(/\/$/, ""),
  },
  owner: {
    name: () => read("OWNER_NAME", "the owner"),
    phone: () => read("OWNER_PHONE"),
    telegramChatId: () => read("OWNER_TELEGRAM_CHAT_ID"),
  },
  sip: {
    phoneNumber: () => read("SIP_PHONE_NUMBER", DRY_RUN ? "+10000000000" : ""),
    inboundUri: () => read("SIP_INBOUND_URI", DRY_RUN ? "sip:inbound@sip.example.com" : ""),
    outboundUri: () => read("SIP_OUTBOUND_URI", DRY_RUN ? "sip:outbound@sip.example.com" : ""),
    username: () => read("SIP_USERNAME"),
    password: () => read("SIP_PASSWORD"),
  },
};
