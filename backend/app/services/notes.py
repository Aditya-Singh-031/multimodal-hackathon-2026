"""Clinical notes -> structured entities. Gemini when available, deterministic regex fallback otherwise.

Besides symptoms / meds / risk flags, the extractor flags *territorial* terms (anterior, lateral, inferior, LAD, LCx,
RCA, left main, multivessel) that the note describes as affected, and converts them into proportional per-vessel
evidence weights consumed by fusion.py.
"""
from __future__ import annotations

import json
import re
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutTimeout

from ..config import settings
from ..schemas import NotesEntities

_SYMPTOMS = {"chest tightness": r"chest (tightness|pain|discomfort)", "dyspnea": r"short(ness)? of breath|dyspnea",
             "radiating pain": r"radiat", "exertional symptoms": r"exertion|stairs|exercise"}
_MEDS = ["metformin", "amlodipine", "atorvastatin", "aspirin", "lisinopril", "metoprolol"]

# canonical term -> (regex, {vessel: base weight}). Named arteries are strong evidence, wall terms weaker.
_TERRITORY: dict[str, tuple[str, dict[str, float]]] = {
    "LAD": (r"(?-i:\bLAD\b)|left anterior descending", {"LAD": 1.0}),
    "LCx": (r"(?-i:\bLC[Xx]\b)|circumflex", {"LCx": 1.0}),
    "RCA": (r"(?-i:\bRCA\b)|right coronary", {"RCA": 1.0}),
    "left main": (r"\bleft main\b|(?-i:\bLMCA\b|\bLM\b)", {"LM": 1.0, "LAD": 0.4, "LCx": 0.4}),
    "anterior": (r"\b(?:antero)?septal\b|\banterior\b|\banteroseptal\b", {"LAD": 0.6}),
    "lateral": (r"\b(?:postero)?lateral\b", {"LCx": 0.6}),
    "inferior": (r"\binferior\b", {"RCA": 0.6}),
    "3-vessel disease": (r"\b(?:3|three)[- ]vessel", {"LAD": 1.0, "LCx": 1.0, "RCA": 1.0}),
    "multivessel disease": (r"\bmulti[- ]?vessel", {"LAD": 0.6, "LCx": 0.6, "RCA": 0.6}),
}
_WALL_TERMS = {"anterior", "lateral", "inferior"}  # only count when the sentence describes pathology
_CUE = re.compile(r"ischemi|stenos|occlu|lesion|disease|infarct|\bST\b|t[- ]wave|elevation|depression|"
                  r"abnormal|changes|block|narrow|plaque|%|angiogra|\bMI\b", re.I)
_NEG_BEFORE = re.compile(r"\b(no|without|negative for|free of|normal|unremarkable|patent|clear|denies|rule[sd]? out)\b[^.;]{0,30}$", re.I)
_NEG_AFTER = re.compile(r"^[^.;]{0,25}\b(patent|normal|unremarkable|unobstructed|clear|no (significant )?stenosis)\b", re.I)
_PCT_BEFORE = re.compile(r"(\d{2,3})\s*%\s*(?:(?:ostial|proximal|mid|distal)[-\s])*$", re.I)
_MAX_WEIGHT = 2.0
_GEMINI_TERMS = {"lad": "LAD", "lcx": "LCx", "rca": "RCA", "anterior": "anterior", "septal": "anterior",
                 "lateral": "lateral", "inferior": "inferior", "left main": "left main", "lm": "left main"}


