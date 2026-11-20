/**
 * Parametric price model of the estimator. The LLM never names a price: it extracts
 * geometry, then calls the `estimate` tool, and THIS code computes every euro.
 *
 * ILLUSTRATIVE NUMBERS. The structure is the production one (three packages, per-m2
 * curves through anchor projects, breakdown shares, options, an uncertainty band that
 * widens outside the anchors), and so are the curve shapes: small houses cost more per m2,
 * totals rise strictly with area, base < shell < turnkey. The numbers themselves are
 * placeholders: the production rates come from a real bill of quantities and supplier
 * quotes and stay private. The anchors match the public example knowledge base
 * (voice-agent/knowledge_base.example.md, section 4.2), so agent and calculator agree.
 *
 * The inline copy of this model in index.html (used when the page is opened without a
 * server) must stay identical: `npm run eval` fails on any drift.
 * All prices exclude VAT.
 */

import { facadeSpec, foundationCost, frameSpec, normalizeFloors, COST_DISCLAIMER } from "./costing.js";

export type PackageId = "base" | "shell" | "turnkey";

/** The single registry of packages: server, agent and eval read it, nobody re-lists them. */
export const PACKAGE_IDS = ["base", "shell", "turnkey"] as const satisfies readonly PackageId[];

export const PACKAGE_LABELS: Readonly<Record<PackageId, string>> = {
  base: "Frame Package",
  shell: "Shell Package",
  turnkey: "Turnkey Package",
};

export type BreakdownRow = {
  /** Stable category key (used to attach the grounded physical explanation). */
  key: string;
  name: string;
  /** Share of the total, % */
  pct: number;
  /** EUR = construction midpoint x pct / 100 */
  eur: number;
  /** Physical quantities behind the row (foundation, frame, facade), when available. */
  detail?: string;
  /** Mandatory caveat that travels with every grounded quantity. */
  disclaimer?: string;
};

export type EstimateParams = {
  area_m2: number;
  floors: number;
  package: PackageId;
  carport: boolean;
  septic: boolean;
};

export type EstimateResult = {
  package: PackageId;
  label: string;
  rateLo: number;
  rateHi: number;
  /** Totals include options. */
  totLo: number;
  totHi: number;
  totMid: number;
  /** Options sum (carport / septic), EUR */
  optAdd: number;
  breakdown: BreakdownRow[];
  /** Inputs as the model understood them, after normalisation. */
  params: { area_m2: number; floors: number; carport: boolean; septic: boolean };
  /**
   * Range of areas covered by this package's anchor projects. Outside it the rate is
   * clamped (extrapolated=true) and the band widens: an honest signal for the UI that
   * the number is rougher than usual.
   */
  curve: { areaMin: number; areaMax: number; extrapolated: boolean };
  notes: string[];
};

/** Frame Package: [area m2, EUR/m2] at the typical projects (illustrative). */
export const BASE_POINTS: ReadonlyArray<readonly [number, number]> = (
  [
    [48, 540],
    [64, 520],
    [82, 495],
    [118, 410],
    [142, 385],
    [176, 360],
  ] as Array<[number, number]>
)
  .slice()
  .sort((a, b) => a[0] - b[0]);

/** Linear interpolation over sorted [x, y] points, clamped at both ends. */
export function interpRate(area: number, points: ReadonlyArray<readonly [number, number]>): number {
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (area <= first[0]) return first[1];
  if (area >= last[0]) return last[1];
  for (let i = 0; i < points.length - 1; i++) {
    const lo = points[i]!;
    const hi = points[i + 1]!;
    if (area >= lo[0] && area <= hi[0]) {
      const t = (area - lo[0]) / (hi[0] - lo[0]);
      return lo[1] + t * (hi[1] - lo[1]);
    }
  }
  return last[1];
}

/**
 * The base curve is interpolated in TOTAL space, not rate space. Interpolating the rate
 * between two anchors where it drops steeply makes the total dip: in production a larger
 * house came out cheaper than a smaller one (a regression the dense monotonicity scan in
 * eval.ts caught). Totals at the anchors rise strictly, so interpolating them is monotonic
 * and the anchors themselves are unchanged.
 */
export function rateViaTotals(area: number, points: ReadonlyArray<readonly [number, number]>): number {
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (area <= first[0]) return first[1];
  if (area >= last[0]) return last[1];
  const totals = points.map(([a, r]) => [a, a * r] as const);
  return interpRate(area, totals) / area;
}

export function baseRate(area: number): number {
  return rateViaTotals(area, BASE_POINTS);
}

/**
 * Shell and turnkey rates are CURVES over area, not flat rates: small houses carry the
 * same fixed costs over fewer m2. Two anchors each (illustrative): the 48 m2 bungalow from
 * the example KB and a 210 m2 reference duplex. Linear between them, clamped outside.
 */
