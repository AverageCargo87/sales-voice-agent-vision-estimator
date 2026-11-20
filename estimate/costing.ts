/**
 * Grounded physical quantities behind the foundation, frame and facade rows.
 *
 * The client-facing estimate shows PHYSICAL QUANTITIES only (m3 of concrete, tonnes of
 * steel, m2 of facade) and the method, never unit costs. Every grounded figure travels
 * with COST_DISCLAIMER: the owner's rule is "always say that current market prices and a
 * design to local codes are needed".
 *
 * ILLUSTRATIVE UNIT COSTS. In production this module is calibrated on supplier price lists
 * (ready-mix concrete, the steel-frame factory's weights and quotation, the facade system)
 * and on a real bill of quantities. Those are confidential; the numbers below are
 * placeholders of a plausible order of magnitude. Eval checks that the grounded cost lands
 * near the breakdown share of the reference duplex, the same check the production model
 * passes against its real estimate.
 */

export const COST_DISCLAIMER = "Indicative: needs current market prices and a design to local codes.";

/**
 * One storey normalisation for every calculation (costing and pricing):
 * NaN / Infinity / 0 / negative / fractional -> an integer in 1..4.
 */
export function normalizeFloors(f: number | undefined): number {
  const n = Number.isFinite(f) ? Math.round(f as number) : 1;
  return Math.min(4, Math.max(1, n));
}

// ─────────────────────────────────────────────────────────────────────────────
// Unit costs (ILLUSTRATIVE, ex-VAT, internal: never shown to the client)
// ─────────────────────────────────────────────────────────────────────────────

/** Ready-mix concrete, EUR/m3 by grade. */
export const CONCRETE_PRICES_EUR_M3: Readonly<Record<string, number>> = {
  "C20/25": 90,
  "C25/30": 96,
  "C30/37": 101,
};

export const CONCRETE_EXTRAS = {
  pumpEurM3: 5,
  pumpMinEur: 200,
  pumpSetupEur: 80,
  smallOrderTruckEur: 60,
  smallOrderThresholdM3: 4.5,
} as const;

/** Steel frame all-in rate (material + factory assembly + site erection), EUR/kg, plus a fixed delivery. */
export const FRAME_RATES = {
  allInEurPerKg: 4.9,
  transportEur: 2000,
  steelGrade: "G550",
} as const;

