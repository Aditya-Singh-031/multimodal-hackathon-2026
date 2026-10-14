export type Tier = "low" | "moderate" | "high" | "very_high";

export interface Features {
  age: number;
  sex: "M" | "F";
  systolic_bp: number;
  cholesterol: number;
  smoker: boolean;
  diabetic: boolean;
  bmi: number;
  resting_hr: number;
  chest_pain_type: number;
  exercise_angina: boolean;
  /** ECG ST-segment elevation */
  st_elevation?: boolean;
  /** ECG T-wave inversion */
  t_inversion?: boolean;
  /** Left Ventricular Hypertrophy */
  lvh?: boolean;
  /** Regional Wall Motion Abnormality score, 0 to 4 */
  rwma?: number;
  /** Troponin / CK-MB cardiac enzymes elevation */
  cardiac_enzymes_elevated?: boolean;
  /** Number of major vessels (0–3) colored by fluoroscopy (UCI CAD feature) */
  ca?: number;
  /** ST depression induced by exercise relative to rest in mm (UCI CAD feature) */
  oldpeak?: number;
}
export interface PredictRequest {
  features: Features;
  ecg?: { signal: number[]; sampling_rate: number } | null;
  notes?: string | null;
  patient_id?: string | null;
}
export interface Patient {
  id: string;
  name: string;
  request: PredictRequest;
  features?: Features;
  label?: number | null;
  vessels?: string[];
  /** Optional quantified stenosis (%) per vessel, e.g. { LAD: 70 }. Overrides narrative parsing. */
  vessel_stenosis?: Partial<Record<VesselId, number>>;
  profile?: string;
}

export type VesselId = "LAD" | "LCx" | "RCA" | "LM";
export type VesselStatus = "patent" | "mild" | "critical";
export interface VesselAssessment {
  id: VesselId;
  name: string;
  territory: string;
  wall: string;
  leads: string[];
  /** Diameter stenosis, 0–99 %. */
  stenosis: number;
  status: VesselStatus;
  source: "angiography" | "clinical-note" | "model" | "ml-fusion";
  /** P(>=50% stenosis) from the multimodal fusion model (present when driven by /api/predict). */
  stenosisProb?: number;
  /** Strongest SHAP contributor for this artery's tabular model. */
  topShap?: Shap | null;
  /** True for left main, which is derived from LAD/LCx rather than trained directly. */
  derived?: boolean;
  /** Estimated fractional flow reserve proxy (0.2–1.0). */
  ffr: number;
  /** Estimated hyperemic flow reduction, %. */
  flowReduction: number;
  /** Cross-sectional lumen area reduction (Poiseuille proxy: 1 - (1-stenosis)^2), %. */
  lumenAreaReduction?: number;
  /** Whether FFR <= 0.80 indicating ischemia provocation. */
  isHemodynamicallySignificant?: boolean;
  /** Approximate share of LV myocardium supplied, %. */
  myocardiumAtRisk: number;
}
export interface Shap { feature: string; value: number; contribution: number }
/** Per-artery ML output returned by /api/predict (`vessels[]`); the single source the 3D heart renders from. */
export interface VesselPrediction {
  id: VesselId;
  name: string;
  territory: string;
  stenosis_prob: number;
  stenosis_pct: number;
  status: VesselStatus;
  ecg_leads: string[];
  ffr_proxy: number;
  top_shap?: Shap | null;
  derived?: boolean;
  evidence?: Record<string, number>;
}
export interface EcgFindings {
  heart_rate: number; hrv_rmssd: number; qrs_ms: number; st_deviation_mv: number;
  abnormality_score: number; flags: string[]; r_peaks: number[];
}
export interface NotesEntities {
  symptoms: string[]; family_history: string[]; medications: string[]; risk_flags: string[]; summary: string;
}
export interface Prediction {
  cad_status?: boolean;
  risk: number; tier: Tier; confidence: number;
  modality_contrib: Record<string, number>;
  shap: Shap[]; ecg_findings?: EcgFindings | null; notes_entities?: NotesEntities | null;
  rationale: string; source: "live" | "mock";
  vessels?: VesselPrediction[];
}
export interface Simulation {
  baseline: Prediction; modified: Prediction; delta_risk: number;
  /** Per-vessel change in stenosis probability (modified - baseline). */
  delta_vessels?: Partial<Record<VesselId, number>>;
}

export const TIER_COLOR: Record<Tier, string> = {
  low: "#34d399", moderate: "#fbbf24", high: "#fb923c", very_high: "#f43f5e",
};
export const TIER_LABEL: Record<Tier, string> = {
  low: "Low", moderate: "Moderate", high: "High", very_high: "Very high",
};
