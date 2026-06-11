/**
 * Contracts for the API ↔ ML service (apps/ml). The NestJS ML bridge (Chunk 6.5) imports these; the
 * Python side mirrors them in `apps/ml/app/contracts.py` — keep the two in sync. Feature contracts
 * (forecast/anomaly/OCR/search) are added alongside Chunks 6.2–6.4.
 */

/** The signed `x-service-token` header the API attaches to every ML call (ADR-006). */
export const ML_SERVICE_TOKEN_HEADER = 'x-service-token';

export interface MlHealth {
  status: string;
  service: string;
  version: string;
}

/** Response of the service-auth-protected `GET /ml/ping`. */
export interface MlPingResponse {
  pong: boolean;
  caller: string;
}
