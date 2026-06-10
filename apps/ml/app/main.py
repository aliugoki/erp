"""MetaXperts ERP — ML/AI service entrypoint (FastAPI).

Skeleton only: a health endpoint and the app factory. Structured logging, OTel, service-to-service
auth, and the ML features (forecasting, anomaly detection, OCR, semantic search) arrive in Phase 6.
"""
from __future__ import annotations

from fastapi import FastAPI
from pydantic import BaseModel

from . import __version__


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str


def create_app() -> FastAPI:
    app = FastAPI(title="MetaXperts ML", version=__version__)

    @app.get("/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        return HealthResponse(status="ok", service="ml", version=__version__)

    return app


app = create_app()


if __name__ == "__main__":  # pragma: no cover
    import os

    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("ML_PORT", "8000")))
