"""Versioned request/response contracts (Pydantic). The TypeScript mirror the API bridge imports lives
in `packages/shared/src/ml.ts` — keep the two in sync. Feature payloads (forecast/anomaly/OCR/search)
are added in Chunks 6.2–6.4.
"""
from __future__ import annotations

from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str


class PingResponse(BaseModel):
    """Returned by the service-auth-protected /ml/ping — proves the API↔ML token path works."""

    pong: bool
    caller: str


class ForecastRequest(BaseModel):
    """The API bridge supplies the tenant (it is authenticated and tenant-scopes on its side)."""

    tenantId: str
    productId: str
    warehouseId: str | None = None
    horizon: int | None = None


class ForecastResponse(BaseModel):
    productId: str
    warehouseId: str | None = None
    horizon: int
    model: str
    source: str  # 'cache' (precomputed) or 'on-demand' (fitted now)
    historyPoints: int
    dates: list[str]
    predicted: list[float]
    lower: list[float]
    upper: list[float]


class RefreshResponse(BaseModel):
    refreshed: int


class AnomalyRequest(BaseModel):
    tenantId: str
    dateFrom: str | None = None
    dateTo: str | None = None


class AnomalyItem(BaseModel):
    transactionId: str
    amountMinor: int
    occurredOn: str
    score: float
    isAnomaly: bool
    reason: str


class AnomalyResponse(BaseModel):
    count: int
    anomalies: int
    items: list[AnomalyItem]
