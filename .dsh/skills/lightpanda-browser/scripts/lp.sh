#!/usr/bin/env bash
# lp.sh — thin, opinionated wrapper around the Lightpanda CLI for AI agents.
#
# Why this exists: raw `lightpanda fetch` has four traps that silently produce
# wrong data (see references/fetch.md). This wrapper defaults each of them to
# the safe setting and makes failures abort loudly instead of returning noise.
#
#   lp.sh md   <url> [selector]   rendered, de-cluttered markdown for an LLM
#   lp.sh text <url> [selector]   plain text with junk stripped
#   lp.sh html <url> [selector]   post-JS HTML
#   lp.sh json <url> <schema>     structured extraction via PandaScript
#   lp.sh shot <url> <out.png>    PNG layout render
#   lp.sh run  <script.js>        run a PandaScript
#   lp.sh serve [port]            print the CDP endpoint, keep serving
#   lp.sh which                  which lightpanda binary/path is used
#
# Set LP_BIN to override the binary. Extra flags: put them in LP_ARGS.
# Exit codes: 0 ok, 1 navigation/dump failure, 22 HTTP >= 400 (with --strict).

set -uo pipefail

# --- locate the binary -------------------------------------------------------
LP_BIN="${LP_BIN:-$(command -v lightpanda || true)}"
if [ -z "$LP_BIN" ] || [ ! -x "$LP_BIN" ]; then
  echo "lp.sh: lightpanda not found. Install it, or set LP_BIN=/path/to/lightpanda" >&2
  echo "  curl -fsSL https://pkg.lightpanda.io/install.sh | sh   # see references/install.md" >&2
  exit 127
fi

# Traps this wrapper closes, and the default it forces:
#  1. External stylesheets are NOT fetched by fetch -> CSS-hidden junk leaks
#     into output and --strip-mode invisible becomes a no-op.
#     FIX: always pass --load-resources stylesheet.
#  2. HTTP 4xx/5xx exits 0 and the error page is returned as content.
#     FIX: --fail-on-http-error so a 404 aborts with exit 22.
#  3. A navigation failure prints a "# Navigation failed" page on STDOUT with
#     exit 1, which an agent can mistake for page content.
#     FIX: callers must test the exit code, and we re-emit the reason on stderr.
#  4. Default --wait-ms is 5000 and waits only for `load`, so SPA content that
#     renders after load is missing. FIX: wait for networkidle by default.
BASE_ARGS=(--load-resources stylesheet --fail-on-http-error)
WAIT_ARGS=(--wait-until networkidle --wait-ms "${LP_WAIT_MS:-10000}")

die() { echo "lp.sh: $*" >&2; exit 1; }

# Run fetch, and turn a stdout "Navigation failed" page into a real failure.
fetch_dump() {
  local dump="$1"; shift
  local out err code
  out="$(mktemp)"; err="$(mktemp)"
  # shellcheck disable=SC2086
  "$LP_BIN" fetch --dump "$dump" "${BASE_ARGS[@]}" "${WAIT_ARGS[@]}" ${LP_ARGS:-} "$@" \
    1>"$out" 2>"$err"
  code=$?
  if [ $code -ne 0 ]; then
    cat "$out"
    grep -qi "Navigation failed" "$out" && grep -i "Reason:" "$out" >&2
    tail -n 3 "$err" >&2
    rm -f "$out" "$err"; exit $code
  fi
  # Belt and braces: a failure page can appear with a 0 exit in edge cases.
  if head -c 200 "$out" | grep -qi "^# Navigation failed"; then
    grep -i "Reason:" "$out" >&2 || true
    rm -f "$out" "$err"; die "navigation failed"
  fi
  cat "$out"
  rm -f "$out" "$err"
}

cmd_md() {
  local url="$1"; local sel="${2:-}"
  if [ -n "$sel" ]; then
    fetch_dump markdown --strip-mode clutter --dump-selector "$sel" "$url"
  else
    fetch_dump markdown --strip-mode clutter "$url"
  fi
}

cmd_text() {
  local url="$1"; local sel="${2:-}"
  if [ -n "$sel" ]; then
    fetch_dump markdown --strip-mode clutter,ui --dump-selector "$sel" "$url"
  else
    fetch_dump markdown --strip-mode clutter,ui "$url"
  fi
}

cmd_html() {
  local url="$1"; local sel="${2:-}"
  if [ -n "$sel" ]; then
    fetch_dump html --strip-mode js,css --dump-selector "$sel" "$url"
  else
    fetch_dump html --strip-mode js,css "$url"
  fi
}

cmd_json() {
  local url="$1"; local schema="${2:-}"
  [ -n "$schema" ] || die "usage: lp.sh json <url> '<schema-json>'"
  local tmp script
  tmp="$(mktemp -d)"
  script="$tmp/x.js"
  # The schema is embedded as JSON so quoting survives the shell.
  cat >"$script" <<EOF
const page = new Page();
await page.goto($(printf '%s' "$url" | sed 's/.*/"&"/'), { waitUntil: "networkidle", timeout: 15000 });
return page.extract($schema);
EOF
  "$LP_BIN" run "$script" ${LP_ARGS:-}
  local code=$?
  rm -rf "$tmp"
  exit $code
}

cmd_shot() {
  local url="$1"; local outfile="${2:-shot.png}"
  local tmp script
  tmp="$(mktemp -d)"; script="$tmp/shot.js"
  cat >"$script" <<EOF
const page = new Page();
await page.goto($(printf '%s' "$url" | sed 's/.*/"&"/'), { waitUntil: "networkidle", timeout: 15000 });
return page.screenshot({ path: "$outfile" });
EOF
  "$LP_BIN" run "$script" ${LP_ARGS:-}
  local code=$?
  rm -rf "$tmp"
  exit $code
}

cmd_run() {
  local script="$1"
  [ -f "$script" ] || die "no such script: $script"
  "$LP_BIN" run "$script" ${LP_ARGS:-}
}

cmd_serve() {
  local port="${1:-9222}"
  # --load-resources stylesheet matters for the same reason as in fetch, but
  # `serve` feeds a CDP client, so the client decides what it needs; the default
  # here matches fetch so visibility checks behave the same way.
  echo "starting: $LP_BIN serve --host 127.0.0.1 --port $port" >&2
  exec "$LP_BIN" serve --host 127.0.0.1 --port "$port" \
    --load-resources stylesheet ${LP_ARGS:-}
}

cmd_which() {
  echo "$LP_BIN"
  "$LP_BIN" version
}

case "${1:-}" in
  md)    shift; [ $# -ge 1 ] || die "usage: lp.sh md <url> [selector]"; cmd_md "$@" ;;
  text)  shift; [ $# -ge 1 ] || die "usage: lp.sh text <url> [selector]"; cmd_text "$@" ;;
  html)  shift; [ $# -ge 1 ] || die "usage: lp.sh html <url> [selector]"; cmd_html "$@" ;;
  json)  shift; cmd_json "$@" ;;
  shot)  shift; [ $# -ge 1 ] || die "usage: lp.sh shot <url> [out.png]"; cmd_shot "$@" ;;
  run)   shift; [ $# -ge 1 ] || die "usage: lp.sh run <script.js>"; cmd_run "$@" ;;
  serve) shift; cmd_serve "$@" ;;
  which) cmd_which ;;
  ""|-h|--help|help)
    sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
    ;;
  *) die "unknown command: $1 (try: lp.sh --help)" ;;
esac
