#!/usr/bin/env bash
# PostToolUse advisory typecheck for Write|Edit.
#
# Reads the hook JSON on STDIN, and only when a TypeScript file was touched, runs the workspace
# typecheck and surfaces a concise warning if it fails. ALWAYS exits 0 — this is advisory feedback,
# not a gate (the real gate is `pnpm -w typecheck` in the chunk's GATE step). Keeping it advisory and
# TS-scoped means it never blocks a completed edit or stalls on non-TS work.
set -uo pipefail

PAYLOAD="$(cat)"

FILE="$(python3 - "$PAYLOAD" <<'PY'
import json, sys
try:
    d = json.loads(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1] else {}
    print((d.get("tool_input", {}) or {}).get("file_path", "") or "")
except Exception:
    print("")
PY
)"

case "$FILE" in
  *.ts|*.tsx|*.mts|*.cts) ;;
  *) exit 0 ;;  # not a TypeScript file — nothing to typecheck
esac

cd "$(dirname "$0")/.." || exit 0

if ! out="$(pnpm -s -w typecheck 2>&1)"; then
  echo "⚠️  typecheck-on-edit: workspace typecheck is failing after editing ${FILE}:" >&2
  echo "$out" | tail -n 20 >&2
  echo "   (advisory — fix before the chunk GATE; not blocking this edit)" >&2
fi

exit 0
