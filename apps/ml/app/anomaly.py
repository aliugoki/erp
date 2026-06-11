"""Transaction anomaly detection (Chunk 6.3).

`detect_anomalies` is a PURE function (no I/O): given transaction amounts (integer minor units) it
scores each with an **Isolation Forest** over the amounts and flags outliers, explaining each.

Design (per the gate "Isolation Forest over transaction amounts → [{score, isAnomaly, reason}]"):
- `score` is the Isolation Forest `decision_function` (lower = more anomalous) when there is enough
  data; otherwise a -|z| stand-in.
- `isAnomaly` is a ROBUST, deterministic rule — a modified z-score (median/MAD, Iglewicz-Hoaglin,
  |Mi| > 3.5), falling back to Tukey's IQR fences when MAD is zero. Robust statistics resist the
  "masking" effect where one big outlier inflates the mean/σ and hides itself, which a plain z-score
  (or the Isolation Forest contamination boundary on tiny samples) suffers from. The Isolation Forest
  still drives the magnitude score; the robust gate keeps the boolean stable and interpretable.
- `reason` is a plain-language z-score against the sample mean.

This flags statistical outliers in magnitude — the transactions a reviewer should look at first, not a
fraud verdict.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

MIN_SAMPLES = 8


@dataclass
class AnomalyVerdict:
    score: float  # lower = more anomalous
    is_anomaly: bool
    reason: str


def _reason(amount: float, z: float, mean: float) -> str:
    direction = "above" if z >= 0 else "below"
    return f"{abs(z):.1f}σ {direction} mean (amount {amount:.0f} vs mean {mean:.0f})"


def _robust_flags(arr: np.ndarray) -> np.ndarray:
    """Outlier mask via modified z-score (median/MAD); Tukey IQR fences when MAD is 0."""
    median = float(np.median(arr))
    mad = float(np.median(np.abs(arr - median)))
    if mad > 0:
        modified_z = 0.6745 * (arr - median) / mad
        return np.abs(modified_z) > 3.5
    q1, q3 = np.percentile(arr, [25, 75])
    iqr = float(q3 - q1)
    if iqr > 0:
        return (arr < q1 - 1.5 * iqr) | (arr > q3 + 1.5 * iqr)
    return np.zeros(arr.size, dtype=bool)


def detect_anomalies(amounts: list[float]) -> list[AnomalyVerdict]:
    arr = np.asarray([float(a) for a in amounts], dtype=float)
    n = arr.size
    if n == 0:
        return []

    mean = float(arr.mean())
    std = float(arr.std(ddof=0)) or 1.0
    zs = (arr - mean) / std
    flags = _robust_flags(arr)

    if n < MIN_SAMPLES:
        scores = -np.abs(zs)
    else:
        # Imported lazily so the small-sample path (and its unit tests) skips sklearn's import cost.
        from sklearn.ensemble import IsolationForest

        model = IsolationForest(random_state=42, contamination="auto", n_estimators=200)
        features = arr.reshape(-1, 1)
        model.fit(features)
        scores = model.decision_function(features)  # higher = more normal

    return [
        AnomalyVerdict(round(float(s), 4), bool(f), _reason(float(a), float(z), mean))
        for a, s, f, z in zip(arr, scores, flags, zs)
    ]
