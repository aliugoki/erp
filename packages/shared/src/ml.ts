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

/** `POST /ml/forecast/demand` request. The API bridge fills `tenantId` from the authenticated user. */
export interface MlForecastRequest {
  tenantId: string;
  productId: string;
  warehouseId?: string | null;
  horizon?: number;
}

/** Precomputed (or on-demand) demand forecast. `source`: 'cache' = served from the read model. */
export interface MlForecastResponse {
  productId: string;
  warehouseId?: string | null;
  horizon: number;
  model: string;
  source: 'cache' | 'on-demand';
  historyPoints: number;
  dates: string[];
  predicted: number[];
  lower: number[];
  upper: number[];
}

/** `POST /ml/anomaly/transactions` — flag outlier finance transactions over a date range. */
export interface MlAnomalyRequest {
  tenantId: string;
  dateFrom?: string | null;
  dateTo?: string | null;
}

export interface MlAnomalyItem {
  transactionId: string;
  amountMinor: number;
  occurredOn: string;
  score: number;
  isAnomaly: boolean;
  reason: string;
}

export interface MlAnomalyResponse {
  count: number;
  anomalies: number;
  items: MlAnomalyItem[];
}

/** `POST /ml/extract/invoice` (multipart file) → extracted invoice fields. */
export interface MlInvoiceLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface MlInvoiceExtractResponse {
  vendor: string | null;
  date: string | null;
  total: number | null;
  taxAmount: number | null;
  lineItems: MlInvoiceLineItem[];
}

/** `POST /ml/search/index` — embed + store a document's text in the vector store. */
export interface MlIndexRequest {
  tenantId: string;
  module: string;
  refId: string;
  content: string;
}

/** `POST /ml/search` — semantic search over a tenant+module's embeddings (pgvector, top-k). */
export interface MlSearchRequest {
  tenantId: string;
  module: string;
  query: string;
  topK?: number;
}

export interface MlSearchHit {
  refId: string;
  content: string;
  score: number;
}

export interface MlSearchResponse {
  query: string;
  module: string;
  hits: MlSearchHit[];
}
