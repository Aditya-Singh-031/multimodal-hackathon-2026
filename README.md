# CardioFusion — Multimodal Cardiovascular Risk Visualization & 3D Digital Twin

**Multimodal AI Hackathon 2026 · Track A**

> *"While statistical algorithms can generate risk percentages, raw numbers fail to give clinicians or patients an intuitive understanding of where and how pathology is developing inside the body."*

**CardioFusion** bridges raw statistical risk scores into spatial 3D coronary anatomy — showing clinicians and patients **WHERE** arterial stenosis forms and **HOW** downstream myocardial ischemia develops.

---

## Core Differentiators & UI Experience

### 1. Dual Persona Modes: Clinician vs. Patient Explainer
- **🩺 Clinician Mode (Default)**: Comprehensive diagnostic & hemodynamic telemetry:
  - Fractional Flow Reserve (FFR) proxy & lumen area reduction (%)
  - Fluoroscopy diseased vessel count (`ca: 0–3`) & exercise ST depression (`oldpeak` mm)
  - 12-lead territorial lead corroboration (`V1–V4` anterior/LAD, `I, aVL, V5–V6` lateral/LCx, `II, III, aVF` inferior/RCA)
  - Multi-target SHAP log-odds feature attributions across CAD and individual coronary vessels.
- **🫀 Patient Explainer Mode**: Translates complex angiographic physics into plain, empathetic language:
  - **WHERE**: Clearly identifies which heart artery is affected in everyday terms (e.g., *"Front Main Artery (LAD) — supplies the primary front pumping wall"*).
  - **HOW**: Explains the mechanical impact of plaque narrowing on oxygen delivery and physical symptoms (angina, fatigue when climbing stairs).
  - **Actionable Recovery & Prevention Plan**: Dynamically linked to the patient's modifiable drivers (smoking cessation, BP reduction towards 120 mmHg, dietary cholesterol, blood glucose control).

### 2. Interactive "WHERE & HOW Pathology Develops" Cascade
A 4-stage visual pathophysiological progression strip driven by multi-target ML predictions:
1. **Stage 1: Systemic Triggers** — Endothelial injury and lipid infiltration from smoking, hypertension, diabetes, and hyperlipidemia.
2. **Stage 2: Atherosclerotic Plaque & Pinching** — Localized atheroma narrowing the lumen at specific 3D coordinates.
3. **Stage 3: Hemodynamic Flow Drop** — Venturi jet acceleration through the stenosis and downstream hyperemic flow reduction ($FFR \le 0.80$).
4. **Stage 4: Myocardial Ischemia & Wall Strain** — Dusky purple hypoxic territory, correlated ECG ST/T changes, and regional systolic hypokinesia.
*Clicking any stage immediately activates targeted 3D shader emphasis (Plaque Cuff, Hemodynamic Particles, or Ischemic Perfusion Map).*

### 3. Multimodal Fusion Engine
CardioFusion fuses three distinct modalities in logit space:

| Modality | Source | Processing |
|---|---|---|
| Clinical data | Real UCI Cleveland (N=303) + 1,500 synthetic cohort | Multi-target XGBoost with Platt calibration (`cad_status`, `LAD`, `LCx`, `RCA`), TreeSHAP explainer |
| 12-Lead ECG signal | PTB-XL samples / synthetic | Band-pass filter, R-peak detection, HRV (RMSSD), QRS duration, territorial ST-deviation features |
| Clinical notes | Synthetic cath & clinical notes | Gemini structured entity extraction with deterministic regex fallback |

---

## Architecture
```
frontend (Next.js 16, Tailwind, Three.js / R3F, Framer Motion)
   │  Offline deterministic mock model if backend is unreachable
   └─── HTTP (REST) ───>  backend (FastAPI / Pydantic)
                             ├─ services/tabular.py      (XGBoost + Platt calibration + TreeSHAP)
                             ├─ services/vessel_labels.py (Prevalence-conditioned multi-target sampling)
                             ├─ services/ecg.py          (12-lead band-pass + ST/T territorial mapping)
                             ├─ services/notes.py        (Gemini structured extraction + territorial weights)
                             └─ services/fusion.py       (Logit-space multimodal fusion + hemodynamic coupling)
data/ raw (UCI Cleveland, PTB-XL) + synthetic (cohort, 12-lead ECG waveforms, clinical notes)
```

