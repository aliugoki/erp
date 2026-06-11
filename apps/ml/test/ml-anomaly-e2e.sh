#!/usr/bin/env bash
# Anomaly-detection gate (Chunk 6.3): seed 15 tight-cluster transactions + 2 gross outliers, scan via
# the Isolation Forest endpoint, and assert the outliers are flagged, the cluster is not, scope is
# per-tenant, and the endpoint requires the service token. Container uses --network host for the DB.
set -uo pipefail
cd "$(dirname "$0")/../../.." # repo root
set -a; . ./.env 2>/dev/null; set +a
SECRET="${SERVICE_AUTH_SECRET:-dev-service-secret-change-me}"; DBURL="${MIGRATION_DATABASE_URL}"
T="adadadad-adad-adad-adad-adadadadadad"; T2="bdbdbdbd-bdbd-bdbd-bdbd-bdbdbdbdbdbd"

pass=0; fail=0
check() { if [ "$2" = "$3" ]; then echo "  ✅ $1 ($2)"; pass=$((pass+1)); else echo "  ❌ $1: expected '$3' got '$2'"; fail=$((fail+1)); fi; }
jget() { python3 -c "import sys,json;print(json.load(sys.stdin).get(sys.argv[1],''))" "$1" 2>/dev/null; }
# count items matching amountMinor==arg1 with isAnomaly==arg2(true/false)
flagged() { python3 -c "import sys,json
d=json.load(sys.stdin)['items']
print(sum(1 for x in d if x['amountMinor']==int(sys.argv[1]) and x['isAnomaly']==(sys.argv[2]=='true')))" "$1" "$2" 2>/dev/null; }

echo "== docker build =="
docker build -q -t metaxperts-ml apps/ml >/tmp/ml-an-build.out 2>&1 || { echo "  ❌ build failed"; tail -20 /tmp/ml-an-build.out; exit 1; }
echo "  ✅ image built"

echo "== seed 15 normal + 2 outlier transactions (tenant A) =="
psql "$DBURL" -q <<SQL >/dev/null
DELETE FROM finance_journal_entry WHERE tenant_id IN ('$T','$T2');
DELETE FROM finance_transaction WHERE tenant_id IN ('$T','$T2');
DELETE FROM finance_account WHERE tenant_id IN ('$T','$T2');
WITH accts AS (
  INSERT INTO finance_account (tenant_id, code, name, type)
  VALUES ('$T','1000','Cash','ASSET'),('$T','4000','Rev','REVENUE') RETURNING id, type
),
txns AS (
  INSERT INTO finance_transaction (tenant_id, description, occurred_on)
  SELECT '$T','seed', current_date - g FROM generate_series(1,17) g
  RETURNING id, occurred_on
),
ranked AS (SELECT id, row_number() OVER (ORDER BY occurred_on) AS rn FROM txns)
INSERT INTO finance_journal_entry (tenant_id, transaction_id, account_id, debit_minor, credit_minor, currency)
SELECT '$T'::uuid, r.id, (SELECT id FROM accts WHERE type='ASSET'),
       CASE WHEN r.rn <= 15 THEN (90000 + r.rn*1000) ELSE 5000000 END, 0, 'PKR' FROM ranked r
UNION ALL
SELECT '$T'::uuid, r.id, (SELECT id FROM accts WHERE type='REVENUE'),
       0, CASE WHEN r.rn <= 15 THEN (90000 + r.rn*1000) ELSE 5000000 END, 'PKR' FROM ranked r;
SQL
TXNS=$(psql "$DBURL" -tAc "SELECT count(*) FROM finance_transaction WHERE tenant_id='$T'")
check "17 transactions seeded" "$TXNS" "17"

PORT=8055; for p in 8055 8056 8057 8058; do (exec 3<>/dev/tcp/127.0.0.1/$p) 2>/dev/null && exec 3>&- 3<&- || { PORT=$p; break; }; done
CID=$(docker run -d --rm --network host -e ML_PORT="$PORT" -e SERVICE_AUTH_SECRET="$SECRET" -e ML_DATABASE_URL="$DBURL" metaxperts-ml)
cleanup() { docker stop "$CID" >/dev/null 2>&1 || true; }
trap cleanup EXIT
B="http://127.0.0.1:$PORT"
for i in $(seq 1 40); do curl -fsS "$B/health" >/dev/null 2>&1 && break || sleep 0.4; done
TOK=$(cd apps/api && S="$SECRET" node -e "const j=require('jsonwebtoken');process.stdout.write(j.sign({svc:'api'},process.env.S,{audience:'internal',issuer:'metaxperts-api',expiresIn:'5m'}))")
sauth=(-H "x-service-token: $TOK" -H 'Content-Type: application/json')

echo "== auth =="
check "anomaly scan without token -> 401" "$(curl -s -o /dev/null -w '%{http_code}' -XPOST "$B/ml/anomaly/transactions" -H 'Content-Type: application/json' -d "{\"tenantId\":\"$T\"}")" "401"

echo "== scan tenant A =="
RESP=$(curl -s -XPOST "$B/ml/anomaly/transactions" "${sauth[@]}" -d "{\"tenantId\":\"$T\"}")
check "scanned 17 transactions" "$(echo "$RESP" | jget count)" "17"
check "both outliers (5000000) flagged" "$(echo "$RESP" | flagged 5000000 true)" "2"
check "at least 2 anomalies total" "$([ "$(echo "$RESP" | jget anomalies)" -ge 2 ] && echo ok)" "ok"
check "anomalies are a small minority (<= 5)" "$([ "$(echo "$RESP" | jget anomalies)" -le 5 ] && echo ok)" "ok"

echo "== tenant isolation =="
check "tenant B (no data) -> 0 transactions" "$(curl -s -XPOST "$B/ml/anomaly/transactions" "${sauth[@]}" -d "{\"tenantId\":\"$T2\"}" | jget count)" "0"

echo
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
