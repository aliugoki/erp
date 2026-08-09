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


class InvoiceLineItem(BaseModel):
    description: str
    quantity: int
    unitPrice: float


class InvoiceExtractResponse(BaseModel):
    vendor: str | None = None
    date: str | None = None
    total: float | None = None
    taxAmount: float | None = None
    lineItems: list[InvoiceLineItem] = []


class IndexRequest(BaseModel):
    tenantId: str
    module: str
    refId: str
    content: str


class IndexResponse(BaseModel):
    indexed: bool
    refId: str


class SearchRequest(BaseModel):
    tenantId: str
    module: str
    query: str
    topK: int | None = None


class SearchHit(BaseModel):
    refId: str
    content: str
    score: float


class SearchResponse(BaseModel):
    query: str
    module: str
    hits: list[SearchHit]


# ── Restaurant AI (Phase 10) ─────────────────────────────────────────────────
class RestaurantDemandRequest(BaseModel):
    tenantId: str
    itemId: str
    horizon: int | None = None


class RestaurantDemandResponse(BaseModel):
    itemId: str
    horizon: int
    model: str
    historyPoints: int
    forecast: list[float]
    expectedTotal: float


class PrepTimeRequest(BaseModel):
    tenantId: str
    itemId: str


class PrepTimeResponse(BaseModel):
    item: str
    station: str | None = None
    source: str
    samples: int
    queueAhead: int
    baseSeconds: int
    etaSeconds: int
    etaMinutes: float


class UpsellRequest(BaseModel):
    tenantId: str
    basket: list[str]
    top: int | None = None


class UpsellItem(BaseModel):
    item: str
    confidence: float
    coOccurrences: int


class UpsellResponse(BaseModel):
    suggestions: list[UpsellItem]
