#!/usr/bin/env bash
# Metrics + dashboards + alerts gate (Chunk 8.2). Verifies the API exposes Prometheus metrics, that
# Prometheus scrapes them, that the Grafana dashboard is provisioned, and that an alert FIRES in a
# forced failure (a DLQ entry). Requires the running demo API on :3300 + Prometheus + Grafana (infra).
# Standalone (NOT in the main e2e chain — it depends on Prometheus's static :3300 scrape target).
# Run: pnpm --filter @app/api test:metrics
set -uo pipefail
cd "$(dirname "$0")/../../.." # repo root
set -a; . ./.env; set +a
OWNER_URL="${MIGRATION_DATABASE_URL}"
B="http://localhost:3300"; PROM="http://localhost:9090"; GRAF="http://localhost:3003"

pass=0; fail=0
check() { if [ "$2" = "$3" ]; then echo "  ✅ $1 ($2)"; pass=$((pass+1)); else echo "  ❌ $1: expected '$3' got '$2'"; fail=$((fail+1)); fi; }
present() { [ "$(echo "$1" | grep -c "^$2")" -gt 0 ] && echo yes || echo no; }

echo "== /metrics exposes RED + USE metrics =="
M=$(curl -s "$B/metrics")
check "http_request_duration_ms" "$(present "$M" http_request_duration_ms)" "yes"
check "metaxperts_active_tenants" "$(present "$M" metaxperts_active_tenants)" "yes"
check "metaxperts_outbox_lag" "$(present "$M" metaxperts_outbox_lag)" "yes"
check "metaxperts_dlq_depth" "$(present "$M" metaxperts_dlq_depth)" "yes"
check "metaxperts_breaker_state" "$(present "$M" metaxperts_breaker_state)" "yes"
check "metaxperts_queue_depth" "$(present "$M" metaxperts_queue_depth)" "yes"

echo "== Prometheus scrapes the API =="
UP=""
for i in $(seq 1 20); do
  UP=$(curl -s "$PROM/api/v1/targets" | python3 -c "import sys,json
d=json.load(sys.stdin)['data']['activeTargets']
print(next((t['health'] for t in d if t['labels'].get('job')=='metaxperts-api'),''))" 2>/dev/null)
  [ "$UP" = "up" ] && break || sleep 3
done
check "metaxperts-api target is up" "$UP" "up"
check "custom metric queryable in Prometheus" "$(curl -s "$PROM/api/v1/query?query=metaxperts_active_tenants" | python3 -c "import sys,json;r=json.load(sys.stdin)['data']['result'];print('yes' if r and float(r[0]['value'][1])>=0 else 'no')" 2>/dev/null)" "yes"

echo "== Grafana dashboard provisioned (renders) =="
check "dashboard 'metaxperts-erp' present" "$(curl -s -u admin:admin "$GRAF/api/dashboards/uid/metaxperts-erp" | python3 -c "import sys,json;print(json.load(sys.stdin).get('dashboard',{}).get('title','MISSING'))" 2>/dev/null)" "MetaXperts ERP — Overview"
check "Prometheus datasource provisioned" "$(curl -s -u admin:admin "$GRAF/api/datasources/name/Prometheus" | python3 -c "import sys,json;print(json.load(sys.stdin).get('type','MISSING'))" 2>/dev/null)" "prometheus"

echo "== alert FIRES on a forced failure (DLQ not empty) =="
psql "$OWNER_URL" -q -c "INSERT INTO dlq_event (tenant_id, consumer, event_id, event_type, payload, original_event, reason, attempts)
  VALUES ('11111111-1111-1111-1111-111111111111','metrics-test', gen_random_uuid(), 'test.forced', '{}'::jsonb, '{}'::jsonb, 'forced for alert gate', 3)" >/dev/null
FIRING=""
for i in $(seq 1 25); do
  FIRING=$(curl -s "$PROM/api/v1/alerts" | python3 -c "import sys,json
a=json.load(sys.stdin)['data']['alerts']
print(next((x['state'] for x in a if x['labels'].get('alertname')=='DLQNotEmpty'),''))" 2>/dev/null)
  [ "$FIRING" = "firing" ] && break || sleep 3
done
check "DLQNotEmpty alert is firing" "$FIRING" "firing"
# cleanup the forced rows so the alert resolves and the demo is clean
psql "$OWNER_URL" -q -c "DELETE FROM dlq_event WHERE consumer='metrics-test'" >/dev/null

echo
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
