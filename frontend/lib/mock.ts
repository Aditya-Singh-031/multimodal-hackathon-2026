/** Offline fallback: deterministic patients + client-side risk model so the demo never fails. */
import type { Features, Patient, PredictRequest, Prediction, Shap, Simulation, Tier, VesselId, VesselPrediction } from "./types";
import { estimateFfr, VESSEL_IDS, VESSEL_META } from "./vessels";

const FS = 250;

function ecg(hr: number, abn: number, seconds = 6): number[] {
  const n = FS * seconds;
  const out = new Array(n).fill(0);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  const rr = 60 / hr;
  for (let beat = 0.3; beat < seconds; beat += rr * (1 + rnd() * 0.04 * (1 + 3 * abn))) {
    const parts: [number, number, number][] = [
      [0.12, -0.2, 0.025], [-0.12, -0.04, 0.012], [1, 0, 0.012], [-0.2, 0.035, 0.012], [0.3 - 0.4 * abn, 0.25, 0.05],
    ];
    for (let i = 0; i < n; i++) {
      const t = i / FS;
      if (Math.abs(t - beat) > 0.6) continue;
      for (const [a, o, w] of parts) out[i] += a * Math.exp(-((t - (beat + o)) ** 2) / (2 * w * w));
      out[i] -= 0.15 * abn * Math.exp(-((t - (beat + 0.12)) ** 2) / (2 * 0.04 * 0.04));
    }
  }
  return out.map((v) => +(v + rnd() * 0.04).toFixed(4));
}

const mk = (id: string, name: string, f: Features, abn: number, vessels: string[], profile: string, notes: string): Patient => ({
  id, name, label: null, vessels, profile, features: f,
  request: { patient_id: id, features: f, ecg: { signal: ecg(f.resting_hr, abn), sampling_rate: FS }, notes },
});

export const MOCK_PATIENTS: Patient[] = [
  mk("DEMO01", "Asha Verma", { age: 34, sex: "F", systolic_bp: 112, cholesterol: 172, smoker: false, diabetic: false, bmi: 22.4, resting_hr: 64, chest_pain_type: 0, exercise_angina: false, st_elevation: false, t_inversion: false, lvh: false, rwma: 0, cardiac_enzymes_elevated: false, ca: 0, oldpeak: 0.0 }, 0.05, [], "low", "Denies chest pain. Runs 5km three times weekly. No family history of heart disease."),
  mk("DEMO02", "Meera Iyer", { age: 41, sex: "F", systolic_bp: 118, cholesterol: 188, smoker: false, diabetic: false, bmi: 24.0, resting_hr: 68, chest_pain_type: 0, exercise_angina: false, st_elevation: false, t_inversion: false, lvh: false, rwma: 0, cardiac_enzymes_elevated: false, ca: 0, oldpeak: 0.0 }, 0.05, [], "low", "Denies chest pain. Routine check-up, normotensive."),
  mk("DEMO03", "Rohan Mehta", { age: 30, sex: "M", systolic_bp: 115, cholesterol: 180, smoker: false, diabetic: false, bmi: 22.5, resting_hr: 66, chest_pain_type: 0, exercise_angina: false, st_elevation: false, t_inversion: false, lvh: false, rwma: 0, cardiac_enzymes_elevated: false, ca: 0, oldpeak: 0.0 }, 0.05, [], "low", "Denies chest pain. Regular runner, healthy diet. No cardiovascular symptoms."),
  mk("DEMO04", "Sana Khan", { age: 61, sex: "F", systolic_bp: 150, cholesterol: 230, smoker: false, diabetic: false, bmi: 29.0, resting_hr: 78, chest_pain_type: 1, exercise_angina: false, st_elevation: false, t_inversion: false, lvh: false, rwma: 0, cardiac_enzymes_elevated: false, ca: 0, oldpeak: 0.4 }, 0.25, [], "moderate", "Occasional atypical chest discomfort, non-exertional. Prescribed low-dose amlodipine."),
  mk("DEMO05", "Arjun Nair", { age: 56, sex: "M", systolic_bp: 145, cholesterol: 230, smoker: false, diabetic: true, bmi: 28.0, resting_hr: 76, chest_pain_type: 1, exercise_angina: false, st_elevation: false, t_inversion: false, lvh: false, rwma: 0, cardiac_enzymes_elevated: false, ca: 0, oldpeak: 0.6 }, 0.25, [], "moderate", "Occasional atypical chest discomfort. Type 2 diabetes on metformin."),
  mk("DEMO06", "Lata Pillai", { age: 63, sex: "F", systolic_bp: 155, cholesterol: 230, smoker: false, diabetic: true, bmi: 29.5, resting_hr: 80, chest_pain_type: 1, exercise_angina: false, st_elevation: false, t_inversion: false, lvh: true, rwma: 0, cardiac_enzymes_elevated: false, ca: 0, oldpeak: 0.8 }, 0.25, [], "moderate", "Occasional atypical chest discomfort. Type 2 diabetes on metformin. Hypertensive with LVH, prescribed amlodipine."),
  mk("DEMO07", "Kabir Singh", { age: 54, sex: "M", systolic_bp: 148, cholesterol: 240, smoker: true, diabetic: false, bmi: 28.5, resting_hr: 78, chest_pain_type: 2, exercise_angina: false, st_elevation: false, t_inversion: true, lvh: false, rwma: 1, cardiac_enzymes_elevated: false, ca: 1, oldpeak: 1.8 }, 0.35, ["LAD"], "high", "Patient reports exertional chest tightness radiating to the left arm. Provoked by climbing stairs. Current smoker, approx 18 pack-years. T-wave inversions in V2-V4, mild anterior hypokinesia. Angiography: 70% LAD stenosis."),
  mk("DEMO08", "Priya Sharma", { age: 64, sex: "F", systolic_bp: 155, cholesterol: 250, smoker: true, diabetic: true, bmi: 30.0, resting_hr: 80, chest_pain_type: 2, exercise_angina: false, st_elevation: false, t_inversion: true, lvh: true, rwma: 1, cardiac_enzymes_elevated: false, ca: 1, oldpeak: 1.5 }, 0.35, ["RCA"], "high", "Patient reports exertional chest tightness radiating to the jaw. Provoked by exercise. Type 2 diabetes on metformin. Current smoker. Inferior T inversions, basal inferior hypokinesia. Angiography: 75% mid-RCA stenosis."),
  mk("DEMO09", "Vikram Rao", { age: 72, sex: "M", systolic_bp: 172, cholesterol: 275, smoker: true, diabetic: true, bmi: 32.0, resting_hr: 90, chest_pain_type: 3, exercise_angina: true, st_elevation: true, t_inversion: true, lvh: true, rwma: 2, cardiac_enzymes_elevated: false, ca: 3, oldpeak: 2.8 }, 0.85, ["LAD", "RCA", "LCx"], "critical", "Patient reports exertional chest tightness radiating to the left arm. Provoked by minimal exertion. Current smoker, approx 28 pack-years. Type 2 diabetes. Severe multivessel hypokinesia. Father had MI at age 51. Angiography: severe 3-vessel disease."),
  mk("DEMO10", "Dev Malhotra", { age: 78, sex: "M", systolic_bp: 180, cholesterol: 290, smoker: true, diabetic: true, bmi: 33.0, resting_hr: 94, chest_pain_type: 3, exercise_angina: true, st_elevation: true, t_inversion: true, lvh: true, rwma: 3, cardiac_enzymes_elevated: true, ca: 3, oldpeak: 3.4 }, 0.95, ["LM", "LAD", "RCA", "LCx"], "critical", "Patient reports severe exertional chest tightness radiating to the arm and jaw. Current smoker. Type 2 diabetes. Father had MI at age 48. Markedly elevated troponin, extensive anterior/lateral akinesia. Angiography: left main and multivessel disease."),
];

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
export const tierFor = (r: number): Tier => (r < 0.1 ? "low" : r < 0.25 ? "moderate" : r < 0.5 ? "high" : "very_high");

