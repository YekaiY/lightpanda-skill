#!/usr/bin/env bash
# One-file bash recipe: start lightpanda serve, wait for readiness, run any Node script, always kill.
# Verified on Linux with lightpanda 1.1.0-nightly.11012 + Node v26.
# Save as run-with-lightpanda.sh and: bash run-with-lightpanda.sh node my-script.mjs
set -euo pipefail

PORT="${LPD_PORT:-9222}"
LOG="${LPD_LOG:-/tmp/lightpanda-serve.log}"

# 1. Refuse to start if the port is already taken (prevents "connected to the wrong thing")
if curl -sf -m 1 "http://127.0.0.1:${PORT}/json/version" >/dev/null 2>&1; then
  echo "ERROR: something already answers on :${PORT}" >&2; exit 1
fi

# 2. Start in the background, teeing the log
lightpanda serve --host 127.0.0.1 --port "${PORT}" >"$LOG" 2>&1 &
LPD_PID=$!

# 3. Always clean up, even on failure — SIGTERM exits 0, SIGKILL is the fallback
cleanup() {
  if kill -0 "$LPD_PID" 2>/dev/null; then
    kill -TERM "$LPD_PID" 2>/dev/null || true
    for _ in $(seq 1 50); do kill -0 "$LPD_PID" 2>/dev/null || break; sleep 0.1; done
    kill -KILL "$LPD_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

# 4. Poll the HTTP discovery endpoint (NOT the TCP port: TCP can accept before CDP is ready)
READY=0
for _ in $(seq 1 150); do            # 150 * 0.1s = 15s budget
  if ! kill -0 "$LPD_PID" 2>/dev/null; then
    echo "ERROR: lightpanda exited during startup. Log:" >&2; cat "$LOG" >&2; exit 1
  fi
  if curl -sf -m 1 "http://127.0.0.1:${PORT}/json/version" >/dev/null 2>&1; then READY=1; break; fi
  sleep 0.1
done
if [ "$READY" -ne 1 ]; then
  echo "ERROR: lightpanda not ready after 15s. Log:" >&2; cat "$LOG" >&2; exit 1
fi

echo "lightpanda ready on ws://127.0.0.1:${PORT} ($(curl -s "http://127.0.0.1:${PORT}/json/version" | head -c 120))" >&2

# 5. Run the payload; its exit code becomes ours
"$@"
