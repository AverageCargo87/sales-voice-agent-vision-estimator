/**
 * A local stand-in for the slice of the ElevenLabs API the provisioning scripts use.
 *
 * `npm run setup:dry` routes every request here instead of api.elevenlabs.io:
 *   - each mutating request is printed and its full payload saved to .dry-run/requests/,
 *     so the exact JSON that would hit the API can be reviewed before spending a credit;
 *   - created objects persist in .dry-run/fake-api.json, so a second dry run exercises the
 *     idempotency paths ("already indexed", "tool unchanged", "agent updated");
 *   - PATCH on an agent replaces top-level objects wholesale, like the real API (gotcha #1).
 */

import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./env.js";

const DIR = path.join(REPO_ROOT, ".dry-run");
const DB_PATH = path.join(DIR, "fake-api.json");
const REQ_DIR = path.join(DIR, "requests");

type Obj = Record<string, unknown>;
type Db = { seq: number; kb: Record<string, Obj>; tools: Record<string, Obj>; agents: Record<string, Obj>; phones: Record<string, Obj> };

export type FakeResponse = { status: number; text: string };

function load(): Db {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, "utf8")) as Db;
  } catch {
    return { seq: 0, kb: {}, tools: {}, agents: {}, phones: {} };
  }
}

function save(db: Db): void {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf8");
}

const ok = (payload: unknown): FakeResponse => ({ status: 200, text: JSON.stringify(payload) });
const notFound = (what: string): FakeResponse => ({ status: 404, text: JSON.stringify({ detail: `${what} not found (dry-run)` }) });
const noContent: FakeResponse = { status: 204, text: "" };

/** One line of human-readable context per payload, printed next to the saved file. */
function summarize(body: Obj | undefined): string {
  if (!body) return "";
  const tc = body.tool_config as Obj | undefined;
  if (tc) {
    const api = tc.api_schema as Obj | undefined;
    return `tool ${String(tc.name)} -> ${String(api?.url ?? "?")}`;
  }
  const cc = body.conversation_config as Obj | undefined;
  if (cc) {
    const agent = cc.agent as Obj | undefined;
    const prompt = agent?.prompt as Obj | undefined;
    const tts = cc.tts as Obj | undefined;
    const presets = Object.keys((cc.language_presets as Obj | undefined) ?? {});
    return (
      `agent "${String(body.name)}" lang=${String(agent?.language)}+${presets.join(",") || "-"} ` +
      `tts=${String(tts?.model_id)} llm=${String(prompt?.llm)} tools=${(prompt?.tool_ids as unknown[] | undefined)?.length ?? 0} ` +
      `prompt=${String(prompt?.prompt ?? "").length} chars`
    );
  }
  if (typeof body.text === "string") return `kb "${String(body.name)}" ${body.text.length} chars`;
  if (body.provider) return `phone ${String(body.phone_number)} via ${String(body.provider)}`;
  if (body.agent_id) return `assign -> ${String(body.agent_id)}`;
  return Object.keys(body).join(", ");
}

