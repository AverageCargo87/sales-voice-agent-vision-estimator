/**
 * A small estimate server (node:http, no framework).
 *
 * GET  /                  -> index.html
 * GET  /healthz           -> liveness
 * GET  /api/model         -> the price model as one JSON (limits, labels, curves)
 * POST /api/estimate      -> pure parametric estimate, no AI (instant, free):
 *                            { area_m2, floors?, package?, carport?, septic? }; no package = all three
 * POST /api/analyze       -> drawing (base64) -> the agentic loop. Guarded: strict base64,
 *                            size limits, magic bytes, per-IP hourly limit, concurrency cap,
 *                            overall timeout. Every live call costs money.
 * GET  /api/demo          -> the full loop on the bundled fictional drawing, replayed offline
 * GET  /demo-house.pdf    -> that drawing, to try the upload path
 *
 * Demo mode (no ANTHROPIC_API_KEY, or DEMO_MODE=1): /api/analyze runs every guard exactly
 * as in live mode, then replays the fixture extraction instead of calling the model. The
 * response says mode:"demo" and the UI shows it. Prices are always computed live by pricing.ts.
 */

import "dotenv/config";
import http from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { analyzeDrawing, type AnalyzeResult } from "./agent.js";
import { extractPdfText, PAGE_MARKER_RX } from "./pdftext.js";
import { estimate, modelConfig, PACKAGE_IDS, type EstimateParams, type PackageId } from "./pricing.js";
import { ALLOWED_MEDIA, decodeBase64Strict, matchesMagic, SlidingWindowLimiter } from "./guards.js";
import { loadDemoFixture, replayTransport } from "./replay.js";
import { createLogger } from "../shared/logger.js";

const log = createLogger("estimate");
const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX_HTML = join(HERE, "index.html");
const DEMO_PDF = join(HERE, "fixtures", "demo-house.pdf");

const PORT = Number(process.env.PORT) || 8099;
/** Local by default; HOST=0.0.0.0 behind a proxy. */
const HOST = process.env.HOST || "127.0.0.1";
const DEMO = process.env.DEMO_MODE === "1" || !process.env.ANTHROPIC_API_KEY;
/** Per-turn delay of the replayed model, so the demo shows its progress steps. */
const DEMO_LATENCY_MS = Number(process.env.DEMO_LATENCY_MS ?? 700);

/** PDF limit after base64 decoding. */
const MAX_FILE_BYTES = 25 * 1024 * 1024;
/** Image limit: the vision API takes ~5 MB per image block; a bigger file would fail AFTER being paid for. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** JSON body limit: base64 inflates ~33%, so an honest 25 MB file must still fit. */
const MAX_BODY_BYTES = 36 * 1024 * 1024;
/** Above this a PDF goes the text route: the native reader does not take heavy vector PDFs. */
const PDF_VISION_MAX = 8 * 1024 * 1024;

const ANALYZE_RATE_LIMIT = Number(process.env.ANALYZE_RATE_LIMIT) || 6;
const ANALYZE_CONCURRENCY = Number(process.env.ANALYZE_CONCURRENCY) || 2;
const ANALYZE_TIMEOUT_MS = Number(process.env.ANALYZE_TIMEOUT_MS) || 6 * 60 * 1000;
const TRUST_PROXY = process.env.TRUST_PROXY === "1";
const CORS_ORIGINS = (process.env.CORS_ORIGIN ?? "").split(",").map((s) => s.trim()).filter(Boolean);

const limiter = new SlidingWindowLimiter(ANALYZE_RATE_LIMIT);
let analyzeInFlight = 0;
const demoFixture = loadDemoFixture();

// ─────────────────────────────────────────────────────────────────────────────
// HTTP helpers
// ─────────────────────────────────────────────────────────────────────────────

function clientIp(req: http.IncomingMessage): string {
  if (TRUST_PROXY) {
    const xff = req.headers["x-forwarded-for"];
    const first = (Array.isArray(xff) ? xff[0] : xff)?.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? "unknown";
}

function applyCors(req: http.IncomingMessage, res: http.ServerResponse): void {
  const origin = req.headers.origin;
  if (origin && CORS_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "content-type");
    res.setHeader("Access-Control-Max-Age", "86400");
  }
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  if (res.writableEnded || res.destroyed) return;
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(JSON.stringify(payload));
}

