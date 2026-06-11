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


@lru_cache
def get_settings() -> Settings:
    return Settings()