function record(method: string, urlPath: string, bodyText: string | undefined): void {
  fs.mkdirSync(REQ_DIR, { recursive: true });
  const n = fs.readdirSync(REQ_DIR).length + 1;
  const slug = urlPath.replace(/^\/v1\//, "").replace(/[^a-z0-9]+/gi, "-").replace(/-+$/, "");
  const file = path.join(REQ_DIR, `${String(n).padStart(3, "0")}-${method.toLowerCase()}-${slug}.json`);
  let body: Obj | undefined;
  try {
    body = bodyText ? (JSON.parse(bodyText) as Obj) : undefined;
  } catch {
    body = undefined;
  }
  // Credentials never reach the saved payloads, even when a real .env is loaded.
  const redact = (k: string, v: unknown) => (/password|secret|api_?key|token/i.test(k) && typeof v === "string" && v ? "<redacted>" : v);
  fs.writeFileSync(file, bodyText ? JSON.stringify(body ?? bodyText, redact, 2) : "", "utf8");
  const bytes = bodyText ? Buffer.byteLength(bodyText) : 0;
  const size = !bodyText ? "no body" : bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} kB`;
  const rel = path.relative(REPO_ROOT, file).replace(/\\/g, "/");
  console.log(`  [dry-run] ${method.padEnd(6)} ${urlPath}  (${size})  ${summarize(body)}`);
  console.log(`            saved ${rel}`);
}

export function fakeElevenLabs(method: string, urlWithQuery: string, bodyText?: string): FakeResponse {
  const urlPath = urlWithQuery.split("?")[0] ?? urlWithQuery;
  if (method !== "GET") record(method, urlPath, bodyText);

  const db = load();
  const body = bodyText ? (JSON.parse(bodyText) as Obj) : {};
  const nextId = (prefix: string) => `${prefix}_dry_${String(++db.seq).padStart(3, "0")}`;
  const seg = urlPath.split("/").filter(Boolean); // ["v1", "convai", ...]
  const id = seg[3];

  // ── Agents ────────────────────────────────────────────────────────────────
  if (urlPath === "/v1/convai/agents" && method === "GET") {
    return ok({ agents: Object.entries(db.agents).map(([agent_id, a]) => ({ agent_id, name: a.name })) });
  }
  if (urlPath === "/v1/convai/agents/create" && method === "POST") {
    const agentId = nextId("agent");
    db.agents[agentId] = body;
    save(db);
    return ok({ agent_id: agentId });
  }
  if (seg[2] === "agents" && id) {
    const agent = db.agents[id];
    if (!agent) return notFound(`agent ${id}`);
    if (method === "GET") return ok({ agent_id: id, ...agent });
    if (method === "PATCH") {
      db.agents[id] = { ...agent, ...body }; // top-level REPLACE, exactly like the real API
      save(db);
      return ok({ agent_id: id, ...db.agents[id] });
    }
    if (method === "DELETE") {
      delete db.agents[id];
      save(db);
      return noContent;
    }
  }

  // ── Knowledge base (text documents index synchronously: no status field, gotcha #7) ──
  if (urlPath === "/v1/convai/knowledge-base/text" && method === "POST") {
    const docId = nextId("kb");
    db.kb[docId] = { id: docId, name: body.name, type: "text" };
    save(db);
    return ok({ id: docId });
  }
  if (seg[2] === "knowledge-base" && id) {
    const doc = db.kb[id];
    if (!doc) return notFound(`knowledge base document ${id}`);
    if (method === "GET") return ok(doc);
    if (method === "DELETE") {
      delete db.kb[id];
      save(db);
      return noContent;
    }
  }

  // ── Workspace tools ───────────────────────────────────────────────────────
  if (urlPath === "/v1/convai/tools" && method === "POST") {
    const toolId = nextId("tool");
    db.tools[toolId] = { id: toolId, tool_config: body.tool_config };
    save(db);
    return ok({ id: toolId });
  }
  if (urlPath === "/v1/convai/tools" && method === "GET") return ok({ tools: Object.values(db.tools) });
  if (seg[2] === "tools" && id) {
    const tool = db.tools[id];
    if (!tool) return notFound(`tool ${id}`);
    if (method === "GET") return ok(tool);
    if (method === "PATCH") {
      db.tools[id] = { id, tool_config: body.tool_config };
      save(db);
      return ok(db.tools[id]);
    }
    if (method === "DELETE") {
      delete db.tools[id];
      save(db);
      return noContent;
    }
  }

  // ── Voices ────────────────────────────────────────────────────────────────
  if (seg[1] === "voices" && seg[2] && method === "GET") return ok({ voice_id: seg[2], name: "Dry-run voice" });

  // ── Phone numbers ─────────────────────────────────────────────────────────
  if (urlPath === "/v1/convai/phone-numbers/create" && method === "POST") {
    const phoneId = nextId("phone");
    db.phones[phoneId] = body;
    save(db);
    return ok({ phone_number_id: phoneId });
  }
  if (urlPath === "/v1/convai/phone-numbers" && method === "GET") {
    return ok(Object.entries(db.phones).map(([phone_number_id, p]) => ({ phone_number_id, phone_number: p.phone_number })));
  }
  if (seg[2] === "phone-numbers" && id) {
    const phone = db.phones[id];
    if (!phone) return notFound(`phone number ${id}`);
    if (method === "PATCH") {
      db.phones[id] = { ...phone, ...body };
      save(db);
      return ok(db.phones[id]);
    }
    if (method === "DELETE") {
      delete db.phones[id];
      save(db);
      return noContent;
    }
  }

  return notFound(`${method} ${urlPath}`);
}

/** Wipes the fake API and the dry-run state (used by `npm run setup:dry -- --fresh`). */
export function resetDryRun(): void {
  fs.rmSync(DIR, { recursive: true, force: true });
}
