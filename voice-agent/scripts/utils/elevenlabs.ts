import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DRY_RUN, env } from "./env.js";
import { fakeElevenLabs } from "./dryrun.js";

const API_BASE = "https://api.elevenlabs.io";

/**
 * HTTP through the system curl binary instead of Node fetch.
 *
 * Gotcha #11: the WAF in front of api.elevenlabs.io consistently rejected large PATCH
 * bodies (~30 kB and up, i.e. any agent update carrying the full prompt) sent from Node
 * fetch/undici with a 403 or a redirect, while curl with identical headers and body went
 * through. The working hypothesis is the TLS fingerprint. Switching the transport fixed it.
 *
 * Headers (they carry the API key) and the body go through temp files, never argv:
 * a process command line is visible to every other local process.
 */
function curlRequest(opts: {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const tmpDir = mkdtempSync(join(tmpdir(), "acme-curl-"));
    const cleanup = () => rmSync(tmpDir, { recursive: true, force: true });
    const headerFile = join(tmpDir, "headers.txt");
    writeFileSync(headerFile, Object.entries(opts.headers).map(([k, v]) => `${k}: ${v}`).join("\n"), "utf8");

    const args = ["-sS", "-X", opts.method, "-w", "\n__HTTP_CODE__%{http_code}", "--max-time", "60", "-H", `@${headerFile}`, opts.url];
    if (opts.body !== undefined) {
      const bodyFile = join(tmpDir, "body.json");
      writeFileSync(bodyFile, opts.body, "utf8");
      args.push("--data-binary", `@${bodyFile}`);
    }

    const proc = spawn("curl", args, { windowsHide: true });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    proc.stdout.on("data", (c: Buffer) => stdout.push(c));
    proc.stderr.on("data", (c: Buffer) => stderr.push(c));
    proc.on("error", (err) => {
      cleanup();
      reject(err);
    });
    proc.on("close", (code) => {
      cleanup();
      if (code !== 0 && stdout.length === 0) {
        reject(new Error(`curl exited ${code}: ${Buffer.concat(stderr).toString("utf8").slice(0, 300)}`));
        return;
      }
      const raw = Buffer.concat(stdout).toString("utf8");
      const m = raw.match(/\n__HTTP_CODE__(\d+)$/);
      if (!m) {
        reject(new Error(`curl: no HTTP code in response: ${raw.slice(-200)}`));
        return;
      }
      resolve({ status: parseInt(m[1]!, 10), text: raw.slice(0, m.index) });
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Types: partial, only what the scripts use
// ─────────────────────────────────────────────────────────────────────────────

export type KnowledgeBaseDocument = {
  id: string;
  name?: string;
  type?: string;
  /** Different API versions report status in different fields; text documents report none (gotcha #7). */
  status?: string;
  rag_status?: string;
};

export type AgentRef = { agent_id: string; name: string };

export type Voice = { voice_id: string; name: string; labels?: Record<string, string> };

/** JSON Schema fragment as ElevenLabs validates it for webhook tools (gotcha #8). */
export type ToolSchema = {
  type: string;
  description?: string;
  dynamic_variable?: string;
  is_system_provided?: boolean;
  constant_value?: unknown;
  enum?: unknown[];
  required?: string[];
  properties?: Record<string, ToolSchema>;
  items?: ToolSchema;
};

export type ConvaiToolDefinition = {
  /** Stable workspace tool name. */
  name: string;
  description: string;
  type: "webhook" | "client" | "system";
  api_schema?: {
    url: string;
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    request_headers?: Record<string, string>;
    request_body_schema?: ToolSchema;
    query_params_schema?: Record<string, unknown>;
    path_params_schema?: Record<string, unknown>;
  };
  response_timeout_secs?: number;
};

export type ConvaiTool = { id?: string; tool_id?: string; tool_config?: ConvaiToolDefinition };

export type AgentBaseline = {
  name: string;
  conversation_config: Record<string, unknown>;
  platform_settings?: Record<string, unknown>;
  tags?: string[];
};

export type PhoneNumberCreateBody = {
  phone_number: string;
  label?: string;
  provider: "twilio" | "sip_trunk";
  inbound_trunk: { address: string; username?: string; password?: string };
  outbound_trunk: { address: string; username?: string; password?: string };
};

export class ElevenLabsApiError extends Error {
  constructor(
    public readonly method: string,
    public readonly path: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`ElevenLabs ${method} ${path} -> ${status}\n${body.slice(0, 2000)}`);
    this.name = "ElevenLabsApiError";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Client
// ─────────────────────────────────────────────────────────────────────────────

type RequestOpts = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  /** DELETE answers 204 with no body. */
  expectEmpty?: boolean;
};

export class ElevenLabsClient {
  private readonly apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? env.elevenlabs.apiKey();
  }

  async request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
    const method = opts.method ?? "GET";
    let pathWithQuery = path;
    if (opts.query) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(opts.query)) if (v !== undefined && v !== "") qs.set(k, String(v));
      const s = qs.toString();
      if (s) pathWithQuery += `?${s}`;
    }

    const bodyStr = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const headers: Record<string, string> = {
      "xi-api-key": this.apiKey,
      accept: "application/json",
      // A browser UA: the WAF in front of the API is picky about clients.
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      ...(bodyStr ? { "content-type": "application/json" } : {}),
    };

    const res = DRY_RUN
      ? fakeElevenLabs(method, pathWithQuery, bodyStr)
      : await curlRequest({ method, url: API_BASE + pathWithQuery, headers, ...(bodyStr ? { body: bodyStr } : {}) });

    if (res.status < 200 || res.status >= 300) throw new ElevenLabsApiError(method, path, res.status, res.text);
    if (opts.expectEmpty || !res.text) return undefined as T;
    return JSON.parse(res.text) as T;
  }

  // ── Knowledge base ─────────────────────────────────────────────────────────

  createKnowledgeBaseFromText(args: { name: string; text: string }): Promise<KnowledgeBaseDocument> {
    return this.request("/v1/convai/knowledge-base/text", { method: "POST", body: args });
  }

  getKnowledgeBaseDocument(id: string): Promise<KnowledgeBaseDocument> {
    return this.request(`/v1/convai/knowledge-base/${id}`);
  }

  async deleteKnowledgeBaseDocument(id: string): Promise<void> {
    await this.request(`/v1/convai/knowledge-base/${id}`, { method: "DELETE", expectEmpty: true });
  }

  /**
   * Polls until the document is indexed (gotcha #3). File and URL documents index
   * asynchronously (typically 30 to 120 s); text documents are ready at once and carry
   * no status field at all (gotcha #7), which is treated as "ready".
   */
  async pollKnowledgeBaseUntilReady(
    id: string,
    opts: { intervalMs?: number; timeoutMs?: number; onTick?: (doc: KnowledgeBaseDocument, elapsedMs: number) => void } = {},
  ): Promise<KnowledgeBaseDocument> {
    const interval = opts.intervalMs ?? 4_000;
    const timeout = opts.timeoutMs ?? 180_000;
    const started = Date.now();
    for (;;) {
      const doc = await this.getKnowledgeBaseDocument(id);
      const rawStatus = doc.rag_status ?? doc.status;
      const status = (rawStatus ?? "").toLowerCase();
      const elapsed = Date.now() - started;
      opts.onTick?.(doc, elapsed);

      if (["succeeded", "processed", "ready", "done", "completed"].includes(status)) return doc;
      if (["failed", "error"].includes(status)) throw new Error(`KB document ${id} failed indexing (status=${status})`);
      if (rawStatus === undefined || rawStatus === null) return doc;
      if (elapsed > timeout) throw new Error(`KB document ${id} not indexed within ${timeout} ms (last status=${status})`);
      await sleep(interval);
    }
  }

  // ── Workspace tools (inline tools on the agent are deprecated, gotcha #2) ───

  createTool(definition: ConvaiToolDefinition): Promise<ConvaiTool> {
    return this.request("/v1/convai/tools", { method: "POST", body: { tool_config: definition } });
  }

  getTool(id: string): Promise<ConvaiTool> {
    return this.request(`/v1/convai/tools/${id}`);
  }

  updateTool(id: string, definition: ConvaiToolDefinition): Promise<ConvaiTool> {
    return this.request(`/v1/convai/tools/${id}`, { method: "PATCH", body: { tool_config: definition } });
  }

  async deleteTool(id: string): Promise<void> {
    await this.request(`/v1/convai/tools/${id}`, { method: "DELETE", expectEmpty: true });
  }

  // ── Agents ─────────────────────────────────────────────────────────────────

  listAgents(opts: { pageSize?: number } = {}): Promise<{ agents: AgentRef[] }> {
    return this.request("/v1/convai/agents", { query: { page_size: opts.pageSize ?? 30 } });
  }

  createAgent(baseline: AgentBaseline): Promise<{ agent_id: string }> {
    return this.request("/v1/convai/agents/create", { method: "POST", body: baseline });
  }

  getAgent(id: string): Promise<Record<string, unknown>> {
    return this.request(`/v1/convai/agents/${id}`);
  }

  /**
   * SAFE PATCH (gotcha #1). PATCH on an agent REPLACES top-level objects
   * (conversation_config, platform_settings) instead of merging them: a delta like
   * { name } would wipe the prompt, tools, voice, languages and KB. So this method
   * always sends a FULL baseline: the explicit one if given, otherwise the current
   * agent read back from the server, with the delta deep-merged in.
   */
  async updateAgent(id: string, delta: Partial<AgentBaseline>, options: { baseline?: AgentBaseline } = {}): Promise<Record<string, unknown>> {
    const current = options.baseline ?? ((await this.getAgent(id)) as unknown as AgentBaseline);
    const merged = deepMerge(current as Record<string, unknown>, delta as Record<string, unknown>);
    return this.request(`/v1/convai/agents/${id}`, { method: "PATCH", body: merged });
  }

  async deleteAgent(id: string): Promise<void> {
    await this.request(`/v1/convai/agents/${id}`, { method: "DELETE", expectEmpty: true });
  }

  // ── Voices ─────────────────────────────────────────────────────────────────

  getVoice(id: string): Promise<Voice> {
    return this.request(`/v1/voices/${id}`);
  }

  // ── Phone numbers (SIP trunk, gotcha #5) ───────────────────────────────────

  createPhoneNumber(body: PhoneNumberCreateBody): Promise<{ phone_number_id: string }> {
    return this.request("/v1/convai/phone-numbers/create", { method: "POST", body });
  }

  async assignPhoneNumberToAgent(phoneNumberId: string, agentId: string): Promise<void> {
    await this.request(`/v1/convai/phone-numbers/${phoneNumberId}`, { method: "PATCH", body: { agent_id: agentId } });
  }

  async deletePhoneNumber(id: string): Promise<void> {
    await this.request(`/v1/convai/phone-numbers/${id}`, { method: "DELETE", expectEmpty: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────────────

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Deep merge of plain objects. Arrays from `delta` replace arrays in `base`. */
export function deepMerge<A extends Record<string, unknown>, B extends Record<string, unknown>>(base: A, delta: B): A & B {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(delta)) {
    if (v === undefined) continue;
    const prev = out[k];
    const bothObjects =
      v !== null && typeof v === "object" && !Array.isArray(v) && prev !== null && typeof prev === "object" && !Array.isArray(prev);
    out[k] = bothObjects ? deepMerge(prev as Record<string, unknown>, v as Record<string, unknown>) : v;
  }
  return out as A & B;
}
