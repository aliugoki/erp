#!/usr/bin/env bash
# Semantic search + invoice OCR gate (Chunk 6.4): index documents into pgvector, verify ranked,
# tenant-scoped search, and extract fields from the sample invoice PDF. Service-auth throughout.
# Container runs with --network host to reach the host Postgres (pgvector). The embedding model is
# baked into the image, so no network is needed at runtime.
set -uo pipefail
cd "$(dirname "$0")/../../.." # repo root
set -a; . ./.env 2>/dev/null; set +a
SECRET="${SERVICE_AUTH_SECRET:-dev-service-secret-change-me}"; DBURL="${MIGRATION_DATABASE_URL}"
TA="cececece-cece-cece-cece-cececececece"; TB="dfdfdfdf-dfdf-dfdf-dfdf-dfdfdfdfdfdf"
A1="11111111-1111-1111-1111-111111110001"; A2="11111111-1111-1111-1111-111111110002"; A3="11111111-1111-1111-1111-111111110003"
B1="22222222-2222-2222-2222-222222220001"

pass=0; fail=0
check() { if [ "$2" = "$3" ]; then echo "  ✅ $1 ($2)"; pass=$((pass+1)); else echo "  ❌ $1: expected '$3' got '$2'"; fail=$((fail+1)); fi; }
jget() { python3 -c "import sys,json;print(json.load(sys.stdin).get(sys.argv[1],''))" "$1" 2>/dev/null; }
tophit() { python3 -c "import sys,json;h=json.load(sys.stdin)['hits'];print(h[0]['refId'] if h else '')" 2>/dev/null; }
hashit() { python3 -c "import sys,json;h=json.load(sys.stdin)['hits'];print('yes' if any(x['refId']==sys.argv[1] for x in h) else 'no')" "$1" 2>/dev/null; }

echo "== docker build (bakes embedding model + tesseract; this is the heavy one) =="
docker build -q -t metaxperts-ml apps/ml >/tmp/ml-search-build.out 2>&1 || { echo "  ❌ build failed"; tail -25 /tmp/ml-search-build.out; exit 1; }
echo "  ✅ image built"

psql "$DBURL" -q -c "DELETE FROM ml_embedding WHERE tenant_id IN ('$TA','$TB')" >/dev/null 2>&1

PORT=8055; for p in 8055 8056 8057 8058; do (exec 3<>/dev/tcp/127.0.0.1/$p) 2>/dev/null && exec 3>&- 3<&- || { PORT=$p; break; }; done
CID=$(docker run -d --rm --network host -e ML_PORT="$PORT" -e SERVICE_AUTH_SECRET="$SECRET" -e ML_DATABASE_URL="$DBURL" metaxperts-ml)
cleanup() { docker stop "$CID" >/dev/null 2>&1 || true; }
trap cleanup EXIT
B="http://127.0.0.1:$PORT"
for i in $(seq 1 50); do curl -fsS "$B/health" >/dev/null 2>&1 && break || sleep 0.4; done
TOK=$(cd apps/api && S="$SECRET" node -e "const j=require('jsonwebtoken');process.stdout.write(j.sign({svc:'api'},process.env.S,{audience:'internal',issuer:'metaxperts-api',expiresIn:'5m'}))")
sauth=(-H "x-service-token: $TOK" -H 'Content-Type: application/json')
idx() { curl -s -XPOST "$B/ml/search/index" "${sauth[@]}" -d "$1" >/dev/null; }

echo "== auth =="
check "search without token -> 401" "$(curl -s -o /dev/null -w '%{http_code}' -XPOST "$B/ml/search" -H 'Content-Type: application/json' -d "{\"tenantId\":\"$TA\",\"module\":\"docs\",\"query\":\"x\"}")" "401"
check "extract without token -> 401" "$(curl -s -o /dev/null -w '%{http_code}' -XPOST "$B/ml/extract/invoice" -F "file=@apps/ml/tests/fixtures/sample_invoice.pdf;type=application/pdf")" "401"

echo "== index documents (pgvector) =="
idx "{\"tenantId\":\"$TA\",\"module\":\"docs\",\"refId\":\"$A1\",\"content\":\"Annual financial audit and accounting reconciliation report for fiscal year 2025\"}"
idx "{\"tenantId\":\"$TA\",\"module\":\"docs\",\"refId\":\"$A2\",\"content\":\"Employee onboarding handbook, leave policy and HR benefits\"}"
idx "{\"tenantId\":\"$TA\",\"module\":\"docs\",\"refId\":\"$A3\",\"content\":\"Warehouse stock levels and product reorder thresholds\"}"
idx "{\"tenantId\":\"$TB\",\"module\":\"docs\",\"refId\":\"$B1\",\"content\":\"Marketing campaign performance metrics and ad spend\"}"
check "3 embeddings stored for tenant A" "$(psql "$DBURL" -tAc "SELECT count(*) FROM ml_embedding WHERE tenant_id='$TA'")" "3"

echo "== semantic ranking =="
R=$(curl -s -XPOST "$B/ml/search" "${sauth[@]}" -d "{\"tenantId\":\"$TA\",\"module\":\"docs\",\"query\":\"accounting and financial statements review\"}")
check "top hit is the financial-audit doc" "$(echo "$R" | tophit)" "$A1"
HR=$(curl -s -XPOST "$B/ml/search" "${sauth[@]}" -d "{\"tenantId\":\"$TA\",\"module\":\"docs\",\"query\":\"staff hiring and employee benefits\"}")
check "HR query ranks the onboarding doc top" "$(echo "$HR" | tophit)" "$A2"

echo "== tenant isolation =="
check "tenant A search never returns tenant B's doc" "$(echo "$R" | hashit "$B1")" "no"
BR=$(curl -s -XPOST "$B/ml/search" "${sauth[@]}" -d "{\"tenantId\":\"$TB\",\"module\":\"docs\",\"query\":\"financial audit\"}")
check "tenant B sees only its own (1) doc as top" "$(echo "$BR" | tophit)" "$B1"

echo "== invoice extraction (pdfplumber) =="
EX=$(curl -s -XPOST "$B/ml/extract/invoice" -H "x-service-token: $TOK" -F "file=@apps/ml/tests/fixtures/sample_invoice.pdf;type=application/pdf")
check "vendor extracted" "$(echo "$EX" | jget vendor)" "ACME SUPPLIES LTD"
check "date extracted" "$(echo "$EX" | jget date)" "2026-03-15"
check "total extracted (grand, not subtotal)" "$(echo "$EX" | jget total)" "4950.0"
check "tax extracted" "$(echo "$EX" | jget taxAmount)" "450.0"
check "2 line items" "$(echo "$EX" | python3 -c 'import sys,json;print(len(json.load(sys.stdin)["lineItems"]))' 2>/dev/null)" "2"

echo
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
