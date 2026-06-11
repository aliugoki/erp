/**
 * OpenTelemetry bootstrap (Chunk 8.1). MUST be imported before anything else in main.ts so the
 * auto-instrumentations can patch http/express, pg, ioredis and **amqplib** as they load. The amqplib
 * instrumentation injects/extracts W3C trace context on publish/consume, so a single user action
 * yields ONE connected trace spanning api → broker → (in-process) consumers → ML. Flag-gated by
 * OTEL_ENABLED (off in tests/local-without-collector); exports OTLP/HTTP to the infra otel-collector.
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

let sdk: NodeSDK | undefined;

function start(): void {
  const enabled = process.env.OTEL_ENABLED === 'true' || process.env.OTEL_ENABLED === '1';
  if (enabled === false) return;

  const base = (process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318').replace(/\/$/, '');
  const url = base.endsWith('/v1/traces') ? base : `${base}/v1/traces`;

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? 'metaxperts-api',
    }),
    traceExporter: new OTLPTraceExporter({ url }),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false }, // too noisy
      }),
    ],
  });
  sdk.start();

  const stop = () => {
    void sdk?.shutdown().catch(() => undefined);
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}

start();
