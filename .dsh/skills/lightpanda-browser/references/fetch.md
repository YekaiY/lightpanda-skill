# `lightpanda fetch`: one-shot page retrieval

Renders JavaScript in a single process and writes the result to stdout. No
server, no CDP client, no npm. This is the first thing to reach for.

```bash
lightpanda fetch --dump markdown --strip-mode clutter https://example.com
```

## The default that is actually correct

```bash
lightpanda fetch --dump markdown --strip-mode clutter \
  --load-resources stylesheet --wait-until networkidle --wait-ms 15000 \
  --json --fail-on-http-error "$URL"
```

Each flag prevents a specific silent failure (traps below). For heavy SPAs
switch `--wait-until networkidle` → `done`.

## Dump formats

| `--dump` | Output | Use when |
|---|---|---|
| `markdown` | CommonMark, links absolutized, punctuation escaped | **Default for an LLM** |
| `html` | Serialized post-JS DOM | You need attributes markdown drops |
| `semantic_tree` | Accessibility tree JSON | Structured parsing with roles/names |
| `semantic_tree_text` | Indented AX tree | Debugging *why* a selector fails |
| `structured_data` | JSON-LD, OpenGraph, Twitter, meta, links | Publisher-declared facts |
| `png` / `pdf` | **Text layout** (base64 inside `content` with `--json`) | Spatial check only |

Measured on `example.com`: html 2374 B · markdown 1344 B · semantic_tree 3967 B
(17 nodes) · semantic_tree_text 1462 B · structured_data 187 B.

Notes:

- **`markdown` escapes punctuation** (`SECRET-CSS-HIDDEN` →
  `SECRET\-CSS\-HIDDEN`), so naive `grep` misses literals. Strip backslashes or
  match the escaped form.
- `semantic_tree` node fields are optional: `nodeId`, `backendDOMNodeId`,
  `nodeName`, `xpath`, `nodeType`, `children` always exist; `role`,
  `isInteractive`, `name`, `nodeValue`, `attributes` only where applicable.
  `nodeType`: 9 document / 1 element / 3 text.
- `semantic_tree_text` numbers are **nodeIds, not sequence numbers**.
- PNG is 1920 px wide, height varies with content.

For structured records, prefer a PandaScript `extract` over parsing HTML — see
[pandascript.md](pandascript.md).

## 20 traps that silently produce wrong data

| # | Trap | Symptom | Fix |
|---|---|---|---|
| 1 | No subresources loaded by default | CSS-hidden junk appears as content; `--strip-mode invisible` and `--with-frames` silently do nothing | `--load-resources stylesheet` (and `iframe` for frames). Costs +200–300 ms |
| 2 | 4xx/5xx exits **0** | Error page ingested as content | `--fail-on-http-error` → exit 22 |
| 3 | Nav failure prints a **fake page on stdout** | `# Navigation failed` in your corpus | Gate on exit code (1) |
| 4 | `--wait-until load` returns **skeletons** | Spinner/`(empty until JS runs)` text | `networkidle`, or `done` for SPAs |
| 5 | `--wait-ms` too small fails **silently** | Empty stdout, exit 0, `http_status:0, content:"", error:null` | Size it above worst-case TTFB; treat empty content as a timeout |
| 6 | `--wait-selector`/`--wait-script` **drop the `load` wait** | Skeleton returned despite a wait flag | Add explicit `--wait-until`, or gate on content not presence |
| 7 | `--wait-script` runs before body parse | Exit 1, `err=ScriptError`, empty stdout | Null-guard every element access |
| 8 | `--dump-selector` miss fails the **whole run** | 0-byte stdout, exit 1, `SelectorNotFound` | Use a selector you know exists |
| 9 | 404 with a body looks fine in `--json` | `error: null` while `http_status: 404` | Branch on `http_status`, never only on `error` |
| 10 | `clutter` silently falls back to the full dump | Nav + cookie banner still present, size equals plain dump | Compare size to an unstripped dump |
| 11 | `--strip-mode` is a no-op on structured dumps | `semantic_tree` byte-identical | Strip only `html`/`markdown`; prune trees yourself |
| 12 | `--dump-max-bytes` rejected on non-text dumps | `needs text dump … allowed="html, markdown"`; `-1` → range overflow; `0` → just `[truncated]` | Apply only to `html`/`markdown` |
| 13 | `--json` + `--metrics` = **invalid JSON** | `Extra data: line 2` | Never combine them |
| 14 | Cookie files fail **silently** | No cookies sent, no jar written, exit 0 | Check stderr; JSON cookies need `domain`+`path` |
| 15 | `--cookie-jar` dir must exist | `Cookie.saveToFile … FileNotFound`, jar absent, exit 0 | Pre-create the directory, use an absolute path |
| 16 | markdown escapes literals | `grep` returns 0 though text is there | Match `SECRET\-CSS\-HIDDEN` |
| 17 | No `--terminate-ms` on hostile pages | Page with `while(true)` hangs to the 30 s watchdog | `--terminate-ms` (31022 ms → 1870 ms measured) |
| 18 | `--block-urls` blocks are invisible | No warning; `page_status.blocked.*` stays 0 | Verify by effect on content, not counters |
| 19 | `--user-agent` with `Mozilla` is rejected | Exit 1, zero requests | `--user-agent-suffix` |
| 20 | `file://` unsupported | `Reason: UnsupportedProtocol` | Serve fixtures over HTTP |

