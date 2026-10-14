# CardioFusion — Multimodal Cardiovascular Risk Visualization & 3D Digital Twin

**Multimodal AI Hackathon 2026 · Track A**  
*Lead Systems Architect & Principal AI Engineer*

> *"While statistical algorithms can generate risk percentages, raw numbers fail to give clinicians or patients an intuitive understanding of where and how pathology is developing inside the body."*

**CardioFusion** bridges raw statistical risk scores into spatial 3D coronary anatomy — showing clinicians and patients **WHERE** arterial stenosis forms and **HOW** downstream myocardial ischemia develops.

---

## Deliverables & Documentation Quicklinks
- **Deliverable 1**: Complete Source Code (Backend FastAPI + Frontend Next.js 16 WebGL).
- **Deliverable 2**: Trained Multi-Target Model Weights (`backend/models/tabular.joblib` committed and tracked in repository).
- **Deliverable 3**: Cross-Validation Evaluation Metrics (`docs/metrics.json` and `metrics.json`).
- **Deliverable 4**: Formal Project Technical Documentation (`docs/PROJECT_DOCUMENTATION.md` — 5 technical sections, $\le 6$ pages).
- **Deliverable 5**: Prominent Clinical Safety Disclaimer (in UI, 3D viewport, and documentation).

---

## Core Differentiators & UI Experience

### 1. Dual Persona Modes: Clinician vs. Patient Explainer
- **🩺 Clinician Mode (Default)**: Diagnostic & hemodynamic telemetry:
  - Fractional Flow Reserve (FFR) proxy & lumen area reduction (%)
  - Fluoroscopy diseased vessel count (`ca: 0–3`) & exercise ST depression (`oldpeak` mm)
  - 12-lead territorial lead corroboration (`V1–V4` anterior/LAD, `I, aVL, V5–V6` lateral/LCx, `II, III, aVF` inferior/RCA)
  - Multi-target SHAP log-odds feature attributions across CAD and individual coronary vessels.
- **🫀 Patient Explainer Mode**: Translates angiographic physics into plain, empathetic language:
  - **WHERE**: Identifies which heart artery is affected in everyday terms (*"Front Main Artery (LAD) — supplies the primary front pumping wall"*).
  - **HOW**: Explains the mechanical impact of plaque narrowing on oxygen delivery and physical symptoms (angina, fatigue).
  - **Actionable Recovery & Prevention Plan**: Dynamically linked to patient's modifiable drivers (smoking cessation, BP reduction towards 120 mmHg, dietary cholesterol, blood glucose control).

### 2. Interactive "WHERE & HOW Pathology Develops" Cascade
A 4-stage visual pathophysiological progression strip driven by multi-target ML predictions:
1. **Stage 1: Systemic Triggers** — Endothelial injury and lipid infiltration from smoking, hypertension, diabetes, and hyperlipidemia.
2. **Stage 2: Atherosclerotic Plaque & Pinching** — Localized atheroma narrowing the lumen at specific 3D coordinates.
3. **Stage 3: Hemodynamic Flow Drop** — Venturi jet acceleration through stenosis and downstream hyperemic flow reduction ($FFR \le 0.80$).
4. **Stage 4: Myocardial Ischemia & Wall Strain** — Dusky purple hypoxic territory, correlated ECG ST/T changes, and regional systolic hypokinesia.

---

## System Architecture

```
frontend (Next.js 16, Tailwind, Three.js / React Three Fiber, Framer Motion)
   │  Offline deterministic mock model if backend is unreachable
   └─── HTTP (REST) ───>  backend (FastAPI / Pydantic)
                             ├─ services/tabular.py      (4 Calibrated XGBoost + Platt Sigmoid + TreeSHAP)
                             ├─ services/vessel_labels.py (Angiographic prevalence multi-target priors)
                             ├─ services/ecg.py          (12-lead band-pass + territorial ST/T mapping)
                             ├─ services/notes.py        (Gemini structured extraction + territorial weights)
                             └─ services/fusion.py       (Logit-space late fusion + hemodynamic coupling)
data/ raw (UCI Cleveland, PTB-XL) + synthetic (cohort, 12-lead ECG waveforms, clinical notes)
models/ backend/models/tabular.joblib (Trained multi-target model weights tracked in Git)
```

---

## Section 1: Dataset Preprocessing & Target Leakage Prevention

