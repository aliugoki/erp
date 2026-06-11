"""Unit tests for the PURE forecasting function (Chunk 6.2) — no DB. Verifies output shape, horizon
length, non-negativity, and that the band brackets the prediction. The DB-backed serve/refresh path
is covered by the docker e2e (ml-forecast-e2e.sh).
"""
from __future__ import annotations

from app.forecasting import ARIMA, NAIVE, forecast_demand


def _valid(result, horizon):
    assert len(result.predicted) == horizon
    assert len(result.lower) == horizon
    assert len(result.upper) == horizon
    for p, lo, hi in zip(result.predicted, result.lower, result.upper):
        assert lo <= p <= hi
        assert lo >= 0.0  # demand is non-negative


def test_short_history_uses_naive():
    result = forecast_demand([5, 7, 6], horizon=7)
    assert result.model == NAIVE
    _valid(result, 7)


def test_constant_history_uses_naive():
    result = forecast_demand([4] * 20, horizon=5)
    assert result.model == NAIVE
    _valid(result, 5)
    assert all(p == 4 for p in result.predicted)


def test_rich_history_attempts_arima():
    # A trend+noise series long enough to fit ARIMA; falls back to naive only if the fit fails.
    series = [float(10 + i + (i % 3)) for i in range(40)]
    result = forecast_demand(series, horizon=10)
    assert result.model in {ARIMA, NAIVE}
    _valid(result, 10)


def test_horizon_is_respected_and_min_one():
    assert len(forecast_demand([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], horizon=0).predicted) == 1
    assert len(forecast_demand([2, 4, 6, 8, 10, 12, 14, 16], horizon=20).predicted) == 20
