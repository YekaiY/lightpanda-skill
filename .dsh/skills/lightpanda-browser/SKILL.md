---
name: lightpanda-browser
description: Use when an agent must read, scrape, or interact with a web page through the Lightpanda headless browser (commands `lightpanda fetch`, `run`, `serve`, `mcp`, `agent`), including JS-rendered pages, SPA/lazy content, login forms, paginated list→detail scraping, Puppeteer/Playwright/CDP automation, MCP tool integration, and diagnostics when a fetch returns empty, skeleton, junk, or error-page content.
---

# Lightpanda browser

A headless browser written from scratch in Zig for machines. It runs JavaScript
and renders the DOM but not pixels, so it is roughly 10× faster and lighter than
headless Chrome. One binary, no browser download.

**Why it matters for an agent:** `lightpanda run` executes a plain `.js` file with
real DOM primitives — no Node, no npm, no Puppeteer, no API key. For a shell-only
agent that is the most portable way to click, type, and paginate.

## Step 0 — confirm it exists

```bash
lightpanda version || echo "NOT INSTALLED"
```

If missing, install (see [references/install.md](references/install.md)):

```bash
curl -fsSL https://pkg.lightpanda.io/install.sh | bash
```

## Step 1 — pick the interface

| Need | Use | Load |
|---|---|---|
| Page text for an LLM | `lightpanda fetch` | [references/fetch.md](references/fetch.md) |
| Structured records / clicks / login | PandaScript via `lightpanda run` | [references/pandascript.md](references/pandascript.md) |
| Existing Puppeteer/Playwright code | `lightpanda serve` (CDP) | [references/cdp.md](references/cdp.md) |
| An MCP host (Claude Desktop, Cursor) | `lightpanda mcp` | [references/mcp.md](references/mcp.md) |
| Layout/screenshot check | PandaScript `screenshot` | [references/pandascript.md](references/pandascript.md) |

Decision rules and hard limits: [references/interfaces.md](references/interfaces.md).
Do **not** use Lightpanda for visual regression or pixel-accurate screenshots —
it renders text layout only.

## Step 2 — the default read that is correct

Most "the page looks empty" failures come from getting these flags wrong. Use
this exact form:

```bash
lightpanda fetch --dump markdown --strip-mode clutter \
  --load-resources stylesheet --wait-until networkidle --wait-ms 15000 \
  --json --fail-on-http-error "$URL"
```

Every flag is load-bearing:

| Flag | Without it |
|---|---|
| `--load-resources stylesheet` | CSS-hidden junk leaks in; `--strip-mode invisible` does nothing |
| `--wait-until networkidle` | `load` returns the SPA skeleton (`done` for heavy SPAs) |
| `--wait-ms 15000` | too small = **silent empty output, exit 0** |
| `--json` | no `http_status`, no `page_status` diagnostics |
| `--fail-on-http-error` | a 404 page is returned as content with exit 0 |

## Step 3 — read the failure, don't retry it

The five things that will silently give you wrong data:

1. **Exit code 0 is not success** — a 4xx/5xx body is returned as content, and a
   too-small `--wait-ms` yields *empty* content with `http_status: 0, error: null`.
   Assert that content is non-empty **and** `http_status < 400`.
2. **A navigation failure prints a fake page** (`# Navigation failed` +
   `Reason: …`) on **stdout** with exit 1. Gate on the exit code.
3. **`load` is a pre-render snapshot.** If the dump shows a spinner or
   "(empty until JS runs)", re-fetch with `--wait-until done`.
4. **`--strip-mode clutter` silently falls back** to the full dump when page
   chrome dominates the text (nav + cookie banner still present). Compare byte
   size with an unstripped dump if it matters.
5. **Every `page.extract` leaf is a string or `null`** — parse numbers yourself.

Full trap tables: [references/fetch.md](references/fetch.md) and
[references/pandascript.md](references/pandascript.md).

## Step 4 — write a script only when the page demands it

`fetch` cannot click or type. When the task needs interaction, write a
PandaScript and run it:

```bash
lightpanda run my-script.js          # or: cat my-script.js | lightpanda run -
```

Rules that decide success:

- **`return` your data**; that is the only machine-readable channel. `console.log`
  writes to stdout too and will corrupt a JSON pipeline — use `console.error`.
- `await page.goto(url, { waitUntil: "networkidle", timeout: 30000 })`. `goto` is
  the only async primitive; forgetting `await` breaks every later call.
- `extract` returns real values: `{ title: "h1" }` → `{title: "…"}`. Use
  `fields` for records. `["a","b"]` reads **only** `"a"`.
- `press("Enter")` binds "Enter" as a *selector* — use `press({ key: "Enter" })`.
- No `require`, `setTimeout`, `fetch`, or `document` in script scope.

Runnable templates in [scripts/](scripts/):
[scrape-list-to-detail.js](scripts/scrape-list-to-detail.js),
[form-submit.js](scripts/form-submit.js),
[login-lpenv.js](scripts/login-lpenv.js).

## Step 5 — when a CDP client is the right tool

```bash
lightpanda serve --host 127.0.0.1 --port 9222
```

Then connect with `browserWSEndpoint: "ws://127.0.0.1:9222"` (no
`/devtools/browser/<id>` path). Critical CDP limits: **one page per process**
(no tabs, no second context; parallelize with separate connections),
`/json/new` is 404, screenshots are text-only, and `page.click` fails on
off-screen elements (scroll first). See [references/cdp.md](references/cdp.md).

## Troubleshooting quick table

| Symptom | Fix |
|---|---|
| Empty output, exit 0 | `--wait-ms` too small — it is a deadline; raise it |
| Skeleton / spinner text | `--wait-until networkidle`, or `done` for SPAs |
| `# Navigation failed` on stdout | Exit code 1 — DNS/TLS/timeout; check `--http-proxy`, `--ca-cert` |
| Error page treated as content | `--fail-on-http-error`, or check `http_status` |
| Invisible junk in the dump | `--load-resources stylesheet` |
| `CouldntConnect` to a local server | Start server and fetch in the **same** shell (isolated netns) |
| `UnsupportedProtocol` | `file://` is unsupported — serve fixtures over HTTP |
| `invalid user-agent … can't contain Mozilla` | Use `--user-agent-suffix`; impersonation is refused |
| Data looks wrong but page is fine | Read `page_status` in `--json` (`missing_globals`, `skipped.*`) |

Full matrix including proxies, CA certs, and telemetry: [references/install.md](references/install.md).
