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
