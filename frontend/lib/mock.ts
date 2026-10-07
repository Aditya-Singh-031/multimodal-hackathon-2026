/** Offline fallback: deterministic patients + client-side risk model so the demo never fails. */
import type { Features, Patient, PredictRequest, Prediction, Simulation, Tier } from "./types";

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
  id, name, label: null, vessels, profile,
  request: { patient_id: id, features: f, ecg: { signal: ecg(f.resting_hr, abn), sampling_rate: FS }, notes },
});

export const MOCK_PATIENTS: Patient[] = [
  mk("DEMO01", "Asha Verma", { age: 34, sex: "F", systolic_bp: 112, cholesterol: 172, smoker: false, diabetic: false, bmi: 22.4, resting_hr: 64, chest_pain_type: 0, exercise_angina: false }, 0.05, [], "low", "Denies chest pain. Runs 5km three times weekly. No family history of heart disease."),
  mk("DEMO02", "Meera Iyer", { age: 41, sex: "F", systolic_bp: 118, cholesterol: 188, smoker: false, diabetic: false, bmi: 24.0, resting_hr: 68, chest_pain_type: 0, exercise_angina: false }, 0.05, [], "low", "Denies chest pain. Routine check-up, normotensive."),
  mk("DEMO03", "Rohan Mehta", { age: 30, sex: "M", systolic_bp: 115, cholesterol: 180, smoker: false, diabetic: false, bmi: 22.5, resting_hr: 66, chest_pain_type: 0, exercise_angina: false }, 0.05, [], "low", "Denies chest pain. Regular runner, healthy diet. No cardiovascular symptoms."),
  mk("DEMO04", "Sana Khan", { age: 61, sex: "F", systolic_bp: 150, cholesterol: 230, smoker: false, diabetic: false, bmi: 29.0, resting_hr: 78, chest_pain_type: 1, exercise_angina: false }, 0.25, [], "moderate", "Occasional atypical chest discomfort, non-exertional. Prescribed low-dose amlodipine."),
  mk("DEMO05", "Arjun Nair", { age: 56, sex: "M", systolic_bp: 145, cholesterol: 230, smoker: false, diabetic: true, bmi: 28.0, resting_hr: 76, chest_pain_type: 1, exercise_angina: false }, 0.25, [], "moderate", "Occasional atypical chest discomfort. Type 2 diabetes on metformin."),
  mk("DEMO06", "Lata Pillai", { age: 63, sex: "F", systolic_bp: 155, cholesterol: 230, smoker: false, diabetic: true, bmi: 29.5, resting_hr: 80, chest_pain_type: 1, exercise_angina: false }, 0.25, [], "moderate", "Occasional atypical chest discomfort. Type 2 diabetes on metformin. Hypertensive, prescribed amlodipine."),
  mk("DEMO07", "Kabir Singh", { age: 54, sex: "M", systolic_bp: 148, cholesterol: 240, smoker: true, diabetic: false, bmi: 28.5, resting_hr: 78, chest_pain_type: 2, exercise_angina: false }, 0.35, ["LAD"], "high", "Patient reports exertional chest tightness radiating to the left arm. Provoked by climbing stairs. Current smoker, approx 18 pack-years. Angiography: 70% LAD stenosis."),
  mk("DEMO08", "Priya Sharma", { age: 64, sex: "F", systolic_bp: 155, cholesterol: 250, smoker: true, diabetic: true, bmi: 30.0, resting_hr: 80, chest_pain_type: 2, exercise_angina: false }, 0.35, ["RCA"], "high", "Patient reports exertional chest tightness radiating to the jaw. Provoked by exercise. Type 2 diabetes on metformin. Current smoker. Angiography: 75% mid-RCA stenosis."),
  mk("DEMO09", "Vikram Rao", { age: 72, sex: "M", systolic_bp: 172, cholesterol: 275, smoker: true, diabetic: true, bmi: 32.0, resting_hr: 90, chest_pain_type: 3, exercise_angina: true }, 0.85, ["LAD", "RCA", "LCx"], "critical", "Patient reports exertional chest tightness radiating to the left arm. Provoked by minimal exertion. Current smoker, approx 28 pack-years. Type 2 diabetes. Father had MI at age 51. Angiography: severe 3-vessel disease."),
  mk("DEMO10", "Dev Malhotra", { age: 78, sex: "M", systolic_bp: 180, cholesterol: 290, smoker: true, diabetic: true, bmi: 33.0, resting_hr: 94, chest_pain_type: 3, exercise_angina: true }, 0.95, ["LM", "LAD", "RCA", "LCx"], "critical", "Patient reports severe exertional chest tightness radiating to the arm and jaw. Current smoker. Type 2 diabetes. Father had MI at age 48. Angiography: left main and multivessel disease."),
];

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
export const tierFor = (r: number): Tier => (r < 0.1 ? "low" : r < 0.25 ? "moderate" : r < 0.5 ? "high" : "very_high");

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
  ];
  const z0 = -2.1 + terms.reduce((s, t) => s + t[2], 0);
  const abn = req.ecg?.signal?.length ? clamp((f.chest_pain_type * 0.2 + (f.age - 30) / 120 + (f.smoker ? 0.1 : 0)), 0, 1) : 0;
  const zEcg = req.ecg ? 1.2 * (abn - 0.3) : 0;
  const flags = (req.notes?.match(/smoker|diabet|infarction|hypertens|exertional/gi) ?? []).length;
  const zNotes = req.notes ? 0.18 * Math.max(0, flags - 2) : 0;
  const risk = clamp(1 / (1 + Math.exp(-(z0 + zEcg + zNotes))), 0.005, 0.98);
  const tot = Math.abs(z0 + 2.2) + Math.abs(zEcg) + Math.abs(zNotes) || 1;
  const n = req.notes ?? "";
  return {
    risk: +risk.toFixed(4), tier: tierFor(risk), confidence: 0.82, source: "mock",
    modality_contrib: { clinical: Math.abs(z0 + 2.2) / tot, ecg: Math.abs(zEcg) / tot, notes: Math.abs(zNotes) / tot },
    shap: terms.map(([feature, value, contribution]) => ({ feature, value, contribution })).sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)),
    ecg_findings: req.ecg ? {
      heart_rate: f.resting_hr, hrv_rmssd: +(20 + abn * 80).toFixed(1), qrs_ms: 92, st_deviation_mv: +(-abn * 0.18).toFixed(3),
      abnormality_score: +abn.toFixed(3), flags: abn > 0.5 ? ["ST depression"] : [], r_peaks: [],
    } : null,
    notes_entities: req.notes ? {
      symptoms: /chest/i.test(n) ? ["chest tightness"] : [], family_history: /father|mother/i.test(n) ? ["family history of MI"] : [],
      medications: ["metformin", "amlodipine"].filter((m) => n.toLowerCase().includes(m)),
      risk_flags: [/smoker/i.test(n) && "Current smoker", /diabet/i.test(n) && "Diabetes"].filter(Boolean) as string[], summary: n.slice(0, 120),
    } : null,
    rationale: `Estimated cardiovascular risk is ${(risk * 100).toFixed(0)}% (${tierFor(risk).replace("_", " ")}). Main drivers: ${terms.slice().sort((a, b) => b[2] - a[2]).slice(0, 3).map((t) => t[0]).join(", ")}. Offline demo model. Decision-support only; not a medical diagnosis.`,
  };
}

export function mockSimulate(base: PredictRequest, overrides: Record<string, number | boolean>): Simulation {
  const baseline = mockPredict(base);
  const modified = mockPredict({ ...base, features: { ...base.features, ...overrides } as Features });
  return { baseline, modified, delta_risk: +(modified.risk - baseline.risk).toFixed(4) };
}