def _scan_territories(text: str, only: set[str] | None = None, trusted: bool = False) -> tuple[list[str], dict[str, float]]:
    """Find affected territorial terms. `trusted` (LLM-vetted terms) skips negation/pathology-cue heuristics."""
    found: list[str] = []
    weights: dict[str, float] = {}

    def add(term: str, factor: float) -> None:
        if term not in found:
            found.append(term)
        for vessel, w in _TERRITORY[term][1].items():
            weights[vessel] = min(_MAX_WEIGHT, weights.get(vessel, 0.0) + w * factor)

    for sentence in re.split(r"(?<=[.;!?])\s+|\n", text):
        for term, (rx, _) in _TERRITORY.items():
            if only is not None and term not in only:
                continue
            for m in re.finditer(rx, sentence, flags=re.I):
                if not trusted:
                    if _NEG_BEFORE.search(sentence[: m.start()]) or _NEG_AFTER.search(sentence[m.end():]):
                        continue
                    if term in _WALL_TERMS and not _CUE.search(sentence):
                        continue
                pct = _PCT_BEFORE.search(sentence[: m.start()])
                factor = 1.0
                if pct:  # quantified lesion: scale proportionally to severity (sub-threshold lesions count less)
                    p = min(99, int(pct.group(1)))
                    factor = 0.4 if p < 50 else 1.0 + (p - 50) / 50
                add(term, factor)
    if trusted and only:
        for term in only:  # LLM flagged a term the regexes could not locate: apply its base weight
            if term not in found and term in _TERRITORY:
                add(term, 1.0)
    return found, {k: round(v, 3) for k, v in weights.items()}


def _rule_based(text: str) -> NotesEntities:
    t = text.lower()
    neg_cp = "denies chest pain" in t
    symptoms = [k for k, rx in _SYMPTOMS.items() if re.search(rx, t) and not (neg_cp and k == "chest tightness")]
    fam = re.findall(r"(father|mother|brother|sister)[^.]*?(infarction|heart|stroke|cardiac)[^.]*", t)
    family = [f"{a} - {b}" for a, b in fam]
    meds = [m for m in _MEDS if m in t]
    flags = []
    if "smoker" in t and "former" not in t: flags.append("Current smoker")
    if "diabet" in t: flags.append("Diabetes")
    if family: flags.append("Premature family CVD history")
    if "hypertens" in t: flags.append("Hypertension")
    if "exertional" in " ".join(symptoms): flags.append("Exertional symptoms")
    terr, w = _scan_territories(text)
    return NotesEntities(symptoms=symptoms, family_history=family, medications=meds, risk_flags=flags,
                         summary=text[:160], territories=terr, vessel_weights=w)


def _gemini(text: str) -> NotesEntities:
    from google import genai

    client = genai.Client(api_key=settings.gemini_api_key)
    prompt = ("Extract from this clinical note JSON with keys symptoms[], family_history[], medications[], "
              "risk_flags[], territories[], summary (<=25 words). territories[] must contain ONLY terms from "
              "{anterior, septal, lateral, inferior, LAD, LCX, RCA, left main} that the note describes as AFFECTED "
              "(ischemia, stenosis, ST/T change); omit negated, patent or normal territories. Only JSON.\n\n" + text)
    r = client.models.generate_content(model=settings.gemini_model, contents=prompt,
                                       config={"response_mime_type": "application/json"})
    data = json.loads(r.text)
    raw_terms = data.pop("territories", None)
    ents = NotesEntities(**data)
    if isinstance(raw_terms, list):
        terms = {_GEMINI_TERMS[str(t).strip().lower()] for t in raw_terms if str(t).strip().lower() in _GEMINI_TERMS}
        ents.territories, ents.vessel_weights = _scan_territories(text, only=terms, trusted=True) if terms else ([], {})
    else:  # model ignored the key -> deterministic extraction
        ents.territories, ents.vessel_weights = _scan_territories(text)
    return ents


def extract(text: str) -> tuple[NotesEntities, str]:
    """Returns (entities, source) where source is 'live' or 'mock'."""
    if settings.gemini_api_key and not settings.demo_mode:
        try:
            with ThreadPoolExecutor(max_workers=1) as ex:
                return ex.submit(_gemini, text).result(timeout=settings.llm_timeout_s), "live"
        except (FutTimeout, Exception):  # noqa: BLE001
            pass
    return _rule_based(text), "mock"
