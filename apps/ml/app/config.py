"""Typed settings for the ML service, validated once at startup (fail-fast, like the API kernel).

Mirrors the service-to-service auth contract defined by the NestJS API (ADR-006): the same
SERVICE_AUTH_SECRET, audience and issuer, so a token minted by the API verifies here.
"""
from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict

# Must match apps/api ServiceTokenService (SERVICE_AUDIENCE / SERVICE_ISSUER).
SERVICE_AUDIENCE = "internal"
SERVICE_ISSUER = "metaxperts-api"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    env: str = "development"
    ml_port: int = 8000
    log_level: str = "info"

    # Service auth — shared secret with the API. No default in production; a dev default keeps local
    # runs simple but is overridden by the real secret via env.
    service_auth_secret: str = "dev-service-secret-change-me"

    # OpenTelemetry — exporter endpoint (gRPC). When unset, tracing is a no-op.
    otel_exporter_otlp_endpoint: str | None = None
    otel_service_name: str = "metaxperts-ml"

    # Postgres — the ML service reads stock movements and writes forecasts as a trusted backend
    # (a privileged connection; tenant scoping is enforced by explicit tenant_id filters, since the
    # caller — the API bridge — is itself authenticated and passes the tenant). Falls back to
    # DATABASE_URL. Forecast features (6.2+) require it; the skeleton endpoints do not.
    ml_database_url: str | None = None
    database_url: str | None = None

    # Forecasting (6.2): minimum history points before ARIMA is attempted; default serve horizon.
    forecast_min_points: int = 8
    forecast_default_horizon: int = 14

    def effective_database_url(self) -> str | None:
        return self.ml_database_url or self.database_url


@lru_cache
def get_settings() -> Settings:
    return Settings()