## `--wait-until` measured behavior

Cost is the same on simple pages (546–904 ms), so choose by **correctness**.

On content rendered by `setTimeout` after load:

| `--wait-until` | render @300 ms | @600 ms | @1500 ms |
|---|---|---|---|
| `load` (default) | skeleton | skeleton | skeleton |
| `domcontentloaded` | skeleton | skeleton | skeleton |
| `networkalmostidle` | caught | skeleton | skeleton |
| `networkidle` | caught | skeleton* | caught |
| `done` | caught | caught | caught |

\* `networkidle`'s quiet window is ≈500–580 ms, so a 600 ms render slips past it.
Use `done` for SPAs; it keeps waiting through timers.

On pages with **continuous** background requests, `networkidle` and `done` both
run to the full `--wait-ms` — budget accordingly. `networkidle` degrades to a
snapshot rather than erroring, so it is a safe default.

`--wait-ms` is a **deadline, not a sleep** (default 5000). Its failure mode is
silent: a page slower than the budget yields 0 bytes and exit 0. Threshold
measured with a 2500 ms server delay: `--wait-ms 2400` → 0 B, `2500` → 49 B.

Precise alternative when you know a marker:

```bash
--wait-script 'document.querySelector("#app .content") && document.querySelector("#app .content").textContent.length > 40'
```

`--wait-selector`/`--wait-script` **replace** the default `load` wait with
`none` (measured: 2750 ms default vs 759 ms with a selector). So a selector that
already matches the pre-JS skeleton returns the skeleton — combine with an
explicit `--wait-until`, or gate on content.

## Cutting output size

```bash
--strip-mode css | js | ui | invisible | shell | clutter
```

Measured reduction on an HTML chrome fixture (1640 B baseline): `css` −6.5%,
`js` −8.5%, `ui` −15.2%, `invisible` −9.0%, `shell` −25.1%, `clutter` −34.1%,
all combined −57.9%. On a real IANA article markdown dump: 2549 B → 871 B with
`clutter` (−66%). Comma-separated values work like repeated flags.

`inside` caveats: `--strip-mode invisible` only strips content hidden by an
*external* stylesheet if `--load-resources stylesheet` is set (inline `<style>`
works without it); `clutter` is a heuristic that falls back to the full dump;
structured dumps ignore strip modes entirely.