async function serveFile(res: http.ServerResponse, path: string, type: string): Promise<void> {
  try {
    const body = await readFile(path);
    res.writeHead(200, { "content-type": type, "x-content-type-options": "nosniff" });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
  }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let aborted = false;
    req.on("data", (chunk: Buffer) => {
      if (aborted) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        aborted = true;
        // NOT req.destroy(): destroying synchronously killed the socket before the client
        // could read the friendly 413 (the browser saw ECONNRESET). The rest of the upload
        // is drained and the connection is closed after the response is sent.
        reject(new Error("PAYLOAD_TOO_LARGE"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!aborted) resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", (err) => {
      if (!aborted) reject(err);
    });
  });
}

async function readJsonBody<T>(req: http.IncomingMessage, res: http.ServerResponse): Promise<T | null> {
  let raw: string;
  try {
    raw = await readBody(req);
  } catch (err) {
    if (err instanceof Error && err.message === "PAYLOAD_TOO_LARGE") {
      sendJson(res, 413, { error: "File too large (limit ~25 MB). Compress the drawing or upload the plan sheet only." });
      res.once("finish", () => req.destroy());
      return null;
    }
    sendJson(res, 400, { error: "Could not read the request." });
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    sendJson(res, 400, { error: "Malformed JSON." });
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/estimate: parametric, no AI
// ─────────────────────────────────────────────────────────────────────────────

type EstimateBody = { area_m2?: unknown; floors?: unknown; package?: unknown; carport?: unknown; septic?: unknown };

async function handleEstimate(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = await readJsonBody<EstimateBody>(req, res);
  if (!body) return;
  const area = Number(body.area_m2);
  if (!Number.isFinite(area)) {
    sendJson(res, 400, { error: "area_m2 must be a number (m2)." });
    return;
  }
  const pkgRaw = body.package;
  if (pkgRaw !== undefined && !PACKAGE_IDS.includes(pkgRaw as PackageId)) {
    sendJson(res, 400, { error: 'package must be "base" | "shell" | "turnkey" (or omitted for all three).' });
    return;
  }
  const wanted: readonly PackageId[] = pkgRaw === undefined ? PACKAGE_IDS : [pkgRaw as PackageId];
  const params = (pkg: PackageId): EstimateParams => ({
    area_m2: area,
    floors: Number(body.floors) || 1,
    package: pkg,
    carport: Boolean(body.carport),
    septic: Boolean(body.septic),
  });
  try {
    // The model validates the 25-1,200 m2 range itself, with readable messages.
    sendJson(res, 200, { estimates: wanted.map((p) => estimate(params(p))) });
  } catch (err) {
    sendJson(res, 400, { error: err instanceof Error ? err.message : "Invalid estimate parameters." });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/analyze: the agentic loop (live: costs money)
// ─────────────────────────────────────────────────────────────────────────────

type AnalyzeBody = { fileBase64?: string; mediaType?: string; filename?: string };

/** A scanned raster inside a PDF has no text layer: the paid call would surely fail. Reject for free. */
function assertPdfHasText(text: string): string {
  if (text.replace(PAGE_MARKER_RX, "").replace(/\s+/g, "").length < 80) throw new Error("PDF_NO_TEXT");
  return text;
}

type MediaType = NonNullable<Parameters<typeof analyzeDrawing>[0]["mediaType"]>;

async function runLive(buf: Buffer, mediaType: string, filename: string, signal: AbortSignal): Promise<AnalyzeResult> {
  if (mediaType === "application/pdf") {
    if (buf.length > PDF_VISION_MAX) {
      log.step(`Heavy PDF (~${Math.round(buf.length / 1024 / 1024)} MB) -> text extraction (unpdf)`);
      const { text, pages } = await extractPdfText(new Uint8Array(buf));
      return analyzeDrawing({ filename, extractedText: assertPdfHasText(text), pages, signal });
    }
    try {
      return await analyzeDrawing({ dataBase64: buf.toString("base64"), mediaType: "application/pdf", filename, signal });
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      if (!/process pdf|invalid_request|could not process/i.test(m)) throw err;
      log.step("Native PDF reader refused the file -> text fallback (unpdf)");
      const { text, pages } = await extractPdfText(new Uint8Array(buf));
      return analyzeDrawing({ filename, extractedText: assertPdfHasText(text), pages, signal });
    }
  }
  return analyzeDrawing({ dataBase64: buf.toString("base64"), mediaType: mediaType as MediaType, filename, signal });
}

function runDemo(signal?: AbortSignal): Promise<AnalyzeResult> {
  const transport = replayTransport(demoFixture, { latencyMs: DEMO_LATENCY_MS });
  return existsSync(DEMO_PDF)
    ? analyzeDrawing({ filename: demoFixture.filename, dataBase64: readFileSync(DEMO_PDF).toString("base64"), mediaType: "application/pdf", transport, ...(signal ? { signal } : {}) })
    : analyzeDrawing({ filename: demoFixture.filename, extractedText: "demo", transport, ...(signal ? { signal } : {}) });
}

function demoPayload(result: AnalyzeResult) {
  return {
    mode: "demo",
    demo_note: `Demo mode: no model call. The extraction is replayed from a fixture: ${demoFixture.label}. Every price is computed live by pricing.ts.`,
    filename: demoFixture.filename,
    extraction: result.extraction,
    estimates: result.estimates,
    narrative: result.narrative,
    checks: checksOf(result),
  };
}

/** Guard outcomes for the page trace (no usage, no internals). */
function checksOf(result: AnalyzeResult) {
  return { injection_lines_removed: result.guards.injectionLinesRemoved, narrative_replaced: result.guards.narrativeReplaced };
}

function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout(); // kill the loop and curl BEFORE rejecting, so no tokens are spent on an answer nobody sees
      reject(new Error("ANALYZE_TIMEOUT"));
    }, ms);
    promise.then(
      (v) => (clearTimeout(timer), resolve(v)),
      (e) => (clearTimeout(timer), reject(e)),
    );
  });
}