### 1.1 Dataset Sources
- **Real UCI Cleveland Heart Disease Dataset ($N=303$)**: Gold-standard clinical benchmark containing non-invasive patient attributes, fluoroscopy diseased vessel count (`ca`: 0–3), exercise ST depression (`oldpeak`), and clinical coronary artery disease status (`target`: 0 vs 1–4).
- **Synthetic Multimodal Cohort ($N=1,500$)**: Generated using clinically calibrated Bayesian priors derived from AHA/ACC prevention guidelines, Framingham risk factors, and Duke Treadmill Score distributions.

### 1.2 Feature Engineering & Normalization
The primary tabular feature vector consists of 15 non-invasive clinical predictors:
- Demographic & Hemodynamic: `age`, `sex_m`, `systolic_bp`, `cholesterol`, `smoker`, `diabetic`, `bmi`, `resting_hr`, `chest_pain_type`, `exercise_angina`.
- Pre-catheterization ECG/Echo Biomarkers:
  - Left Ventricular Hypertrophy (`lvh`): Estes' ECG criteria.
  - Acute Ischemic Repolarization (`st_elevation`, `t_inversion`): 12-lead territorial ischemic signatures.
  - Echocardiographic Wall Motion (`rwma`): Regional Wall Motion Abnormality score ($0$: Normal to $4$: Dyskinesia).
  - Myocardial Necrosis Marker (`cardiac_enzymes_elevated`): High-sensitivity Troponin / CK-MB elevation.
- Monotonic Constraints: XGBoost `monotone_constraints` enforce non-negative gradients for all atherogenic risk factors.

### 1.3 Strict Target Leakage Prevention (Requirement 1d)
- **Module-Level Forbidden Set**:
  ```python
  FORBIDDEN_LEAKAGE_FEATURES = {
      "LAD", "LCX", "RCA", "LM", "Cath",
      "cad_status", "target", "lad_stenosis", "lcx_stenosis", "rca_stenosis",
  }
  assert FORBIDDEN_LEAKAGE_FEATURES.isdisjoint(FEATURES)
  ```
- **Multi-Point Runtime Enforcement**: Asserted in `app/services/tabular.py` and `scripts/train_tabular.py` prior to model fitting (`fit_targets`), cross-validation (`evaluate_cv`), and inference (`predict_targets`).
- **Narrative Cleaning**: Demo cohort patient notes (`demo_cohort.py` and `mock.ts`) strictly contain non-invasive clinical history, symptom timelines, and echocardiographic findings — catheterization and angiography labels are completely excluded.
- **Automated Test Guard**: `backend/tests/test_api.py::test_no_target_leakage_in_features` asserts that neither `ClinicalFeatures` schemas nor feature vectors contain any catheterization, vessel, or target strings.

---

## Section 2: Model Architecture & Multimodal Late-Fusion

### 2.1 Multi-Target Calibrated Classifiers
CardioFusion fits four independent tree ensembles using `xgboost.XGBClassifier`:
1. `cad_status`: Overall CAD ($\ge 50\%$ diameter stenosis in any major epicardial coronary artery).
2. `lad_stenosis`: Left Anterior Descending artery ($\ge 50\%$).
3. `lcx_stenosis`: Left Circumflex artery ($\ge 50\%$).
4. `rca_stenosis`: Right Coronary Artery ($\ge 50\%$).

Platt sigmoid calibration (`CalibratedClassifierCV(method="sigmoid", cv=3)`) guarantees continuous, strictly monotonic probability estimates, preventing step plateaus and yielding strong probability calibration ($\text{Brier} = 0.0775$).

### 2.2 Exact TreeSHAP Local & Global Feature Attribution
Direct `shap.TreeExplainer` evaluation computes exact Shapley values in log-odds space ($\phi_i(x)$). The UI displays both signed log-odds shifts and relative attribution percentages:
$$\text{Relative Contribution \%} = \frac{|\phi_i|}{\sum_{j=1}^{M} |\phi_j|} \times 100\%$$
accompanied by patient physiological measurements and clinical units ($172\text{ mmHg}$, $275\text{ mg/dL}$, $\text{Grade } 3/4\text{ RWMA}$).

