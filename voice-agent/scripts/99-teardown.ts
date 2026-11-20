import { readState, clearState } from "./utils/state.js";
import { ElevenLabsClient, ElevenLabsApiError } from "./utils/elevenlabs.js";
import { createLogger } from "../../shared/logger.js";

const log = createLogger("99 teardown");
const client = new ElevenLabsClient();
const state = readState();

if (!state.agent_id && !state.phone_number_id && !state.kb_document_id && Object.keys(state.tool_ids ?? {}).length === 0) {
  log.info("State is empty: nothing to delete");
  clearState();
  process.exit(0);
}

let errors = 0;
async function safeDelete(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    log.ok(`deleted ${label}`);
  } catch (e) {
    if (e instanceof ElevenLabsApiError && e.status === 404) log.dim(`  ${label} already gone (404)`);
    else {
      log.error(`failed to delete ${label}: ${(e as Error).message.split("\n")[0]}`);
      errors++;
    }
  }
}

// Reverse order of creation: phone -> agent -> tools -> knowledge base.
if (state.phone_number_id) await safeDelete(`phone ${state.phone_number_id}`, () => client.deletePhoneNumber(state.phone_number_id as string));
if (state.agent_id) await safeDelete(`agent ${state.agent_id}`, () => client.deleteAgent(state.agent_id as string));
for (const [name, id] of Object.entries(state.tool_ids ?? {})) {
  if (id) await safeDelete(`tool ${name}`, () => client.deleteTool(id));
}
if (state.kb_document_id) await safeDelete(`kb ${state.kb_document_id}`, () => client.deleteKnowledgeBaseDocument(state.kb_document_id as string));

if (errors > 0) {
  log.warn(`Teardown finished with ${errors} error(s): state kept so you can retry; check the dashboard`);
  process.exit(1);
}
clearState();
log.ok("Everything deleted and state cleared. npm run setup recreates it.");
