"""MetaXperts ERP — ML/AI service entrypoint (FastAPI).

Chunk 6.1: a reproducible, Dockerized service with structured logging, OpenTelemetry, and
service-to-service auth. `/health` is public (liveness); every functional endpoint requires the API's
signed service token (see app.auth). ML features (forecasting, anomaly detection, OCR, semantic
search) arrive in Chunks 6.2–6.4.
"""
from __future__ import annotations

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile

from . import __version__
from . import db, embedding, forecast_service, ocr, restaurant
from .anomaly import detect_anomalies
from .auth import require_service_token
from .config import get_settings
from .contracts import (
    AnomalyItem,
    AnomalyRequest,
    AnomalyResponse,
    ForecastRequest,
    ForecastResponse,
    HealthResponse,
    IndexRequest,
    IndexResponse,
    InvoiceExtractResponse,
    PrepTimeRequest,
    PrepTimeResponse,
    RestaurantDemandRequest,
    RestaurantDemandResponse,
    UpsellItem,
    UpsellRequest,
    UpsellResponse,
    InvoiceLineItem,
    PingResponse,
    RefreshResponse,
    SearchHit,
    SearchRequest,
    SearchResponse,
)
from .logging import configure_logging, get_logger

DEFAULT_TOP_K = 10


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

    @app.post("/ml/forecast/demand", response_model=ForecastResponse)
    def forecast_demand_endpoint(
        req: ForecastRequest, _claims: dict = Depends(require_service_token)
    ) -> ForecastResponse:
        horizon = req.horizon or settings.forecast_default_horizon
        warehouse = req.warehouseId or db.SENTINEL_WAREHOUSE
        result = forecast_service.serve(req.tenantId, req.productId, warehouse, horizon)
        log.info("ml_forecast_served", product=req.productId, source=result["source"], model=result["model"])
        return ForecastResponse(
            productId=req.productId,
            warehouseId=req.warehouseId,
            horizon=horizon,
            **result,
        )

    @app.post("/ml/forecast/refresh", response_model=RefreshResponse)
    def forecast_refresh(_claims: dict = Depends(require_service_token)) -> RefreshResponse:
        n = forecast_service.refresh_all()
        log.info("ml_forecast_refreshed", count=n)
        return RefreshResponse(refreshed=n)

    @app.post("/ml/anomaly/transactions", response_model=AnomalyResponse)
    def anomaly_transactions(
        req: AnomalyRequest, _claims: dict = Depends(require_service_token)
    ) -> AnomalyResponse:
        rows = db.fetch_transaction_amounts(req.tenantId, req.dateFrom, req.dateTo)
        verdicts = detect_anomalies([amount for _id, amount, _on in rows])
        items = [
            AnomalyItem(
                transactionId=tid,
                amountMinor=amount,
                occurredOn=occurred,
                score=v.score,
                isAnomaly=v.is_anomaly,
                reason=v.reason,
            )
            for (tid, amount, occurred), v in zip(rows, verdicts)
        ]
        anomalies = sum(1 for it in items if it.isAnomaly)
        log.info("ml_anomaly_scan", tenant=req.tenantId, count=len(items), anomalies=anomalies)
        return AnomalyResponse(count=len(items), anomalies=anomalies, items=items)

    @app.post("/ml/extract/invoice", response_model=InvoiceExtractResponse)
    async def extract_invoice(
        file: UploadFile = File(...), _claims: dict = Depends(require_service_token)
    ) -> InvoiceExtractResponse:
        data = await file.read()
        result = ocr.extract_invoice(data, file.content_type, file.filename)
        log.info("ml_invoice_extracted", vendor=result.vendor, items=len(result.lineItems))
        return InvoiceExtractResponse(
            vendor=result.vendor,
            date=result.date,
            total=result.total,
            taxAmount=result.taxAmount,
            lineItems=[InvoiceLineItem(**vars(li)) for li in result.lineItems],
        )

    @app.post("/ml/search/index", response_model=IndexResponse)
    def search_index(req: IndexRequest, _claims: dict = Depends(require_service_token)) -> IndexResponse:
        vec = embedding.to_pgvector(embedding.embed_one(req.content))
        db.upsert_embedding(req.tenantId, req.module, req.refId, req.content, vec)
        log.info("ml_indexed", tenant=req.tenantId, module=req.module, ref=req.refId)
        return IndexResponse(indexed=True, refId=req.refId)

    @app.post("/ml/search", response_model=SearchResponse)
    def search(req: SearchRequest, _claims: dict = Depends(require_service_token)) -> SearchResponse:
        k = req.topK or DEFAULT_TOP_K
        qvec = embedding.to_pgvector(embedding.embed_one(req.query))
        rows = db.search_embeddings(req.tenantId, req.module, qvec, k)
        log.info("ml_search", tenant=req.tenantId, module=req.module, hits=len(rows))
        return SearchResponse(
            query=req.query,
            module=req.module,
            hits=[SearchHit(refId=r, content=c, score=round(s, 4)) for r, c, s in rows],
        )

    # ── Restaurant AI (Phase 10) ─────────────────────────────────────────────
    @app.post("/ml/restaurant/demand", response_model=RestaurantDemandResponse)
    def restaurant_demand(
        req: RestaurantDemandRequest, _claims: dict = Depends(require_service_token)
    ) -> RestaurantDemandResponse:
        horizon = req.horizon or settings.forecast_default_horizon
        r = restaurant.demand_forecast(req.tenantId, req.itemId, horizon)
        log.info("ml_rest_demand", item=req.itemId, model=r["model"], points=r["historyPoints"])
        return RestaurantDemandResponse(itemId=req.itemId, **r)

    @app.post("/ml/restaurant/prep-time", response_model=PrepTimeResponse)
    def restaurant_prep_time(
        req: PrepTimeRequest, _claims: dict = Depends(require_service_token)
    ) -> PrepTimeResponse:
        try:
            r = restaurant.predict_prep_time(req.tenantId, req.itemId)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        log.info("ml_rest_prep", item=req.itemId, eta=r["etaSeconds"], queue=r["queueAhead"])
        return PrepTimeResponse(**r)

    @app.post("/ml/restaurant/upsell", response_model=UpsellResponse)
    def restaurant_upsell(
        req: UpsellRequest, _claims: dict = Depends(require_service_token)
    ) -> UpsellResponse:
        suggestions = restaurant.upsell(req.tenantId, req.basket, req.top or 3)
        log.info("ml_rest_upsell", basket=len(req.basket), suggestions=len(suggestions))
        return UpsellResponse(suggestions=[UpsellItem(**s) for s in suggestions])

    log.info("ml_started", version=__version__, env=settings.env)
    return app


app = create_app()


if __name__ == "__main__":  # pragma: no cover
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=get_settings().ml_port)
