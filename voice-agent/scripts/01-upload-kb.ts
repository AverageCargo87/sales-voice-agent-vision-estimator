import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT, env } from "./utils/env.js";
import { readState, patchState } from "./utils/state.js";
import { ElevenLabsClient } from "./utils/elevenlabs.js";
import { createLogger } from "../../shared/logger.js";

const log = createLogger("01 upload-kb");
const client = new ElevenLabsClient();

const KB_NAME = "Acme Steel Homes KB v1.0";
const KB_PATH = env.agent.kbPath();
const READY = ["succeeded", "processed", "ready", "done", "completed"];

if (!fs.existsSync(KB_PATH)) {
  log.error(`Knowledge base not found at ${KB_PATH}`);
  process.exit(1);
}

// LF only: a CRLF checkout (or an editor) must not change the uploaded document.
const kbText = fs.readFileSync(KB_PATH, "utf8").replace(/\r\n/g, "\n");
log.info(`Loaded ${path.relative(REPO_ROOT, KB_PATH).replace(/\\/g, "/")} (${kbText.length} chars, ${Buffer.byteLength(kbText, "utf8")} bytes)`);

const state = readState();
let documentId = state.kb_document_id;

// ── Idempotency: reuse an indexed document, replace a failed one ─────────────
if (documentId) {
  log.step(`kb_document_id already in state (${documentId}): checking its status`);
  try {
    const doc = await client.getKnowledgeBaseDocument(documentId);
    const raw = doc.rag_status ?? doc.status;
    const status = (raw ?? "ready (text document, no status field)").toLowerCase();
    log.info(`Current status: ${status}`);
    if (raw === undefined || READY.includes(status)) {
      log.ok("Already indexed: skipping upload");
      patchState({ kb_status: "succeeded", kb_indexed_at: state.kb_indexed_at ?? new Date().toISOString() });
      process.exit(0);
    }
    if (["failed", "error"].includes(status)) {
      log.warn(`Previous document is "${status}": deleting it and uploading again`);
      await client.deleteKnowledgeBaseDocument(documentId).catch((e: Error) => log.warn(`Delete failed, continuing: ${e.message.split("\n")[0]}`));
      documentId = undefined;
    }
  } catch {
    log.warn("Previous document not found (deleted?): uploading again");
    documentId = undefined;
  }
}

// ── Create ──────────────────────────────────────────────────────────────────
if (!documentId) {
  log.step("Creating the knowledge base document...");
  const created = await client.createKnowledgeBaseFromText({ name: KB_NAME, text: kbText });
  documentId = created.id;
  log.ok(`Created document ${documentId}`);
  patchState({ kb_document_id: documentId, kb_status: "processing" });
}

// ── Poll until indexed (gotchas #3 and #7) ──────────────────────────────────
log.step("Waiting for indexing (poll every 4 s, timeout 180 s)...");
const finalDoc = await client.pollKnowledgeBaseUntilReady(documentId, {
  intervalMs: 4_000,
  timeoutMs: 180_000,
  onTick: (doc, elapsed) => log.dim(`  [${Math.round(elapsed / 1000)}s] status=${(doc.rag_status ?? doc.status ?? "none (text document)").toLowerCase()}`),
});

patchState({ kb_status: "succeeded", kb_indexed_at: new Date().toISOString() });
log.ok(`Knowledge base indexed (status=${(finalDoc.rag_status ?? finalDoc.status ?? "ready").toLowerCase()}), document ${documentId}`);