Other controls: `--dump-selector "main, article"` (scopes to the first match),
`--dump-max-bytes N`, `--with-base`, `--with-frames` (HTML only — markdown is
unaffected), `--markdown-alternate` (uses the page's own `.md` alternate).

## Machine-readable output

```bash
lightpanda fetch --json --dump markdown --fail-on-http-error URL
```

```json
{
  "url": "https://example.com/",
  "http_status": 200,
  "headers": [{"name": "content-type", "value": "text/html; charset=utf-8"}],
  "dump": "markdown",
  "content": "…",
  "error": null,
  "bot_challenge": null,
  "page_status": {
    "js_errors": 0,
    "skipped":  {"iframe": 0, "worker": 0, "image": 68, "stylesheet": 4},
    "unsupported": {"webgl": 0, "canvas2d": 0},
    "failed":   {"script": 0, "fetch": 0, "xhr": 0},
    "blocked":  {"script": 0, "fetch": 0, "xhr": 0},
    "resource_challenge": null,
    "missing_globals": []
  }
}
```

`--json` is required for multiple URLs (they run **concurrently**: 3 × 2500 ms
pages finished in 3063 ms; one failure does not stop the others).

`error` values observed: `CouldntResolveHost`, `UnsupportedProtocol`,
`OperationTimedout`, `RobotsBlocked`, `Timeout`, `SelectorNotFound`.

### Diagnosing "is it me or the page?"

`page_status` tells you what the engine could not do — read it before concluding
a page is empty:

| Field | Meaning / action |
|---|---|
| `missing_globals` | Web APIs the page used that Lightpanda lacks → JS may misbehave; prefer a data endpoint |
| `failed.*`, `blocked.*` | Scripts/XHR failed → add `--load-resources`, or the page depends on it |
| `skipped.image`, `skipped.stylesheet` | Deliberately not requested → pass `--load-resources` |
| `unsupported.webgl/canvas2d` | Canvas content will be blank — unfixable |
| `js_errors` | Page exceptions; non-zero often explains a skeleton |
| `resource_challenge` | A subresource hit a bot gate |

Caveat: `page_status.blocked.*` counters did **not** increment for `--block-urls`
in testing, and no non-null `bot_challenge` was observed — treat those as
informational, not guarantees.

## Batching, caching, sessions

```bash
lightpanda fetch --json --dump markdown URL1 URL2 URL3
lightpanda fetch --dump markdown --http-cache-dir .lp-cache URL
```

`--http-cache-dir` creates a sqlite `cache.db`; it only reuses responses that
carry cache headers, and **top-level navigation always refetches**. Measured
gain with cacheable assets: IANA 2682 ms cold → ~1200 ms warm.

```bash
--cookie cookies.txt          # Netscape cookies.txt or CDP/Puppeteer JSON (auto-detected)
--cookie-jar jar.json         # persist cookies; dir must already exist
--http-header "Authorization: Bearer $TOKEN"
--locale en-GB                # navigator.language + Accept-Language
--timezone Europe/Paris
--obey-robots                 # off by default; blocked → exit 1 RobotsBlocked
```

JSON cookie entries need `domain` and `path` — a `{"url": …}` entry is silently
dropped with `MissingField`.

## Identity and bot walls

Default UA: `Lightpanda/1.0`, `Sec-Ch-Ua: "Lightpanda";v="1"`,
`Accept-Language: en-US,en;q=0.9`. It does not and will not impersonate Chrome:
`--user-agent` rejects any value containing `Mozilla` (exit 1, zero requests).

- Use `--user-agent-suffix " (+mytool)"` to identify yourself; add
  `--http-nav-delay 1000 --obey-robots` for polite crawling.
- UA-gated sites return a challenge page. That is a stable outcome, not a
  transient error — switch data source or use a full browser.
- The TLS fingerprint is distinctive (`tls.browserleaks.com` reports JA4
  `t13d1710h2_…`).

## Fault tolerance and control

```bash
--terminate-ms 8000        # hard abort of page+JS (--wait-ms only stops waiting)
--http-timeout 15000       # per-request transfer (default 15000)
--http-connect-timeout 8000
--watchdog-ms 30000        # kill JS that stalls the loop
--block-urls "*doubleclick*" --block-urls "*://*/*.png"
--block-private-networks   # refuse private IPs after DNS
--adblock-lists easylist.txt
--http-proxy http://127.0.0.1:3000
--inject-script "window.__t=1"        # runs before any page script
--inject-script-file setup.js
```

`--inject-script` genuinely runs first — a page's own inline script can see the
injected global. Combine with `--wait-script` to stub an API then gate on the
result.

## Exit-code matrix (measured, no pipe masking)

| Situation | Exit | stdout |
|---|---|---|
| success | 0 | dump |
| HTTP 403/404/500, no flag | **0** | **error page as content** |
| HTTP ≥400 + `--fail-on-http-error` | **22** | dump still written |
| navigation failure | **1** | `# Navigation failed` + `Reason: …` |
| `RobotsBlocked` | **1** | same |
| nav failure + `--fail-on-http-error` | **1** (nav wins) | same |
| `--wait-selector` timeout | **1** | dump still written |
| `--wait-script` throws | **1** | empty |
| `--dump-selector` miss | **1** | empty (0 B) |
| >1 URL without `--json` | **1** | empty |

## Environment gotcha

Each shell invocation may get its own network namespace, so a server started
detached in one call can be unreachable from the next (`CouldntConnect`). Start
a local fixture server and fetch it **in the same command**, or use a managed
background job.