---

## Quickstart

### Prerequisites
- Python 3.11+
- Node.js 18+

### 1. Backend Setup
```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
.\.venv\Scripts\python scripts\download_data.py     # optional real data
.\.venv\Scripts\python scripts\make_synthetic.py    # builds demo cohort and calibrates 10 patients
.\.venv\Scripts\python -m uvicorn app.main:app --port 8000
```

### 2. Frontend Setup
```powershell
cd frontend
npm install
npm run dev        # Visit http://localhost:3000
```
*Optional root `.env`: `GEMINI_API_KEY=...` (enables live Gemini extraction; falls back gracefully to rule-based NLP if omitted or timed out).*

---

## Model Benchmarks & Metrics (Track A Req 1d & 1e)

Evaluated via **5-fold Stratified Cross-Validation with 3 repeats** on the real UCI Cleveland Heart Disease dataset (out-of-fold predictions):

| Target Objective | Accuracy | Precision | Recall | F1-Score | ROC-AUC | PR-AUC | Brier Score | Zero Leakage Status |
|---|---|---|---|---|---|---|---|---|
| **cad_status (Overall CAD)** | **88.8%** | **92.5%** | **82.3%** | **0.8705** | **0.9585** | **0.9613** | **0.0775** | ✓ Verified Excluded |
| **lad_stenosis (LAD $\ge$ 50%)** | **84.7%** | **73.6%** | **67.9%** | **0.7061** | **0.8733** | **0.6795** | **0.1164** | ✓ Verified Excluded |
| **rca_stenosis (RCA $\ge$ 50%)** | **79.9%** | **60.8%** | **49.6%** | **0.5459** | **0.8607** | **0.5710** | **0.1341** | ✓ Verified Excluded |
| **lcx_stenosis (LCx $\ge$ 50%)** | **83.7%** | **47.2%** | **3.4%** | **0.0634** | **0.7264** | **0.3444** | **0.1246** | ✓ Verified Excluded |

*See full evaluation results in [docs/metrics.json](docs/metrics.json).*

### Strict Zero Target Leakage Prevention (Req 1d)
- **Code Enforcement**: `assert FORBIDDEN_LEAKAGE_FEATURES.isdisjoint(FEATURES)` is asserted at module load, prior to training, and before inference in `app/services/tabular.py` and `scripts/train_tabular.py`.
- **Forbidden Predictors**: `{"LAD", "LCX", "RCA", "LM", "Cath", "cad_status", "target", "lad_stenosis", "lcx_stenosis", "rca_stenosis"}` are strictly prohibited from model feature sets and input schemas.
- **Narrative Cleaning**: Demo cohort patient notes (`demo_cohort.py` and `mock.ts`) strictly contain non-invasive clinical history, symptom timelines, and echocardiographic findings — catheterization and angiography labels are completely excluded.
- **Automated Test Guard**: `backend/tests/test_api.py::test_no_target_leakage_in_features` validates that forbidden targets are excluded from schema fields and feature vectors.

---

## Verification & Testing
```powershell
# Run backend test suite (9 test cases, zero target leakage verification & API contracts)
.\backend\.venv\Scripts\python.exe -m pytest backend/tests -q

# Run frontend production build
cd frontend; npm run build
```

---

## Clinical Safety Disclaimer (Track A Requirement 5)

> ⚠️ **CLINICAL SAFETY DISCLAIMER**: Predictions and 3D visualizations are for clinical decision support and educational purposes only and are NOT a substitute for formal diagnostic imaging (such as coronary angiography or cardiac CT) or professional medical diagnosis.