export const TURNKEY_POINTS: ReadonlyArray<readonly [number, number]> = [
  [48, 1880],
  [210, 1490],
];
export const SHELL_POINTS: ReadonlyArray<readonly [number, number]> = [
  [48, 1390],
  [210, 1060],
];
/** +-7% band for shell/turnkey. */
export const PACKAGE_BAND = 0.07;
/** The base curve has six anchors, so its band is tighter: +-4%. */
export const BASE_BAND = 0.04;

/** Anchor projects (area + real storey count) used for the typical-storeys note. */
export const ANCHOR_SMALL = { area_m2: 48, floors: 1 } as const;
export const ANCHOR_LARGE = { area_m2: 210, floors: 2 } as const;

const CURVES: Record<PackageId, { points: ReadonlyArray<readonly [number, number]>; band: number }> = {
  base: { points: BASE_POINTS, band: BASE_BAND },
  shell: { points: SHELL_POINTS, band: PACKAGE_BAND },
  turnkey: { points: TURNKEY_POINTS, band: PACKAGE_BAND },
};

/** Options outside every package, EUR (illustrative). */
export const OPTIONS = {
  carport: 5200,
  septic: 4300,
} as const;

/**
 * Model limits. Below 25 m2 the extraction almost certainly read a room instead of the
 * house: a confident estimate for 8 m2 is worse than an honest refusal. Above 1,200 m2 is
 * not residential scale: that needs a manual estimate.
 */
export const MODEL_AREA_MIN = 25;
export const MODEL_AREA_MAX = 1200;

/** Breakdown shares per package (illustrative), 100% each. */
export const BREAKDOWN_SHARES: Record<PackageId, ReadonlyArray<{ key: string; name: string; pct: number }>> = {
  turnkey: [
    { key: "foundation", name: "Foundation", pct: 9 },
    { key: "frame", name: "Steel frame + floor slab", pct: 18 },
    { key: "facade", name: "Insulation + mineral facade", pct: 21 },
    { key: "roof", name: "Roof", pct: 7 },
    { key: "windows", name: "Windows and doors", pct: 9 },
    { key: "warmfloor", name: "Underfloor heating", pct: 5 },
    { key: "finish", name: "Floors, ceilings, wall finishes", pct: 11 },
    { key: "mep", name: "Plumbing + electrics", pct: 8 },
    { key: "hvac", name: "Climate + hot water (heat recovery)", pct: 4 },
    { key: "furniture", name: "Built-in furniture", pct: 5 },
    { key: "outdoor", name: "Outdoor works", pct: 3 },
  ],
  shell: [
    { key: "foundation", name: "Foundation", pct: 12.5 },
    { key: "frame", name: "Steel frame + floor slab", pct: 26 },
    { key: "facade", name: "Insulation + mineral facade", pct: 31 },
    { key: "roof", name: "Roof", pct: 10 },
    { key: "windows", name: "Windows and doors", pct: 12 },
    { key: "ceilings", name: "Ceilings", pct: 1.5 },
    { key: "rough_mep", name: "Rough-in MEP", pct: 7 },
  ],
  base: [
    { key: "foundation", name: "Foundation", pct: 34 },
    { key: "frame", name: "G550 steel frame", pct: 58 },
    { key: "slab_utils", name: "Floor slab / utility connections", pct: 8 },
  ],
};

/**
 * The estimate. total = area x rate + options; each breakdown row = construction
 * midpoint x share. Foundation, frame and facade rows carry their physical quantities
 * (concrete m3, steel tonnes, facade m2) from costing.ts; their euros stay a share of
 * the total.
 */
