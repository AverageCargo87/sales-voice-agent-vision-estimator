/**
 * Guards around the paid model call. Pure functions and one small class, so eval.ts can
 * test every one of them offline.
 *
 *   before the call: strict base64, size limits (server.ts), magic bytes, per-IP rate limit
 *   inside the call:  prompt-injection filter on text extracted from a client's PDF
 *   after the call:   price audit of the narrative: every euro figure the model writes
 *                     must be one the pricing code produced, or the narrative is replaced
 */

import { OPTIONS, type EstimateResult } from "./pricing.js";

// ─────────────────────────────────────────────────────────────────────────────
// Upload validation
// ─────────────────────────────────────────────────────────────────────────────

export const ALLOWED_MEDIA = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif"]);

/** Decodes base64 (optionally a data: URL) or returns null if it is not clean base64. */
export function decodeBase64Strict(input: string): Buffer | null {
  const b64 = input.replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
  if (!b64 || !/^[A-Za-z0-9+/]+=*$/.test(b64)) return null;
  return Buffer.from(b64, "base64");
}

/** The content must match the declared type, or a paid vision call goes out for a broken or disguised file. */
export function matchesMagic(buf: Buffer, mediaType: string): boolean {
  if (buf.length < 12) return false;
  switch (mediaType) {
    case "application/pdf":
      return buf.subarray(0, 5).toString("latin1") === "%PDF-";
    case "image/png":
      return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    case "image/jpeg":
      return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    case "image/webp":
      return buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP";
    case "image/gif":
      return buf.subarray(0, 4).toString("latin1") === "GIF8";
    default:
      return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Rate limit: sliding one-hour window per IP, in memory
// ─────────────────────────────────────────────────────────────────────────────

export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number = 60 * 60 * 1000,
    private readonly now: () => number = Date.now,
  ) {}

  /** Is there a free slot? Does NOT consume one. */
  check(key: string): boolean {
    const t = this.now();
    const fresh = (this.hits.get(key) ?? []).filter((h) => t - h < this.windowMs);
    this.hits.set(key, fresh);
    return fresh.length < this.limit;
  }

  /**
   * Consume a slot: called only when an analysis really starts, so rejected requests
   * (busy, broken file, too large) never eat the client's hourly allowance.
   */
  record(key: string): void {
    const t = this.now();
    const list = this.hits.get(key) ?? [];
    list.push(t);
    this.hits.set(key, list);
    if (this.hits.size > 10_000) {
      for (const [k, v] of this.hits) if (v.every((h) => t - h >= this.windowMs)) this.hits.delete(k);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt-injection filter for text extracted from a client's drawing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Heavy CAD PDFs go to the model as extracted TEXT, which means a client's PDF can carry
 * lines aimed at the model. Two layers: the system prompt says file contents are data,
 * never instructions; and this filter removes instruction-shaped lines before the text
 * enters the prompt at all. Pattern lists are short on purpose: they target the shapes
 * that matter here (override the rules, change the role, extract costs, promise
 * discounts) in the three languages the business works in.
 */
const INJECTION_PATTERNS: RegExp[] = [
  /\b(ignore|disregard|forget|override)\b.{0,40}\b(previous|above|prior|earlier|all|any|system|your)\b.{0,30}\b(instruction|prompt|rule|message|guideline)s?\b/i,
  /\b(you are now|act as|pretend (to be|you are)|new instructions?|system prompt|developer (message|mode)|jailbreak)\b/i,
  /^\s*(system|assistant|developer)\s*[:>]/i,
  /<\/?\s*(system|instructions?|assistant|developer)\s*>/i,
  /\b(say|tell|promise|offer|quote|reveal|state)\b.{0,50}\b(discount|cost price|unit costs?|supplier (price|rate)s?|internal (price|rate)s?|margin)\b/i,
  /\b(recommend|use|switch to)\b.{0,30}\b(polystyrene|eps|xps)\b/i,
  /(игнорируй|забудь|не обращай внимания|отмени).{0,40}(инструкц|правил|промпт|указани)/i,
  /(ты теперь|веди себя как|притворись|новая инструкция|системн\w* (промпт|сообщени))/i,
  /(пообещай|назови|раскрой|дай).{0,40}(скидк|себестоимост|закупочн|маржу|расценк)/i,
  /(αγνόησε|ξέχνα|παράβλεψε).{0,40}(οδηγί|κανόν|εντολ)/i,
];

export const END_OF_DRAWING_TEXT = "=== END OF DRAWING TEXT ===";

export function filterInjection(text: string): { text: string; removed: number; samples: string[] } {
  let removed = 0;
  const samples: string[] = [];
  const lines = text.split(/\r?\n/).map((line) => {
    // The closing delimiter is ours alone: a file must not be able to "end" the data block early.
    const cleaned = line.replaceAll(END_OF_DRAWING_TEXT, "");
    if (INJECTION_PATTERNS.some((rx) => rx.test(cleaned))) {
      removed++;
      if (samples.length < 3) samples.push(cleaned.trim().slice(0, 120));
      return "[line removed by the prompt-injection filter]";
    }
    return cleaned;
  });
  return { text: lines.join("\n"), removed, samples };
}

// ─────────────────────────────────────────────────────────────────────────────
// Narrative price audit
// ─────────────────────────────────────────────────────────────────────────────

/** Euro amounts in free text: "EUR 312,900", "€313k", "312 900 €", "€1,490/m2", "€0.3M". */
const MONEY_RX =
  /(?:€|\bEUR\b)\s?(\d{1,3}(?:[ ,.  ]\d{3})+|\d+(?:[.,]\d+)?)\s?([kKmM]\b)?|(\d{1,3}(?:[ ,.  ]\d{3})+|\d+(?:[.,]\d+)?)\s?([kKmM])?\s?(?:€|\bEUR\b)/g;

function parseAmount(num: string, suffix: string | undefined): number {
  const grouped = /^\d{1,3}([ ,.  ]\d{3})+$/.test(num);
  let n = grouped ? Number(num.replace(/[ ,.  ]/g, "")) : Number(num.replace(",", "."));
  if (suffix && /k/i.test(suffix)) n *= 1_000;
  if (suffix && /m/i.test(suffix)) n *= 1_000_000;
  return n;
}

export function extractEuroAmounts(text: string): Array<{ raw: string; value: number }> {
  const out: Array<{ raw: string; value: number }> = [];
  for (const m of text.matchAll(MONEY_RX)) {
    const value = m[1] !== undefined ? parseAmount(m[1], m[2]) : parseAmount(m[3]!, m[4]);
    if (Number.isFinite(value) && value > 0) out.push({ raw: m[0].trim(), value });
  }
  return out;
}

/**
 * Every euro figure in the narrative must be (within 2%) a number the pricing code
 * produced: a total, a rate, a breakdown row or an option. Anything else is a price the
 * model made up, and the narrative is not shown.
 */
export function auditNarrativePrices(narrative: string, estimates: EstimateResult[]): { ok: boolean; unknown: string[] } {
  const allowed: number[] = [...Object.values(OPTIONS)];
  for (const e of estimates) {
    allowed.push(e.totLo, e.totHi, e.totMid, e.rateLo, e.rateHi, e.optAdd, Math.round((e.rateLo + e.rateHi) / 2));
    for (const row of e.breakdown) allowed.push(row.eur);
  }
  const known = (v: number) => allowed.some((a) => a > 0 && Math.abs(v - a) / a <= 0.02);
  const unknown = extractEuroAmounts(narrative)
    .filter((x) => !known(x.value))
    .map((x) => x.raw);
  return { ok: unknown.length === 0, unknown };
}