async function handleAnalyze(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const ip = clientIp(req);
  // Fast rejections that do NOT consume the hourly slot.
  if (!limiter.check(ip)) {
    log.step(`Rate limit: ${ip} is over ${ANALYZE_RATE_LIMIT}/hour`);
    sendJson(res, 429, { error: `That's ${ANALYZE_RATE_LIMIT} analyses this hour. Try again later, or book a consultation: we will price it by hand, more precisely.` });
    return;
  }
  if (analyzeInFlight >= ANALYZE_CONCURRENCY) {
    sendJson(res, 429, { error: "The service is busy with other estimates. Try again in a minute." });
    return;
  }

  const body = await readJsonBody<AnalyzeBody>(req, res);
  if (!body) return;
  const { fileBase64, mediaType, filename } = body;
  if (!fileBase64 || !mediaType) {
    sendJson(res, 400, { error: "fileBase64 and mediaType are required." });
    return;
  }
  if (!ALLOWED_MEDIA.has(mediaType)) {
    sendJson(res, 400, { error: `Unsupported file type: ${mediaType}. PDF, PNG, JPG, WebP and GIF are supported.` });
    return;
  }
  // Validate the file BEFORE the paid call: base64 alphabet, size, magic bytes.
  const buf = decodeBase64Strict(fileBase64);
  if (!buf) {
    sendJson(res, 400, { error: "The file is corrupted (invalid base64). Please upload it again." });
    return;
  }
  if (buf.length > MAX_FILE_BYTES) {
    sendJson(res, 413, { error: "File too large (limit 25 MB). Compress the drawing or upload the plan sheet only." });
    return;
  }
  if (mediaType !== "application/pdf" && buf.length > MAX_IMAGE_BYTES) {
    sendJson(res, 413, { error: "Images are limited to 5 MB. Reduce the resolution or save the sheet as PDF." });
    return;
  }
  if (!matchesMagic(buf, mediaType)) {
    sendJson(res, 400, { error: "The file content does not match its type. Upload a real PDF or image (PNG/JPG/WebP/GIF)." });
    return;
  }
  // Concurrency may have filled up while the body was read: re-check, and only now consume the slot.
  if (analyzeInFlight >= ANALYZE_CONCURRENCY) {
    sendJson(res, 429, { error: "The service is busy with other estimates. Try again in a minute." });
    return;
  }
  limiter.record(ip);
  log.step(`Analysis${DEMO ? " (demo replay)" : ""}: ${filename ?? "(no name)"} [${mediaType}, ~${Math.round(buf.length / 1024)} KB, ip ${ip}]`);

  // A closed tab aborts the loop and kills the running curl: nobody pays for an unseen answer.
  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) abort.abort();
  });

  analyzeInFlight++;
  const t0 = Date.now();
  try {
    const work = DEMO ? runDemo(abort.signal) : runLive(buf, mediaType, filename ?? "drawing", abort.signal);
    const result = await withTimeout(work, ANALYZE_TIMEOUT_MS, () => abort.abort());
    const u = result.usage;
    log.ok(
      `Done in ${((Date.now() - t0) / 1000).toFixed(1)} s, ${result.raw_iterations} iterations, ${result.estimates.length} estimates. ` +
        (DEMO ? "No tokens (demo). " : `Tokens in ${u.input_tokens} / out ${u.output_tokens} / cache read ${u.cache_read_input_tokens} / write ${u.cache_creation_input_tokens} ~ $${u.approx_cost_usd.toFixed(3)}. `) +
        `Injection lines removed: ${result.guards.injectionLinesRemoved}. Narrative replaced: ${result.guards.narrativeReplaced ? "yes " + JSON.stringify(result.guards.unknownPrices) : "no"}.`,
    );
    // The key and the usage never go to the client.
    if (DEMO) sendJson(res, 200, demoPayload(result));
    else sendJson(res, 200, { mode: "live", extraction: result.extraction, estimates: result.estimates, narrative: result.narrative, checks: checksOf(result) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "CLIENT_ABORTED") {
      log.step("Client disconnected: loop stopped");
      return;
    }
    if (msg === "ANALYZE_TIMEOUT") {
      log.error(`Analysis exceeded ${Math.round(ANALYZE_TIMEOUT_MS / 1000)} s`);
      sendJson(res, 504, { error: "The analysis took too long. Try the plan sheet instead of the whole set, or book a consultation." });
      return;
    }
    if (msg === "PDF_NO_TEXT") {
      sendJson(res, 422, { error: "This PDF has no text layer (a scan?). Upload the plan sheet as PNG/JPG: the analysis works better that way." });
      return;
    }
    // The status comes from the "Anthropic NNN:" PREFIX (agent.ts contract), not a substring search.
    const status = /^Anthropic (\d{3}):/.exec(msg)?.[1];
    if (msg.includes("ANTHROPIC_API_KEY") || status === "401" || status === "403") {
      log.error("API key problem", msg);
      sendJson(res, 503, { error: "The analysis service is not configured right now. Book a consultation: we will price it by hand." });
      return;
    }
    if (status === "429" || status === "529") {
      log.error("Model API overloaded or rate-limited", msg);
      sendJson(res, 503, { error: "The analysis service is overloaded. Try again in a couple of minutes." });
      return;
    }
    log.error("Analysis failed", msg);
    sendJson(res, 500, { error: "Could not analyse the drawing. Try again, or book a consultation." });
  } finally {
    analyzeInFlight--;
  }
}

