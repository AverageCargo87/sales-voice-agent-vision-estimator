/**
 * Text extraction from PDF with unpdf (pure JS: no native build, no Python).
 *
 * The fallback for heavy vector CAD PDFs that the API's native PDF reader rejects
 * ("Could not process PDF"). In such drawings the areas and room labels are text,
 * which is enough for an estimate.
 *
 * Text goes out PER PAGE with "=== PAGE N of M ===" markers: in a CAD set one sheet is
 * one plan or storey, and the markers help the model attribute areas to storeys.
 */
import { extractText, getDocumentProxy } from "unpdf";

export type PdfText = { text: string; pages: number };

/** Upper bound for the merged text (agent.ts cuts to 120k anyway). */
const MAX_TEXT_CHARS = 150_000;

export const PAGE_MARKER_RX = /=== PAGE \d+ of \d+ ===/g;

export async function extractPdfText(data: Uint8Array): Promise<PdfText> {
  const pdf = await getDocumentProxy(data);
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  // mergePages:false -> string[] per page; guard against a plain string anyway.
  const raw = text as unknown as string | string[];
  const pageTexts = Array.isArray(raw) ? raw : [raw];
  const merged = pageTexts
    .map((t, i) => `=== PAGE ${i + 1} of ${totalPages} ===\n${(t ?? "").trim()}`)
    .join("\n\n")
    .slice(0, MAX_TEXT_CHARS);
  return { text: merged, pages: totalPages };
}
