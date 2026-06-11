"""MetaXperts ERP — ML/AI service entrypoint (FastAPI).

Chunk 6.1: a reproducible, Dockerized service with structured logging, OpenTelemetry, and
service-to-service auth. `/health` is public (liveness); every functional endpoint requires the API's
signed service token (see app.auth). ML features (forecasting, anomaly detection, OCR, semantic
search) arrive in Chunks 6.2–6.4.
"""
from __future__ import annotations

from fastapi import Depends, FastAPI

from . import __version__
from .auth import require_service_token
from .config import get_settings
from .contracts import HealthResponse, PingResponse
from .logging import configure_logging, get_logger


def _init_tracing(app: FastAPI) -> None:
    """Best-effort OpenTelemetry: only when an OTLP endpoint is configured; never blocks startup."""
    settings = get_settings()
    if not settings.otel_exporter_otlp_endpoint:
        return
    try:
        from opentelemetry import trace
        from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor

        provider = TracerProvider(resource=Resource.create({"service.name": settings.otel_service_name}))
        provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint=settings.otel_exporter_otlp_endpoint)))
        trace.set_tracer_provider(provider)
        FastAPIInstrumentor.instrument_app(app)
        get_logger().info("otel_enabled", endpoint=settings.otel_exporter_otlp_endpoint)
    except Exception as exc:  # pragma: no cover - tracing must never break the service
        get_logger().warning("otel_init_failed", error=str(exc))


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level)
    log = get_logger()

    app = FastAPI(title="MetaXperts ML", version=__version__)
    _init_tracing(app)

    @app.get("/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        return HealthResponse(status="ok", service="ml", version=__version__)

    @app.get("/ml/ping", response_model=PingResponse)
    def ping(claims: dict = Depends(require_service_token)) -> PingResponse:
        caller = str(claims.get("svc", "unknown"))
        log.info("ml_ping", caller=caller)
        return PingResponse(pong=True, caller=caller)

    log.info("ml_started", version=__version__, env=settings.env)
    return app


app = create_app()


if __name__ == "__main__":  # pragma: no cover
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=get_settings().ml_port)