/** Territorial terms in the note -> per-vessel evidence weight (mirrors the backend notes service). */
const TERRITORY_TERMS: Record<VesselId, RegExp[]> = {
  LAD: [/\bLAD\b/i, /anterior/i, /septal/i, /left anterior descending/i],
  LCx: [/\bLCx\b/i, /\bLCX\b/, /lateral/i, /circumflex/i],
  RCA: [/\bRCA\b/i, /inferior/i, /right coronary/i],
  LM: [/left main/i, /\bLM\b/],
};
const PRIOR: Record<VesselId, number> = { LAD: 0.55, LCx: 0.36, RCA: 0.45, LM: 0.1 };

/** Offline per-artery stenosis model: logit(prior * fused risk) + note-territory shift, capped by overall risk. */
function mockVessels(f: Features, notes: string, risk: number, shap: Shap[]): VesselPrediction[] {
  const logit = (p: number) => Math.log(clamp(p, 1e-3, 1 - 1e-3) / (1 - clamp(p, 1e-3, 1 - 1e-3)));
  const caShift = 0.25 * ((f.ca ?? 0) - 1);
  return VESSEL_IDS.map((id) => {
    const hits = TERRITORY_TERMS[id].filter((re) => re.test(notes)).length;
    const noteShift = Math.min(2, hits * 1.0);
    const z = logit(risk * PRIOR[id] * (id === "LM" ? 1 : 1.6)) + noteShift + caShift * (id === "LM" ? 0.3 : 1);
    const p = Math.min(1 / (1 + Math.exp(-z)), Math.min(0.995, risk + 0.001));
    const pct = Math.round(clamp(p * 100, 0, 99));
    const meta = VESSEL_META[id];
    return {
      id, name: meta.name, territory: meta.territory, stenosis_prob: +p.toFixed(4), stenosis_pct: pct,
      status: pct >= 50 ? "critical" : pct >= 25 ? "mild" : "patent", ecg_leads: meta.leads,
      ffr_proxy: estimateFfr(pct), top_shap: shap[0] ?? null, derived: id === "LM",
    };
  });
}

