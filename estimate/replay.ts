/**
 * Offline replay of the model side of the agentic loop.
 *
 * A fixture holds what the model "saw" on a drawing (the extraction) and a note template.
 * replayTransport answers each Messages API request the way the live model does:
 *   turn 1 -> tool_use report_extraction(extraction)
 *   turn 2 -> tool_use estimate x 3 (base, shell, turnkey)
 *   turn 3 -> end_turn with the note, its {{placeholders}} filled from the tool_result
 *             JSON the loop sent back, i.e. from numbers the PRICING CODE computed.
 * Everything else is the real code path: agent.ts runs the tools, pricing.ts prices,
 * the narrative audit checks the note. No key, no network, no tokens.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AnthropicResponse, ContentBlock, ExtractionInput, Message, Transport } from "./agent.js";
import { PACKAGE_IDS, type EstimateResult } from "./pricing.js";

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEMO_FIXTURE_PATH = join(HERE, "fixtures", "demo-house.json");

export type DemoFixture = {
  id: string;
  label: string;
  filename: string;
  /** What a reader of the drawing should extract: also the ground truth for `eval -- extract`. */
  extraction: ExtractionInput;
  carport: boolean;
  septic: boolean;
  /** Note template: {{area}}, {{floors}}, {{<package>.lo|hi|mid}} */
  narrative: string;
};

export function loadDemoFixture(path = DEMO_FIXTURE_PATH): DemoFixture {
  return JSON.parse(readFileSync(path, "utf8")) as DemoFixture;
}

const eur = (n: number) => "€" + Math.round(n).toLocaleString("en-US");

function toolResultsByPackage(messages: Message[]): Map<string, EstimateResult> {
  const out = new Map<string, EstimateResult>();
  for (const m of messages) {
    if (m.role !== "user") continue;
    for (const block of m.content) {
      if (block.type !== "tool_result") continue;
      try {
        const r = JSON.parse(String((block as { content: unknown }).content)) as Partial<EstimateResult>;
        if (r.package) out.set(r.package, r as EstimateResult);
      } catch {
        // not an estimate result
      }
    }
  }
  return out;
}

export function fillNarrative(template: string, fx: DemoFixture, byPkg: Map<string, EstimateResult>): string {
  return template.replace(/\{\{\s*([a-z_]+)(?:\.(lo|hi|mid))?\s*\}\}/g, (_, key: string, field?: string) => {
    if (key === "area") return String(fx.extraction.area_m2);
    if (key === "floors") return String(fx.extraction.floors);
    const e = byPkg.get(key);
    if (!e || !field) return "?";
    return eur(field === "lo" ? e.totLo : field === "hi" ? e.totHi : e.totMid);
  });
}

export function replayTransport(fx: DemoFixture, opts: { latencyMs?: number; narrativeOverride?: string } = {}): Transport {
  return async (req, signal) => {
    if (opts.latencyMs) await new Promise((r) => setTimeout(r, opts.latencyMs));
    if (signal?.aborted) throw new Error("CLIENT_ABORTED");
    const turn = req.messages.filter((m) => m.role === "assistant").length;
    const usage = { input_tokens: 0, output_tokens: 0 };

    if (turn === 0) {
      const content: ContentBlock[] = [
        { type: "text", text: "Reading the drawing." },
        { type: "tool_use", id: "toolu_replay_extract", name: "report_extraction", input: { ...fx.extraction } },
      ];
      return { content, stop_reason: "tool_use", usage } satisfies AnthropicResponse;
    }
    if (turn === 1) {
      const content: ContentBlock[] = PACKAGE_IDS.map((pkg) => ({
        type: "tool_use" as const,
        id: `toolu_replay_${pkg}`,
        name: "estimate",
        input: { area_m2: fx.extraction.area_m2, floors: fx.extraction.floors, package: pkg, carport: fx.carport, septic: fx.septic },
      }));
      return { content, stop_reason: "tool_use", usage } satisfies AnthropicResponse;
    }
    const text = fillNarrative(opts.narrativeOverride ?? fx.narrative, fx, toolResultsByPackage(req.messages));
    return { content: [{ type: "text", text }], stop_reason: "end_turn", usage } satisfies AnthropicResponse;
  };
}