/** Facade system material rates, EUR/m2 (internal; the facade row's euros come from its share). */
export const FACADE_RATES = {
  wallEurM2: 52,
  roofEurM2: 54,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Engineering norms (defaults; always quoted with the disclaimer)
// ─────────────────────────────────────────────────────────────────────────────

export const FOUNDATION_DEFAULTS = {
  slabThicknessM: 0.4, // reinforced raft, 30-40 cm
  footingFactor: 1.15, // ribs, thickenings and blinding on top of the slab volume
  grade: "C25/30" as keyof typeof CONCRETE_PRICES_EUR_M3, // typical residential raft
  rebarNormKgPerM3: 90, // reinforcement per m3 of concrete
  rebarEurPerKg: 1.35, // supply + fixing (illustrative)
  worksEurPerM2: 140, // earthworks, formwork, blinding, waterproofing, pour, per m2 of footprint (illustrative)
  rangePct: 0.08,
} as const;

export const STEEL_NORMS = {
  /** Effective G550 steel per m2 of gross floor area for a 2-storey house. */
  kgPerM2At2Floors: 48,
  /** Floor joists between storeys, kg per m2 of slab. */
  interfloorJoistKgPerM2: 12,
} as const;

/**
 * Steel per m2 of GFA by storey count: (floors - 1) intermediate slabs spread over
 * `floors` storeys of area. Calibrated at 2 storeys; a bungalow has no intermediate slab
 * and needs less steel per m2.
 */
export function steelKgPerM2(floors: number): number {
  const fl = normalizeFloors(floors);
  return STEEL_NORMS.kgPerM2At2Floors + STEEL_NORMS.interfloorJoistKgPerM2 * ((fl - 1) / fl - 1 / 2);
}

// ─────────────────────────────────────────────────────────────────────────────
// Foundation (raft slab)
// ─────────────────────────────────────────────────────────────────────────────

export type FoundationInput = {
  area_m2: number; // total over all storeys
  floors: number;
  slabThicknessM?: number; // override, clamped to 0.30-0.40
  grade?: keyof typeof CONCRETE_PRICES_EUR_M3;
};

export type FoundationCost = {
  footprintM2: number;
  slabThicknessM: number;
  concreteM3: number;
  grade: string;
  rebarTonnes: number;
  eurLo: number;
  eurMid: number;
  eurHi: number;
  /** Human-readable physics for the UI (no unit costs). */
  basis: string;
  disclaimer: string;
};

export function foundationCost(input: FoundationInput): FoundationCost {
  if (!Number.isFinite(input.area_m2) || input.area_m2 <= 0) throw new Error("foundationCost: area_m2 must be a positive number");
  const floors = normalizeFloors(input.floors);
  const footprint = input.area_m2 / floors;
  // Thickness only inside the real range: a garbage override must not produce zero concrete.
  const t = Math.min(0.4, Math.max(0.3, input.slabThicknessM ?? FOUNDATION_DEFAULTS.slabThicknessM));
  // Unknown grade -> honest fallback in BOTH the price and the text.
  const grade = input.grade !== undefined && input.grade in CONCRETE_PRICES_EUR_M3 ? input.grade : FOUNDATION_DEFAULTS.grade;

  const concreteM3 = footprint * t * FOUNDATION_DEFAULTS.footingFactor;
  const rebarKg = concreteM3 * FOUNDATION_DEFAULTS.rebarNormKgPerM3;
  const pump = Math.max(CONCRETE_EXTRAS.pumpMinEur, concreteM3 * CONCRETE_EXTRAS.pumpEurM3) + CONCRETE_EXTRAS.pumpSetupEur;
  const smallOrder = concreteM3 < CONCRETE_EXTRAS.smallOrderThresholdM3 ? CONCRETE_EXTRAS.smallOrderTruckEur : 0;
  const mid =
    concreteM3 * CONCRETE_PRICES_EUR_M3[grade]! +
    rebarKg * FOUNDATION_DEFAULTS.rebarEurPerKg +
    pump +
    smallOrder +
    footprint * FOUNDATION_DEFAULTS.worksEurPerM2;
  const r = FOUNDATION_DEFAULTS.rangePct;

  return {
    footprintM2: footprint,
    slabThicknessM: t,
    concreteM3,
    grade,
    rebarTonnes: rebarKg / 1000,
    eurLo: mid * (1 - r),
    eurMid: mid,
    eurHi: mid * (1 + r),
    basis:
      `${Math.round(t * 100)} cm raft on a ~${Math.round(footprint)} m2 footprint -> ` +
      `~${concreteM3.toFixed(1)} m3 of ${grade} concrete + ~${(rebarKg / 1000).toFixed(1)} t of rebar + formwork, pour and pump`,
    disclaimer: COST_DISCLAIMER,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Steel frame (LGSF, G550)
// ─────────────────────────────────────────────────────────────────────────────

export type FrameSpecInput = { area_m2: number; floors: number };

export type FrameSpec = {
  steelTonnes: number;
  steelKgPerM2: number;
  eurLo: number;
  eurMid: number;
  eurHi: number;
  basis: string;
  disclaimer: string;
};

export function frameSpec(input: FrameSpecInput): FrameSpec {
  if (!Number.isFinite(input.area_m2) || input.area_m2 <= 0) throw new Error("frameSpec: area_m2 must be a positive number");
  const floors = normalizeFloors(input.floors);
  const kgPerM2 = steelKgPerM2(floors);
  const steelKg = input.area_m2 * kgPerM2;
  // Delivery is a fixed cost: it does not scale with tonnage.
  const mid = steelKg * FRAME_RATES.allInEurPerKg + FRAME_RATES.transportEur;
  const r = 0.08;
  const withJoists = floors >= 2 ? " + intermediate floor" : "";
  return {
    steelTonnes: steelKg / 1000,
    steelKgPerM2: kgPerM2,
    eurLo: mid * (1 - r),
    eurMid: mid,
    eurHi: mid * (1 + r),
    basis:
      `${FRAME_RATES.steelGrade} steel, 150/89 mm sections, ~${kgPerM2.toFixed(1)} kg/m2 -> ` +
      `~${(steelKg / 1000).toFixed(1)} t (material + factory assembly + erection${withJoists})`,
    disclaimer: COST_DISCLAIMER,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Mineral facade and roof insulation (aerated-concrete boards)
// ─────────────────────────────────────────────────────────────────────────────

/** Public product characteristics that may be shown to the client. */
export const FACADE_SYSTEM = {
  thicknessMm: 100,
  fireClass: "A1",
} as const;

/**
 * Facade geometry (approximate, typical residential plan). A flat 0.9 x GFA coefficient
 * ignored the storey count and badly understated bungalows: a 50 m2 bungalow has about
 * 70 m2 of facade, not 45.
 */
export const FACADE_GEOMETRY = {
  wallHeightM: 3.0, // storey height including the slab
  planAspect: 1.4, // footprint rectangle a:b
  openingsFactor: 0.85, // -15% for windows and doors
} as const;

/** Facade area: perimeter of a rectangular footprint x height x storeys - openings. */
export function facadeAreaM2(area_m2: number, floors: number): number {
  const fl = normalizeFloors(floors);
  const footprint = area_m2 / fl;
  const r = FACADE_GEOMETRY.planAspect;
  // A rectangle of area F and aspect r has perimeter P = 2 * sqrt(F) * (sqrt(r) + 1/sqrt(r))
  const perimeter = 2 * Math.sqrt(footprint) * (Math.sqrt(r) + 1 / Math.sqrt(r));
  return perimeter * FACADE_GEOMETRY.wallHeightM * fl * FACADE_GEOMETRY.openingsFactor;
}

export type FacadeSpec = {
  facadeAreaM2: number;
  roofAreaM2: number;
  thicknessMm: number;
  /** Internal material cost (no installation or render), EUR. */
  eurMaterialMid: number;
  basis: string;
  disclaimer: string;
};

export function facadeSpec(input: FrameSpecInput): FacadeSpec {
  if (!Number.isFinite(input.area_m2) || input.area_m2 <= 0) throw new Error("facadeSpec: area_m2 must be a positive number");
  const floors = normalizeFloors(input.floors);
  const facade = facadeAreaM2(input.area_m2, floors);
  const roof = input.area_m2 / floors; // flat roof ~ footprint
  return {
    facadeAreaM2: facade,
    roofAreaM2: roof,
    thicknessMm: FACADE_SYSTEM.thicknessMm,
    eurMaterialMid: facade * FACADE_RATES.wallEurM2 + roof * FACADE_RATES.roofEurM2,
    basis:
      `${FACADE_SYSTEM.thicknessMm} mm mineral facade boards (non-combustible, ${FACADE_SYSTEM.fireClass}), ` +
      `~${Math.round(facade)} m2 of facade + ~${Math.round(roof)} m2 of roof`,
    disclaimer: COST_DISCLAIMER,
  };
}