export function mockPredict(req: PredictRequest): Prediction {
  const f = req.features;
  const terms: [string, number, number][] = [
    ["Age", f.age, 0.06 * (f.age - 55)],
    ["Male sex", f.sex === "M" ? 1 : 0, f.sex === "M" ? 0.5 : -0.2],
    ["Systolic BP", f.systolic_bp, 0.018 * (f.systolic_bp - 130)],
    ["Cholesterol", f.cholesterol, 0.006 * (f.cholesterol - 210)],
    ["Smoking", +f.smoker, f.smoker ? 0.8 : -0.1],
    ["Diabetes", +f.diabetic, f.diabetic ? 0.7 : -0.1],
    ["BMI", f.bmi, 0.03 * (f.bmi - 26)],
    ["Chest pain type", f.chest_pain_type, 0.35 * (f.chest_pain_type - 1)],
    ["Exercise angina", +f.exercise_angina, f.exercise_angina ? 0.7 : -0.1],
    ["ST elevation", f.st_elevation ? 1 : 0, f.st_elevation ? 0.85 : 0],
    ["T-wave inversion", f.t_inversion ? 1 : 0, f.t_inversion ? 0.45 : 0],
    ["LVH", f.lvh ? 1 : 0, f.lvh ? 0.4 : 0],
    ["RWMA score", f.rwma ?? 0, 0.4 * (f.rwma ?? 0)],
    ["Cardiac enzymes", f.cardiac_enzymes_elevated ? 1 : 0, f.cardiac_enzymes_elevated ? 1.0 : 0],
  ];
  const z0 = -2.1 + terms.reduce((s, t) => s + t[2], 0);
  const abn = req.ecg?.signal?.length ? clamp((f.chest_pain_type * 0.2 + (f.age - 30) / 120 + (f.smoker ? 0.1 : 0)), 0, 1) : 0;
  const zEcg = req.ecg ? 1.2 * (abn - 0.3) : 0;
  const flags = (req.notes?.match(/smoker|diabet|infarction|hypertens|exertional/gi) ?? []).length;
  const zNotes = req.notes ? 0.18 * Math.max(0, flags - 2) : 0;
  const risk = clamp(1 / (1 + Math.exp(-(z0 + zEcg + zNotes))), 0.005, 0.98);
  const tot = Math.abs(z0 + 2.2) + Math.abs(zEcg) + Math.abs(zNotes) || 1;
  const n = req.notes ?? "";
  const shap = terms.map(([feature, value, contribution]) => ({ feature, value, contribution })).sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  const vessels = mockVessels(f, n, risk, shap);
  const cad_status = Boolean(risk >= 0.50 || vessels.some((v) => v.id !== "LM" && v.stenosis_pct >= 50));

  return {
    cad_status,
    risk: +risk.toFixed(4), tier: tierFor(risk), confidence: 0.82, source: "mock",
    modality_contrib: { clinical: Math.abs(z0 + 2.2) / tot, ecg: Math.abs(zEcg) / tot, notes: Math.abs(zNotes) / tot },
    shap,
    vessels,
    ecg_findings: req.ecg ? {
      heart_rate: f.resting_hr, hrv_rmssd: +(20 + abn * 80).toFixed(1), qrs_ms: 92, st_deviation_mv: +(-abn * 0.18).toFixed(3),
      abnormality_score: +abn.toFixed(3), flags: abn > 0.5 ? ["ST depression"] : [], r_peaks: [],
    } : null,
    notes_entities: req.notes ? {
      symptoms: /chest/i.test(n) ? ["chest tightness"] : [], family_history: /father|mother/i.test(n) ? ["family history of MI"] : [],
      medications: ["metformin", "amlodipine"].filter((m) => n.toLowerCase().includes(m)),
      risk_flags: [/smoker/i.test(n) && "Current smoker", /diabet/i.test(n) && "Diabetes"].filter(Boolean) as string[], summary: n.slice(0, 120),
    } : null,
    rationale: `Estimated cardiovascular risk is ${(risk * 100).toFixed(0)}% (${tierFor(risk).replace("_", " ")}). CAD status: ${cad_status ? "POSITIVE" : "NEGATIVE"}. Main drivers: ${terms.slice().sort((a, b) => b[2] - a[2]).slice(0, 3).map((t) => t[0]).join(", ")}. Offline demo model. Decision-support only; not a medical diagnosis.`,
  };
}

export function mockSimulate(base: PredictRequest, overrides: Record<string, number | boolean>): Simulation {
  const baseline = mockPredict(base);
  const modified = mockPredict({ ...base, features: { ...base.features, ...overrides } as Features });
  const delta_vessels: Partial<Record<VesselId, number>> = {};
  for (const m of modified.vessels ?? []) {
    const b = baseline.vessels?.find((v) => v.id === m.id);
    if (b) delta_vessels[m.id] = +(m.stenosis_prob - b.stenosis_prob).toFixed(4);
  }
  return { baseline, modified, delta_risk: +(modified.risk - baseline.risk).toFixed(4), delta_vessels };
}
