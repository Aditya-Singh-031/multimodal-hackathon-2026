"""Fetch real datasets. Never fails hard: on network error we log and rely on synthetic data.

- UCI Heart Disease (Cleveland) -> data/raw/heart.csv
- PTB-XL: large (~3GB). We only fetch a handful of 100Hz records via PhysioNet if reachable.
"""
from __future__ import annotations

from pathlib import Path

import httpx
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw"
UCI = "https://archive.ics.uci.edu/ml/machine-learning-databases/heart-disease/processed.cleveland.data"
COLS = ["age", "sex", "cp", "trestbps", "chol", "fbs", "restecg", "thalach", "exang",
        "oldpeak", "slope", "ca", "thal", "num"]


def fetch_uci() -> None:
    RAW.mkdir(parents=True, exist_ok=True)
    try:
        r = httpx.get(UCI, timeout=20, follow_redirects=True)
        r.raise_for_status()
        (RAW / "cleveland.data").write_text(r.text)
        df = pd.read_csv(RAW / "cleveland.data", names=COLS, na_values="?")
        df["target"] = (df["num"] > 0).astype(int)
        df.to_csv(RAW / "heart.csv", index=False)
        print(f"UCI Cleveland: {len(df)} rows -> {RAW / 'heart.csv'}")
    except Exception as exc:  # noqa: BLE001
        print(f"[warn] UCI download failed ({exc}); continuing with synthetic data only.")


def fetch_ptbxl_samples(n: int = 6) -> None:
    base = "https://physionet.org/files/ptb-xl/1.0.3/records100/00000/"
    out = RAW / "ptbxl"
    out.mkdir(parents=True, exist_ok=True)
    try:
        for i in range(1, n + 1):
            for ext in ("dat", "hea"):
                name = f"{i:05d}_lr.{ext}"
                r = httpx.get(base + name, timeout=30, follow_redirects=True)
                r.raise_for_status()
                (out / name).write_bytes(r.content)
        print(f"PTB-XL: {n} sample records -> {out}")
    except Exception as exc:  # noqa: BLE001
        print(f"[warn] PTB-XL sample download failed ({exc}); synthetic ECGs will be used.")


if __name__ == "__main__":
    fetch_uci()
    fetch_ptbxl_samples()
