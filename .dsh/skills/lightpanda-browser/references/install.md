# Install, verify, and troubleshoot Lightpanda

## Is it already installed?

```bash
lightpanda version
# 1.1.0-nightly.11012+f24eb6c7a
```

If that works, skip to the next section. Do **not** reinstall over a working
binary — nothing in this skill needs a specific version.

## Install

Pick one. `lightpanda` is a single static-ish binary, so there is nothing else
to install and no browser download step (unlike Puppeteer/Playwright).

```bash
# Linux / macOS, latest nightly
curl -fsSL https://pkg.lightpanda.io/install.sh | bash

# Linux/macOS, a specific release
curl -fsSL https://pkg.lightpanda.io/install.sh | bash -s "1.0.0"

# macOS / Linux via Homebrew
brew install lightpanda-io/browser/lightpanda

# Arch Linux (AUR)
yay -S lightpanda-bin          # or lightpanda-nightly-bin
```

The one-liner installs to `~/.local/bin/lightpanda` (override with
`LIGHTPANDA_DIR`) and needs `curl`, `jq` and `sha256sum`. If `lightpanda` is not
found afterwards:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

Docker and source builds exist but are unnecessary for agent use.

## Verify the install actually works

Do not trust `version` alone — verify a real render:

```bash
lightpanda fetch --dump markdown --strip-mode clutter --wait-ms 5000 \
  https://example.com
```

Expect a line of text about example domains plus a `Learn more` link. If you
get `# Navigation failed`, the binary works and the network is the problem
(proxy, DNS, TLS interception) — see below.

## Version pinning

`lightpanda version --check` reports whether a newer release exists. Nightly
builds change CLI flags occasionally; if a documented flag stops being accepted,
run `lightpanda help <command>` **first** — the built-in help is always the
authority for the binary you actually have:

```bash
lightpanda --help
lightpanda help fetch
lightpanda help serve
```

## Troubleshooting matrix

| Symptom | Cause | Fix |
|---|---|---|
| `# Navigation failed` + `Reason: CouldntResolveHost` | DNS failure | Check the hostname; if offline use a proxy |
| `Reason: CouldntConnect` | Refused/unreachable, or a local server not running | Start the server; verify it in the *same* shell |
| `Reason: SslConnectError` / TLS error | Corporate TLS interception or strict TLS to the target | `--ca-cert /path/ca.pem` (replaces the system trust store) |
| `Reason: OperationTimedout` | Slow page or a host that hangs | Raise `--wait-ms`, or drop `--wait-until done` for `networkidle`/`--wait-selector` |
| `Reason: UnsupportedProtocol` | Used a `file://` URL | Serve fixtures over HTTP |
| `fatal … err=SelectorNotFound` | `--dump-selector` matched nothing | Fix the selector; that is an exit-1 failure |
| Command exits 0 but content is an error page | HTTP 4xx/5xx without the flag | Add `--fail-on-http-error`, or check `http_status` with `--json` |
| Content is a spinner/skeleton | Page renders after `load` | `--wait-until networkidle` or `--wait-selector` |
| Output has invisible junk, or `--strip-mode invisible` does nothing | External stylesheets were not fetched | Add `--load-resources stylesheet` |
| `invalid user-agent … can't contain Mozilla` | Tried to impersonate Chrome | Not supported by design; use `--user-agent-suffix` |
| Everything is a challenge/"Just a moment" page | The site blocks non-browser clients | Expected. Use another data source, or a full browser |
| `Address already in use` on `serve` | Stale server on that port | Pick another port, or kill the old process |

## Proxy and TLS settings

```bash
--http-proxy http://127.0.0.1:3000
--http-proxy 'http://user:pass@127.0.0.1:3000'
--proxy-bearer-token TOKEN
--ca-cert /path/to/ca.pem          # replaces, not extends, the system trust store
--insecure-disable-tls-host-verification   # last resort; accepts MITM risk
```

All five commands (`fetch`, `serve`, `mcp`, `run`, `agent`) accept the same
common options.

## Telemetry

Lightpanda sends anonymous usage telemetry by default (it never includes URLs or
page content). Disable it if your environment requires:

```bash
export LIGHTPANDA_DISABLE_TELEMETRY=true
```

## Agent-relevant environment knobs

| Variable | Effect |
|---|---|
| `LIGHTPANDA_DISABLE_TELEMETRY` | Stop anonymous usage telemetry |
| `LIGHTPANDA_DIR` | Install directory for the one-liner installer |
| `LP_*` | Readable/writable from MCP tools (`getEnv`) and usable as `$LP_*` placeholders in PandaScript |