### 2.3 Multimodal Late-Fusion Engine (`app/services/fusion.py`)
Evidence is fused in logit space across clinical tabular data, 12-lead ECG waveforms, and clinical notes:
$$z_{\text{patient}} = \text{logit}(p_{\text{tabular}}) + W_{\text{ECG}} \cdot (\text{abnormality} - 0.3) + W_{\text{note}} \cdot N_{\text{extra\_flags}} + W_{\text{coupling}} \cdot \Delta z_{\text{territorial}}$$
- **12-Lead ECG Territorial Mapping**: Precordial leads $V_1-V_4 \to \text{LAD}$; lateral leads $I, aVL, V_5, V_6 \to \text{LCx}$; inferior leads $II, III, aVF \to \text{RCA}$.
- **Left Main (`LM`) Derivation**: Derived from joint LAD/LCx involvement with negative offset prior ($LM_{\text{offset}} = -1.6$).
- **Law of Total Probability Cap**: $P(\text{vessel} \ge 50\%) \le \min\left(0.995, P(\text{Overall CAD})\right)$.

---

## Section 3: 3D Anatomical Pipeline & Shader Setup

1. **Mesh Normalization & Raycast Snapping (`anatomy.ts`)**:
   `heart.glb` bounding box is centered and scaled to uniform height 2.0. Coronary centerlines authored in cylindrical coordinates $[y, \text{azimuth}^\circ]$ snap to the outer myocardial surface via dynamic raycasting at load time.
2. **Frenet-Frame Gaussian Lumen Pinching (`vessels.tsx`)**:
   Coronary tubes are generated along continuous Frenet-Serret frames $(T, N, B)$. At stenosis $\ge 50\%$, the tube radius narrows at lesion coordinate $u_{\text{lesion}}$:
   $$r(u) = r_0 \left[1 - \exp\left(-\left(\frac{u - u_{\text{lesion}}}{0.055}\right)^2\right) \cdot (1 - \max(0.15, 1 - \text{stenosisFrac}))\right]$$
   encircled by a metallic torus **Plaque Cuff**.
3. **InstancedMesh Venturi Blood-Flow Particles**:
   Thousands of blood corpuscles dynamically accelerate through the stenosis throat according to $A_1 v_1 = A_2 v_2$ and decelerate into disordered turbulence downstream ($FFR \le 0.80$).
4. **Custom GLSL Shaders (`shaders.ts`)**:
   - **Fresnel X-Ray Transparency**: Injected into `MeshStandardMaterial` for translucent rim lighting, enabling clear visualization of posterior vessels and lumen geometry through cardiac chambers.
   - **Ischemic Perfusion Map**: Fragment shader computes shortest distance to diseased polylines and renders a dusky-purple ischemic footprint ($e^{-(d/r)^2}$) with out-of-phase hypoxic pulsation.
   - **Systolic Wall-Motion Attenuation (Regional Hypokinesia)**: Vertex shader modulates inward systolic contraction:
     $$\Delta \mathbf{v} = -\mathbf{n} \cdot \left[u_{\text{beat}} \cdot 0.045 \cdot (1 - 0.85 \cdot \text{ischemicHypokinesia})\right]$$
     accurately rendering regional hypokinesia and akinesia.

---

## Section 4: Usage Instructions & Reproducibility

### Prerequisites
- Python 3.11+
- Node.js 18.18+

