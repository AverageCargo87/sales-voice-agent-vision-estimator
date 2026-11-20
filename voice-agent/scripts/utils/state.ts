import fs from "node:fs";
import path from "node:path";
import { DRY_RUN, REPO_ROOT } from "./env.js";

/**
 * state.json is the hand-off between the provisioning steps: each step reads it,
 * checks "already created?", and patches in what it created. It holds service-side
 * IDs, so it is gitignored. Dry runs keep their own copy under .dry-run/.
 */
const STATE_PATH = DRY_RUN ? path.join(REPO_ROOT, ".dry-run", "state.json") : path.join(REPO_ROOT, "state.json");

export const TOOL_NAMES = [
  "create_lead",
  "book_consultation",
  "send_materials",
  "transfer_to_human",
  "notify_owner_telegram",
  "end_call_summary",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export type State = {
  kb_document_id?: string;
  kb_status?: "processing" | "succeeded" | "failed" | "unknown";
  kb_indexed_at?: string;
  tool_ids?: Partial<Record<ToolName, string>>;
  /** SHA-256 of the definition last sent per tool: lets create-tools skip unchanged tools. */
  tool_hashes?: Partial<Record<ToolName, string>>;
  agent_id?: string;
  phone_number_id?: string | null;
  /** Last full baseline sent to the agent: the safe starting point for the next PATCH (gotcha #1). */
  agent_baseline?: Record<string, unknown>;
};

export function readState(): State {
  if (!fs.existsSync(STATE_PATH)) return {};
  try {
    const raw = fs.readFileSync(STATE_PATH, "utf8");
    return raw.trim() ? (JSON.parse(raw) as State) : {};
  } catch (e) {
    throw new Error(`Failed to read ${STATE_PATH}: ${(e as Error).message}`);
  }
}

/** Atomic write: temp file + rename, so a crash never leaves half a JSON behind. */
export function writeState(next: State): void {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  const tmp = STATE_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), "utf8");
  fs.renameSync(tmp, STATE_PATH);
}

export function patchState(patch: Partial<State>): State {
  const current = readState();
  const next: State = { ...current, ...patch };
  if (patch.tool_ids) next.tool_ids = { ...current.tool_ids, ...patch.tool_ids };
  if (patch.tool_hashes) next.tool_hashes = { ...current.tool_hashes, ...patch.tool_hashes };
  writeState(next);
  return next;
}

export function clearState(): void {
  if (fs.existsSync(STATE_PATH)) fs.unlinkSync(STATE_PATH);
}

export const STATE_FILE = STATE_PATH;