export function estimate(params: EstimateParams): EstimateResult {
  const { area_m2: area, package: pkg, carport, septic } = params;

  // The model may legitimately return no area for an unreadable drawing -> NaN here.
  // Throw a clear error so the tool_result goes back as is_error and the narrative says
  // "area not found" instead of showing "~NaN m3 of concrete".
  if (!Number.isFinite(area) || area <= 0) {
    throw new Error("area_m2 must be a positive number (no area was extracted from the drawing)");
  }
  if (area < MODEL_AREA_MIN) {
    throw new Error(
      `${area} m2 is below the smallest home (~${MODEL_AREA_MIN} m2): this looks like the area of a room, not the house. Please confirm the total floor area.`,
    );
  }
  if (area > MODEL_AREA_MAX) {
    throw new Error(
      `${area} m2 is outside the parametric model (up to ${MODEL_AREA_MAX} m2): this scale needs a manual estimate, please book a consultation with the architect.`,
    );
  }
  // `package` arrives from the model (an enum in the tool schema) and from the API.
  // Object.hasOwn, not `in`: "toString" and "constructor" pass `in` through the prototype.
  if (!Object.hasOwn(BREAKDOWN_SHARES, pkg)) {
    throw new Error(`Unknown package "${String(pkg)}": expected ${PACKAGE_IDS.join(" | ")}`);
  }
  const floors = normalizeFloors(params.floors);

  // Rate: curve midpoint +- band. Outside the anchors the band widens by 1 point per
  // ~10% of overrun, up to +5 points: extrapolation is rougher.
  const curve = CURVES[pkg];
  const pts = curve.points;
  const areaMin = pts[0]![0];
  const areaMax = pts[pts.length - 1]![0];
  const extrapolated = area < areaMin || area > areaMax;
  const overrun = area < areaMin ? (areaMin - area) / areaMin : area > areaMax ? (area - areaMax) / areaMax : 0;
  const band = curve.band + Math.min(0.05, overrun * 0.1);

  const rateMid = pkg === "base" ? baseRate(area) : interpRate(area, pts);
  const rateLo = rateMid * (1 - band);
  const rateHi = rateMid * (1 + band);

  let optAdd = 0;
  if (carport) optAdd += OPTIONS.carport;
  if (septic) optAdd += OPTIONS.septic;

  // Construction WITHOUT options: the shares describe construction. (An earlier version
  // spread options over every category: the client saw an inflated foundation and no
  // carport line at all.)
  const constrMid = area * rateMid;
  const totLo = area * rateLo + optAdd;
  const totHi = area * rateHi + optAdd;
  const totMid = constrMid + optAdd;

  const fnd = foundationCost({ area_m2: area, floors });
  const frm = frameSpec({ area_m2: area, floors });
  const fac = facadeSpec({ area_m2: area, floors });

  // No false precision: rows to EUR 10, shares to 0.1%.
  const r10 = (n: number) => Math.round(n / 10) * 10;
  const pctOf = (eur: number) => Math.round((eur / totMid) * 1000) / 10;

  const breakdown: BreakdownRow[] = BREAKDOWN_SHARES[pkg].map((row) => {
    const eur = r10((constrMid * row.pct) / 100);
    const out: BreakdownRow = { key: row.key, name: row.name, pct: pctOf(eur), eur };
    const detail = row.key === "foundation" ? fnd.basis : row.key === "frame" ? frm.basis : row.key === "facade" ? fac.basis : undefined;
    if (detail) {
      out.detail = detail;
      out.disclaimer = COST_DISCLAIMER;
    }
    return out;
  });
  // Options as their own rows, not dissolved into construction categories.
  if (carport) breakdown.push({ key: "carport", name: "Carport (option)", pct: pctOf(OPTIONS.carport), eur: OPTIONS.carport });
  if (septic) breakdown.push({ key: "septic", name: "Septic tank (option)", pct: pctOf(OPTIONS.septic), eur: OPTIONS.septic });

  const notes: string[] = [];
  if (extrapolated) {
    notes.push(
      `${Math.round(area)} m2 is outside the range of the anchor projects (${Math.round(areaMin)}-${Math.round(areaMax)} m2): the band is wider and the figures rougher than usual.`,
    );
  }
  // Typical storey count interpolates between the anchors (1-storey bungalow -> 2-storey
  // duplex). An unusual count changes foundation and roof area; there is no data to price
  // that, so the price is untouched and the client is told honestly.
  const typicalFloors = Math.min(
    ANCHOR_LARGE.floors,
    Math.max(
      ANCHOR_SMALL.floors,
      ANCHOR_SMALL.floors + ((area - ANCHOR_SMALL.area_m2) / (ANCHOR_LARGE.area_m2 - ANCHOR_SMALL.area_m2)) * (ANCHOR_LARGE.floors - ANCHOR_SMALL.floors),
    ),
  );
  if (floors < typicalFloors - 0.5) {
    notes.push("A single storey at this size means a larger foundation and roof: the real price may be above this estimate; the architect will refine it.");
  } else if (floors > typicalFloors + 0.75) {
    notes.push("More storeys than usual for this size: smaller foundation and roof, but extra stairs and slabs; the architect will refine it.");
  }

  // Totals to EUR 100, rates to EUR 1: this is an estimate, not a quote.
  const r100 = (n: number) => Math.round(n / 100) * 100;
  return {
    package: pkg,
    label: PACKAGE_LABELS[pkg],
    rateLo: Math.round(rateLo),
    rateHi: Math.round(rateHi),
    totLo: r100(totLo),
    totHi: r100(totHi),
    totMid: r100(totMid),
    optAdd,
    breakdown,
    params: { area_m2: area, floors, carport, septic },
    curve: { areaMin, areaMax, extrapolated },
    notes,
  };
}

/** The whole model as one JSON (GET /api/model): the UI reads limits and labels from it. */
export function modelConfig() {
  return {
    version: 1,
    illustrative: true,
    currency: "EUR",
    vat_included: false,
    disclaimer: "Indicative estimate (+-), not a final price. Illustrative price model: production price lists are private.",
    limits: { area_min: MODEL_AREA_MIN, area_max: MODEL_AREA_MAX, floors_min: 1, floors_max: 4 },
    packages: PACKAGE_IDS.map((id) => ({
      id,
      label: PACKAGE_LABELS[id],
      points: CURVES[id].points,
      band: CURVES[id].band,
      breakdown_shares: BREAKDOWN_SHARES[id],
    })),
    options: [
      { id: "carport", label: "Carport", eur: OPTIONS.carport },
      { id: "septic", label: "Septic tank", eur: OPTIONS.septic },
    ],
  };
}