async function handleDemo(res: http.ServerResponse): Promise<void> {
  try {
    sendJson(res, 200, demoPayload(await runDemo()));
  } catch (err) {
    log.error("Demo failed", err);
    sendJson(res, 500, { error: "Demo failed." });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  const url = (req.url ?? "/").split("?")[0];
  applyCors(req, res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method === "GET" && (url === "/" || url === "/index.html")) return void serveFile(res, INDEX_HTML, "text/html; charset=utf-8");
  if (req.method === "GET" && url === "/demo-house.pdf") return void serveFile(res, DEMO_PDF, "application/pdf");
  if (req.method === "GET" && url === "/healthz") return sendJson(res, 200, { ok: true, mode: DEMO ? "demo" : "live", uptime_s: Math.round(process.uptime()) });
  if (req.method === "GET" && url === "/api/model") return sendJson(res, 200, modelConfig());
  if (req.method === "GET" && url === "/api/demo") return void handleDemo(res);
  if (req.method === "POST" && url === "/api/estimate") return void handleEstimate(req, res);
  if (req.method === "POST" && url === "/api/analyze") return void handleAnalyze(req, res);
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

server.on("error", (err: NodeJS.ErrnoException) => {
  log.error(err.code === "EADDRINUSE" ? `Port ${PORT} is taken: stop the old server or set PORT` : "Server failed to start", err.code === "EADDRINUSE" ? "" : err);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  log.ok(`Estimate server: http://${HOST}:${PORT}  (${DEMO ? "DEMO mode: no model calls, extraction replayed from a fixture" : "LIVE mode: " + "Claude vision"})`);
  log.info("GET /healthz | GET /api/model | POST /api/estimate (no AI) | POST /api/analyze | GET /api/demo");
  log.info(`analyze guards: ${ANALYZE_RATE_LIMIT}/hour per IP, ${ANALYZE_CONCURRENCY} concurrent, ${Math.round(ANALYZE_TIMEOUT_MS / 60000)} min timeout, magic-bytes check, 25 MB / 5 MB limits`);
});

// Graceful shutdown: stop accepting, let running responses finish, force-exit after 5 s.
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    log.step(`${sig}: stopping`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