### 1. Backend Setup
```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python scripts\train_tabular.py --source uci        # Train models & evaluate 5-fold CV
python scripts\make_synthetic.py                   # Calibrate 10-patient demo cohort
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### 2. Frontend Setup
```powershell
cd ..\frontend
npm install
npm run build                                      # Type-check verification (0 errors)
npm run dev                                        # Local server at http://localhost:3000
```

### 3. Automated Verification Suite
```powershell
.\backend\.venv\Scripts\python.exe -m pytest backend/tests -v -q
```
*Result: 9 passed, 0 failures (including target leakage verification and API contracts).*

---

## Section 5: Evaluation Results & Cross-Validation Benchmarks (Req 1d & 1e)

Evaluated via **5-fold Stratified Cross-Validation with 3 repeats** on the real UCI Cleveland Heart Disease dataset (out-of-fold predictions):

| Target Objective | Clinical Definition | Accuracy | Precision | Recall | F1-Score | ROC-AUC | PR-AUC | Brier Score | Zero Leakage Status |
|---|---|---|---|---|---|---|---|---|---|
| **cad_status** | Overall CAD ($\ge 50\%$ stenosis in $\ge 1$ vessel) | **88.8%** | **92.5%** | **82.3%** | **0.8705** | **0.9585** | **0.9613** | **0.0775** | ✓ Verified Excluded |
| **lad_stenosis** | Left Anterior Descending ($\ge 50\%$ stenosis) | **84.7%** | **73.6%** | **67.9%** | **0.7061** | **0.8733** | **0.6795** | **0.1164** | ✓ Verified Excluded |
| **rca_stenosis** | Right Coronary Artery ($\ge 50\%$ stenosis) | **79.9%** | **60.8%** | **49.6%** | **0.5459** | **0.8607** | **0.5710** | **0.1341** | ✓ Verified Excluded |
| **lcx_stenosis** | Left Circumflex Artery ($\ge 50\%$ stenosis) | **83.7%** | **47.2%** | **3.4%** | **0.0634** | **0.7264** | **0.3444** | **0.1246** | ✓ Verified Excluded |

*Detailed metrics recorded in [docs/metrics.json](docs/metrics.json).*

---

## Architectural Extensibility & Technical Considerations

### 1. Zero-Dedicated-GPU WebGL Efficiency (60 FPS on Integrated GPUs)
CardioFusion is engineered to sustain fluid 60 FPS rendering on standard integrated laptop graphics (e.g. Intel Iris Xe, AMD Radeon 680M, Apple Silicon) without demanding discrete GPU hardware:
- **Single-Draw-Call Instancing**: All 1,000+ coronary blood corpuscle particles are rendered in a single GPU draw call using `THREE.InstancedMesh` with typed transform buffers.
- **Memoized Frenet-Frame Geometries**: Tapered tube geometries with Gaussian lumen pinching (`createPinchedTubeGeometry`) are memoized via React `useMemo` keyed on discrete stenosis percentages, preventing geometry re-allocations during camera interaction.
- **Single-Pass GLSL Shader Hooks**: Ischemic perfusion mapping, hypoxic pulsation, and systolic wall-motion attenuation are injected directly into Three.js's standard PBR material via `MeshStandardMaterial.onBeforeCompile`, avoiding multi-pass post-processing overhead.
- **Adaptive Canvas Scaling**: `<Canvas>` configures `dpr={[1, 1.75]}` with `gl={{ powerPreference: "high-performance" }}`, preventing fill-rate bottlenecks on 4K / Retina screens.

### 2. Declarative Registry Extensibility
- **Adding Clinical Features**: Append the feature to `FEATURES` and `MONOTONE` in `backend/app/services/tabular.py`. The tabular trainer, validation schemas (`ClinicalFeatures`), and SHAP explainer automatically incorporate the predictor while maintaining monotonicity and target leakage assertions.
- **Adding Diagnostic Targets**: Define the target in `TARGETS` in `vessel_labels.py`. The multi-target pipeline automatically fits a dedicated calibrated XGBoost model, tracks 5-fold cross-validation metrics, and exposes independent TreeSHAP attributions.
- **Adding 3D Arterial Branches**: Add cylindrical spline coordinates to `BRANCHES` or `VESSEL_PATHS` in `anatomy.ts`. Centerlines automatically snap to the normalized myocardium via raycasting, inherit parent vessel hemodynamic telemetry, and render matching lumen pinches and ischemic perfusion glows.

### 3. Deterministic 1:1 Correspondence
- **Prediction to 3D Geometry**: `PredictResponse.vessels[]` maps 1:1 by artery ID (`LAD`, `LCx`, `RCA`, `LM`) to 3D tube geometry narrowing ($1 - \text{stenosisFrac}$), metallic `PlaqueCuff` torus markers ($\ge 50\%$), and Venturi blood particle velocity.
- **ECG Telemetry to 3D Spatial Locus**: Precordial leads $V_1-V_4$ link to LAD territorial perfusion, lateral leads $I, aVL, V_5, V_6$ to LCx, and inferior leads $II, III, aVF$ to RCA.
- **Zero Hallucination / No Mock Visual Disconnect**: In counterfactual simulation mode, shifting a patient's risk factor (e.g., systolic BP $172 \to 128\text{ mmHg}$) immediately recomputes calibrated probabilities, smoothly relaxes the physical 3D lumen pinch, restores blood particle velocity, and recedes ischemic territory discoloration in real time.

---

## Clinical Safety Disclaimer (Track A Requirement 5)

> ⚠️ **CLINICAL SAFETY DISCLAIMER**: Predictions and 3D visualizations are for clinical decision support and educational purposes only and are NOT a substitute for formal diagnostic imaging (such as coronary angiography or cardiac CT) or professional medical diagnosis.