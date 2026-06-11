"""Forecast orchestration (Chunk 6.2): fit-and-store (the scheduled/refresh path) and serve (fast from
the precomputed row, falling back to an on-demand fit only on a cache miss).
"""
from __future__ import annotations

import datetime as dt

from . import db
from .config import get_settings
from .forecasting import forecast_demand


def _future_dates(last: dt.date | None, horizon: int) -> list[str]:
    base = last or dt.date.today()
    return [(base + dt.timedelta(days=i)).isoformat() for i in range(1, horizon + 1)]


def _fit(tenant_id: str, product_id: str, warehouse_id: str, horizon: int) -> dict:
    """Fit from history and assemble the {dates,predicted,lower,upper,model,historyPoints} payload."""
    dates, values = db.fetch_demand_history(tenant_id, product_id, warehouse_id)
    result = forecast_demand(values, horizon, min_points=get_settings().forecast_min_points)
    return {
        "dates": _future_dates(dates[-1] if dates else None, horizon),
        "predicted": result.predicted,
        "lower": result.lower,
        "upper": result.upper,
        "model": result.model,
        "historyPoints": len(values),
    }


def _slice(forecast: dict, horizon: int) -> dict:
    keys = ("dates", "predicted", "lower", "upper")
    return {**forecast, **{k: list(forecast.get(k, []))[:horizon] for k in keys}}


def serve(tenant_id: str, product_id: str, warehouse_id: str, horizon: int) -> dict:
    """Serve a forecast — from the precomputed row when it covers the horizon, else fit on demand."""
    cached = db.get_forecast(tenant_id, product_id, warehouse_id)
    if cached and cached["horizon"] >= horizon and isinstance(cached.get("forecast"), dict):
        payload = _slice(cached["forecast"], horizon)
        payload["source"] = "cache"
        payload.setdefault("model", cached.get("model", "naive"))
        payload.setdefault("historyPoints", cached.get("history_points", 0))
        return payload
    payload = _fit(tenant_id, product_id, warehouse_id, horizon)
    payload["source"] = "on-demand"
    return payload


def refresh_all() -> int:
    """Refit every (tenant, product) with OUT demand and store the forecast (sentinel warehouse)."""
    horizon = get_settings().forecast_default_horizon
    count = 0
    for tenant_id, product_id in db.distinct_products():
        payload = _fit(tenant_id, product_id, db.SENTINEL_WAREHOUSE, horizon)
        db.upsert_forecast(
            tenant_id,
            product_id,
            db.SENTINEL_WAREHOUSE,
            horizon,
            payload["model"],
            payload["historyPoints"],
            {k: payload[k] for k in ("dates", "predicted", "lower", "upper")},
        )
        count += 1
    return count
