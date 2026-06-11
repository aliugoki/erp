"""Unit tests for the PURE anomaly detector (Chunk 6.3) — no DB. Verifies that clear magnitude
outliers are flagged while the bulk of a tight cluster is not, across both the Isolation Forest path
(n >= MIN_SAMPLES) and the z-score fallback (small n). The DB-backed endpoint + tenant scope are
covered by ml-anomaly-e2e.sh.
"""
from __future__ import annotations

from app.anomaly import detect_anomalies


def test_empty():
    assert detect_anomalies([]) == []


def test_isolation_forest_flags_large_outliers():
    # 15 tight-cluster amounts + 2 gross outliers.
    amounts = [1000 + (i % 5) * 10 for i in range(15)] + [5_000_000, 4_800_000]
    verdicts = detect_anomalies(amounts)
    assert len(verdicts) == 17
    # The two outliers (last two) must be flagged.
    assert verdicts[-1].is_anomaly
    assert verdicts[-2].is_anomaly
    # The cluster should be overwhelmingly normal.
    normal = sum(1 for v in verdicts[:15] if not v.is_anomaly)
    assert normal >= 13
    assert "above mean" in verdicts[-1].reason


def test_zscore_fallback_small_sample():
    verdicts = detect_anomalies([100, 100, 100, 9000])  # n < MIN_SAMPLES
    assert verdicts[-1].is_anomaly
    assert not verdicts[0].is_anomaly


def test_all_equal_no_anomalies():
    verdicts = detect_anomalies([500] * 12)
    assert all(not v.is_anomaly for v in verdicts)
