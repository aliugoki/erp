"""Demand forecasting (Chunk 6.2).

`forecast_demand` is a PURE function (no I/O) so it is trivially unit-testable: given a daily demand
history it returns `horizon` points of {predicted, lower, upper} plus the model used.

Accuracy assumptions (documented per the gate): the input is treated as an evenly-spaced daily demand
series (gaps zero-filled upstream). With enough history we fit a small ARIMA(1,1,1); on too-little
history or a fit failure we fall back to a naive forecast (recent mean + a ±1.96σ band). Demand is
non-negative, so predictions and the lower bound are clipped at 0. These are deliberately conservative
short-horizon estimates, not a tuned model — good enough to drive reorder hints, not financial planning.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

NAIVE = "naive"
ARIMA = "arima"


@dataclass
class ForecastResult:
    predicted: list[float]
    lower: list[float]
    upper: list[float]
    model: str


def _clip(values: np.ndarray) -> list[float]:
    return [round(float(max(0.0, v)), 2) for v in values]


def _naive(history: np.ndarray, horizon: int) -> ForecastResult:
    window = history[-7:] if history.size >= 7 else history
    mean = float(window.mean()) if window.size else 0.0
    std = float(window.std(ddof=0)) if window.size > 1 else max(1.0, mean * 0.25)
    band = 1.96 * std
    predicted = np.full(horizon, mean)
    return ForecastResult(
        predicted=_clip(predicted),
        lower=_clip(predicted - band),
        upper=_clip(predicted + band),
        model=NAIVE,
    )


def forecast_demand(history: list[float], horizon: int, min_points: int = 8) -> ForecastResult:
    """Forecast `horizon` future daily-demand points from `history`."""
    horizon = max(1, int(horizon))
    series = np.asarray([max(0.0, float(x)) for x in history], dtype=float)

    if series.size < min_points or float(series.std(ddof=0)) == 0.0:
        return _naive(series, horizon)

    try:
        # Imported lazily so the naive path (and unit tests of it) doesn't pay statsmodels' import cost.
        from statsmodels.tsa.arima.model import ARIMA as _ARIMA

        model = _ARIMA(series, order=(1, 1, 1)).fit(method_kwargs={"warn_convergence": False})
        fc = model.get_forecast(steps=horizon)
        mean = np.asarray(fc.predicted_mean, dtype=float)
        ci = np.asarray(fc.conf_int(alpha=0.05), dtype=float)
        lower = ci[:, 0]
        upper = ci[:, 1]
        if not (np.all(np.isfinite(mean)) and np.all(np.isfinite(lower)) and np.all(np.isfinite(upper))):
            return _naive(series, horizon)
        return ForecastResult(predicted=_clip(mean), lower=_clip(lower), upper=_clip(upper), model=ARIMA)
    except Exception:
        return _naive(series, horizon)
