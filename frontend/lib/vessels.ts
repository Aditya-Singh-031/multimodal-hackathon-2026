/**
 * Coronary vessel assessment: maps patient-level predictions onto the four major coronary branches.
 *
 * Priority of evidence per vessel:
 *   1. Explicit per-vessel stenosis supplied by the backend (`patient.vessel_stenosis`).
 *   2. Angiographic finding listed in `patient.vessels`, with % parsed from the cath narrative when present.
 *   3. Model-inferred plaque burden derived from the fused composite risk (territory-weighted).
 *
 * Physiology estimates (FFR, flow reduction) are coarse, illustrative approximations for decision support.
 */
import type { Patient, Prediction, VesselAssessment, VesselId, VesselStatus } from "./types";

export const VESSEL_IDS: VesselId[] = ["LAD", "LCx", "RCA", "LM"];

interface VesselMeta {
  name: string;
  short: string;
  territory: string;
  wall: string;
  leads: string[];
  leadNote: string;
  myocardiumAtRisk: number; // approx. share of LV myocardium supplied (%)
  inferredWeight: number; // relative atherosclerotic predilection used for model-inferred burden
}

export const VESSEL_META: Record<VesselId, VesselMeta> = {
  LAD: {
    name: "Left Anterior Descending",
    short: "LAD",
    territory: "Anterior wall · interventricular septum · apex",
    wall: "Anterior / Septal",
    leads: ["V1", "V2", "V3", "V4"],
    leadNote: "Anteroseptal ST changes (V1–V4)",
    myocardiumAtRisk: 45,
    inferredWeight: 1,
  },
  LCx: {
    name: "Left Circumflex",
    short: "LCx",
    territory: "Lateral wall · posterolateral LV",
    wall: "Lateral",
    leads: ["I", "aVL", "V5", "V6"],
    leadNote: "High-lateral / lateral ST changes (I, aVL, V5–V6)",
    myocardiumAtRisk: 25,
    inferredWeight: 0.75,
  },
  RCA: {
    name: "Right Coronary Artery",
    short: "RCA",
    territory: "Inferior wall · RV · SA/AV nodes",
    wall: "Inferior",
    leads: ["II", "III", "aVF"],
    leadNote: "Inferior ST changes (II, III, aVF)",
    myocardiumAtRisk: 30,
    inferredWeight: 0.85,
  },
  LM: {
    name: "Left Main Trunk",
    short: "LM",
    territory: "LAD + LCx territories (~75% of LV)",
    wall: "Global LV",
    leads: ["aVR", "V1"],
    leadNote: "ST elevation in aVR/V1 with diffuse ST depression",
    myocardiumAtRisk: 75,
    inferredWeight: 0.55,
  },
};

export const ALL_LEADS = ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"];

export const STATUS_COLOR: Record<VesselStatus, string> = {
  patent: "#34d399",
  mild: "#fbbf24",
  critical: "#f43f5e",
};
export const STATUS_LABEL: Record<VesselStatus, string> = {
  patent: "Patent",
  mild: "Mild stenosis",
  critical: "Critical stenosis",
};

/** Green < 25% · Amber 25–50% · Red > 50%. */
export const statusFor = (stenosis: number): VesselStatus =>
  stenosis > 50 ? "critical" : stenosis >= 25 ? "mild" : "patent";

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

/** Coarse pressure-derived FFR proxy: ~1.0 below 30%, ~0.8 near 60%, steep fall beyond 70%. */
export const estimateFfr = (stenosis: number) => +clamp(1 - 0.9 * Math.pow(stenosis / 100, 3), 0.2, 1).toFixed(2);

function parseNarrative(notes: string | null | undefined, id: VesselId): number | null {
  if (!notes) return null;
  const alias = id === "LM" ? "(?:LM|left main)" : id === "LCx" ? "(?:LCx|circumflex)" : id;
  const re = new RegExp(`(\\d{2,3})\\s*%\\s*(?:(?:ostial|proximal|mid|distal)[-\\s])?${alias}\\b`, "i");
  const m = notes.match(re);
  return m ? clamp(+m[1], 0, 99) : null;
}

export function assessVessels(patient: Patient, prediction: Pick<Prediction, "risk"> | null): VesselAssessment[] {
  const risk = clamp(prediction?.risk ?? 0, 0, 1);
  const listed = new Set(patient.vessels ?? []);
  const notes = patient.request.notes ?? "";
  const severe = /severe|multivessel|3-vessel|three-vessel/i.test(notes);

  return VESSEL_IDS.map((id) => {
    const meta = VESSEL_META[id];
    let stenosis: number;
    let source: VesselAssessment["source"];

    const explicit = patient.vessel_stenosis?.[id];
    if (typeof explicit === "number") {
      stenosis = explicit;
      source = "angiography";
    } else if (listed.has(id)) {
      const parsed = parseNarrative(notes, id);
      if (parsed !== null) {
        stenosis = parsed;
        source = "clinical-note";
      } else {
        // Listed lesion without a quantified %: significant by definition, scaled by severity language + fused risk.
        stenosis = (severe ? 72 : 60) + 22 * risk * meta.inferredWeight;
        source = "angiography";
      }
    } else {
      // No documented lesion: territory-weighted plaque burden inferred from the composite model risk.
      stenosis = Math.max(4, risk * 115 * meta.inferredWeight);
      source = "model";
    }

    stenosis = Math.round(clamp(stenosis, 0, 99));
    const ffr = estimateFfr(stenosis);
    return {
      id,
      name: meta.name,
      territory: meta.territory,
      wall: meta.wall,
      leads: meta.leads,
      stenosis,
      status: statusFor(stenosis),
      source,
      ffr,
      flowReduction: Math.round((1 - ffr) * 100),
      myocardiumAtRisk: meta.myocardiumAtRisk,
    };
  });
}

/** Most severe vessel if any is critical, otherwise null (drives auto-focus on patient change). */
export const culpritVessel = (vs: VesselAssessment[]): VesselAssessment | null => {
  const worst = vs.reduce<VesselAssessment | null>((a, v) => (!a || v.stenosis > a.stenosis ? v : a), null);
  return worst && worst.status === "critical" ? worst : null;
};
