#!/usr/bin/env bash
# PreToolUse secret-scan hook for Write|Edit.
#
# Claude Code passes the hook payload as JSON on STDIN (the doc's $CLAUDE_TOOL_FILE env is outdated).
# We extract the file path and the proposed content, scan for real-looking secrets, and BLOCK the
# write (exit 2) if any are found — printing the reason to stderr so the agent sees it.
#
# Conservative by design: matches concrete key formats and high-entropy secret assignments, and
# skips obvious placeholder/template files so it never blocks legitimate scaffolding.
set -euo pipefail

PAYLOAD="$(cat)"

python3 - "$PAYLOAD" <<'PY'
import json, re, sys

try:
    data = json.loads(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1] else {}
except Exception:
    # If we can't parse the payload, fail open (don't block) — the hook must never wedge the agent.
    sys.exit(0)

ti = data.get("tool_input", {}) or {}
path = ti.get("file_path", "") or ""

# Gather every chunk of proposed text (Write: content; Edit: new_string; MultiEdit: edits[].new_string).
chunks = []
for key in ("content", "new_string", "text"):
    v = ti.get(key)
    if isinstance(v, str):
        chunks.append(v)
for edit in ti.get("edits", []) or []:
    v = (edit or {}).get("new_string")
    if isinstance(v, str):
        chunks.append(v)
content = "\n".join(chunks)

if not content.strip():
    sys.exit(0)

# Skip template / example / lockfiles where placeholder "secrets" are expected and harmless.
low = path.lower()
if any(low.endswith(s) for s in (".example", ".sample", ".dist", ".lock", "lock.json", "lock.yaml")) \
   or "/.env.example" in low or low.endswith(".env.example"):
    sys.exit(0)

PLACEHOLDERS = ("replace_me", "changeme", "change_me", "your_", "yourkey", "example",
                "placeholder", "dummy", "xxxx", "<", "{{", "redacted", "test_", "sample",
                "fake", "todo", "n/a", "none")

def looks_placeholder(val: str) -> bool:
    v = val.strip().strip("'\"`").lower()
    if len(v) < 12:
        return True
    return any(p in v for p in PLACEHOLDERS)

findings = []

# 1. Concrete key formats (high confidence — flag regardless of placeholder heuristics).
HARD = [
    (r"-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----", "private key block"),
    (r"AKIA[0-9A-Z]{16}", "AWS access key id"),
    (r"AIza[0-9A-Za-z_\-]{35}", "Google API key"),
    (r"xox[baprs]-[0-9A-Za-z\-]{10,}", "Slack token"),
    (r"gh[pousr]_[0-9A-Za-z]{36,}", "GitHub token"),
    (r"sk-[0-9A-Za-z]{20,}", "OpenAI-style secret key"),
    (r"-----BEGIN CERTIFICATE-----", "embedded certificate"),
]
for pat, label in HARD:
    if re.search(pat, content):
        findings.append(label)

# 2. Generic secret assignments to a non-placeholder, high-entropy value.
ASSIGN = re.compile(
    r"""(?ix)
    (password|passwd|secret|api[_-]?key|access[_-]?key|secret[_-]?key|token|private[_-]?key|client[_-]?secret)
    \s*[:=]\s*
    (['"]?)([^\s'"#]{12,})\2
    """,
)
for m in ASSIGN.finditer(content):
    key, _q, val = m.group(1), m.group(2), m.group(3)
    if looks_placeholder(val):
        continue
    # crude entropy gate: needs a mix of character classes to look like a real secret
    classes = sum(bool(re.search(c, val)) for c in (r"[a-z]", r"[A-Z]", r"[0-9]", r"[^A-Za-z0-9]"))
    if classes >= 3 or len(val) >= 32:
        findings.append(f"hardcoded {key.lower()} value")

if findings:
    uniq = sorted(set(findings))
    sys.stderr.write(
        "BLOCKED by secret-scan hook: possible secret(s) in "
        + (path or "the write") + " -> " + ", ".join(uniq) + ".\n"
        "Use .env / a secrets manager and reference via config; put placeholders in .env.example.\n"
    )
    sys.exit(2)

sys.exit(0)
PY
