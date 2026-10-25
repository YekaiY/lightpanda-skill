# CDP mode: `lightpanda serve`

Use this only when you need a CDP client library or already have a
Puppeteer/Playwright suite. For an agent with just a shell, PandaScript is
simpler — see [pandascript.md](pandascript.md).

## Start the server

```bash
lightpanda serve --host 127.0.0.1 --port 9222
```

Readiness: poll the HTTP discovery endpoint, **not** the TCP port (TCP can accept
before CDP is ready). Startup is ~100 ms.

```bash
curl -sf http://127.0.0.1:9222/json/version
# {"Browser":"Lightpanda/1.0","Protocol-Version":"1.3","Lightpanda-Version":"…",
#  "webSocketDebuggerUrl":"ws://127.0.0.1:9222/"}
```

Use [scripts/run-with-lightpanda.sh](../scripts/run-with-lightpanda.sh), which
refuses to start on a busy port, polls readiness, traps EXIT/INT/TERM, escalates
SIGTERM→SIGKILL, and propagates the payload's exit code:

```bash
bash run-with-lightpanda.sh node my-script.mjs
```

Failure modes it catches: unknown flag → exit 1; invalid `--log-level`/`--locale`
→ exit 1; port taken → exit 1. **`--port 0` picks an ephemeral port that only
appears in the log** (`server running address=127.0.0.1:<port>`) — never assume
the requested port was used. SIGTERM/SIGINT exit 0 in 0.7–1.6 s. The readiness
line goes to **stderr** as logfmt, so do not parse `--log-format pretty`.

`GET /json/protocol` returns the authoritative 375 KB schema (21 domains) — the
best reference before hand-writing raw CDP.

## Connect

```js
// Puppeteer
const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:9222',   // no /devtools/browser/<id>
});
const context = browser.browserContexts()[0]; // NOT .contexts() (undefined here)
const page = await context.newPage();
```

```js
// Playwright
const browser = await chromium.connectOverCDP('ws://127.0.0.1:9222');
```

`ws://host:port` and `ws://host:port/` both work. A wrong path fails.
`localhost` requires `--advertise-host localhost`; `ws://[::1]:9222` fails.
A browser `Origin:` header is rejected with `403 Origin not allowed` unless you
pass `--remote-allow-origins`.

Verified recipes:
[scripts/cdp-puppeteer.mjs](../scripts/cdp-puppeteer.mjs),
[scripts/cdp-zero-dep.mjs](../scripts/cdp-zero-dep.mjs) (no npm at all).

## Architecture constraints — read before designing

| Constraint | Detail |
|---|---|
| **One page per instance** | A second `Target.createTarget` → `TargetAlreadyLoaded`; a second browser context → `Cannot have more than one browser context at a time`. No tabs, no contexts. |
| **Parallelism = CDP connections** | Isolation is real (separate pages/cookies/storage) but it comes from `--cdp-max-connections` (default 16), not tabs. |
| `/json/list` is always `[]`; `/json/new?url=…` is **404** | Create targets over CDP (`Target.createTarget`), not HTTP. |
| Screenshots are **text-only** | Real PNG, correct size (`viewport`/`deviceScaleFactor` honoured), but only text is painted: `<h1>`–`<h6>` sizes/bold/italic and inline `font-size` draw; `color`, `background-color`, `border`, `<img>` do **not**. `type: "jpeg"`/`"webp"` → unsupported format. |
| `page.pdf()` works | Valid `%PDF-1.4`, text extractable. |
| Layout is approximate | `getBoundingClientRect()` reported 1920px width at an 800px viewport; `scrollHeight` equals viewport height; a CSS `height` does not push siblings. **Do not trust geometry.** |

## CSS and computed styles

Author CSS from `<style>`/`<link>` **does not reach `getComputedStyle`** (only UA
defaults, inline `style=`, and JS-set styles). One important exception: a
`display:none` rule from a stylesheet **does** apply, so visibility checks work.

`serve` defaults to `--load-resources` **none** (like `fetch`; `mcp`/`agent`
default to `stylesheet`). This has a bigger effect than it sounds: **without it,
subresources are never even requested.** Verified:

```bash
# default: interception sees only one request
requests = 1  types = document
# with --load-resources image --load-resources stylesheet
requests = 2  types = document,image
```

So `<img>.naturalWidth` is `0×0`, iframes never load (`frames.length === 0`), and
Workers construct but never run, until you pass the matching `--load-resources`.
`--load-resources stylesheet` makes the sheet object appear in
`document.styleSheets` but does not change computed styles.

## API support matrix (puppeteer-core 25.16 / playwright-core 1.64)

**Works:** `connect`, `browserContexts`, `newPage`; `goto`
(load/domcontentloaded/networkidle0), `reload`, `goBack`, `goForward`,
`waitForNavigation`; `$`, `$$`, `$eval`, `$$eval`, `evaluate` (args, promises,
objects, `evaluateHandle`), `content`, `title`, `url`; `waitForSelector`
(visible/hidden), `waitForFunction` (raf + interval); `type`, `click` (in
viewport), `locator().click/fill`, `focus`, `keyboard.*`, `mouse.*`, `tap`,
`hover`, `select`; `screenshot` PNG (`fullPage`, `clip`, `omitBackground`,
`base64`, `path`), `setViewport`; `pdf`; cookies (`setCookie`/`cookies`/
`deleteCookie`), `localStorage`/`sessionStorage`; `emulateMediaType`,
`emulateTimezone`, `setGeolocation`, `setOfflineMode`, `setBypassCSP`,
`setUserAgent`, `setExtraHTTPHeaders`, `authenticate`; `createCDPSession`,
`addScriptTag`, `addStyleTag`, `exposeFunction`, `page.on('console')`,
`evaluateOnNewDocument`, `frames()`. Playwright passed 51/52 probes.

**Throws:**

| API | Error |
|---|---|
| `screenshot({type:'jpeg'\|'webp'})` | `unsupported screenshot format` (Puppeteer **and** Playwright) |
| `page.setContent()` | `Page.setDocumentContent wasn't found` (Playwright's `setContent` works) |
| `setJavaScriptEnabled(false)` | `Disabling script execution is not supported` |
| `page.metrics()` | `Performance.getMetrics wasn't found` |
| `browser.target()` | `Browser target is not found` |
| `browser.isConnected` / `browser.contexts` | not functions → use `browser.connected` / `browser.browserContexts()` |
| `click`/`hover`/`tap` on an off-viewport element | `Node is either not clickable or not an Element` |
| CDP `Network.emulateNetworkConditions`, `Network.setBlockedURLs` | `MissingField` → use CLI `--block-urls` |
| CDP `CSS.getComputedStyle*`, `DOMSnapshot.captureSnapshot`, `HeapProfiler`, `Profiler`, `Overlay`, `ServiceWorker`, `Animation`, `Media` | `'X' wasn't found` |

**Silently wrong — the dangerous class:**

- **No auto-scroll.** `page.click` fails below the fold, and
  `handle.scrollIntoView()` resolves but `scrollY` stays 0 (it maps to
  `DOM.scrollIntoViewIfNeeded`, accepted but ineffective). Reliable options:
  `page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))` then
  click, or `page.$eval(sel, el => el.click())`, or Playwright
  `locator.click({force: true})`.
- `waitForSelector({visible:true})` detects `display:none` and
  `visibility:hidden` but treats `opacity:0` and `pointer-events:none` as
  visible.
- Subresource interception is a **no-op** unless `--load-resources` requests the
  resource type — you will not see the request at all.

## Request interception

Interception **does** work when every request is resolved. The classic failure is
a handler that resolves only some requests: with `setRequestInterception(true)`,
the **document request is paused too**, so a handler that never calls
`continue()`/`abort()`/`respond()` for it hangs `goto` until the timeout
(observed ~30 s). Verified working pattern:

```js
await page.setRequestInterception(true);
page.on('request', (req) => {
  if (req.resourceType() === 'image') return req.abort();
  if (req.url().includes('/mock.json')) {
    return req.respond({ status: 200, contentType: 'application/json',
                         body: '{"injected":true}' });
  }
  return req.continue();          // ← must cover the document
});
```

Verified: `goto` completed in 811 ms and `fetch('/mock.json')` returned
`{"injected":true}`. `abort()` yields `net::ERR_FAILED`; `Network.enable` emits
`requestWillBeSent`/`responseReceived`/`loadingFinished`.

Raw `Fetch.enable` is the lower-level equivalent: it pauses **every** request, so
each `Fetch.requestPaused` must be answered with `Fetch.continueRequest` or
`Fetch.fulfillRequest` (base64 body) before anything proceeds.

## Options that matter

```bash
lightpanda serve --port 9222 \
  --load-resources stylesheet --load-resources image \   # default none; repeat per type
  --watchdog-ms 30000 \        # kills stalled page JS; the CDP call throws Execution was terminated
  --http-cache-dir .lp-cache \ # creates cache.db (+ -shm/-wal)
  --timezone Asia/Shanghai --locale zh-CN \
  --user-agent-suffix " (+mytool)" \
  --block-urls "*pixel.png*" \
  --cdp-max-connections 16 \
  --log-level info
```

Verified behaviours: `--timezone` changes `Intl`/`getTimezoneOffset`;
`--locale fr-FR` → `navigator.languages = ["fr-FR","fr","en"]`;
`--user-agent-suffix X` → `navigator.userAgent = "Lightpanda/1.0 X"`;
`--user-agent` replaces the UA but **rejects anything containing `Mozilla`**;
`--block-urls '*pixel.png*'` makes the `<img>` fire `onerror` with
`naturalWidth 0×0`; `--cookie` loads (visible via `document.cookie`) and
`--cookie-jar` writes when the last connection closes.

`--host 0.0.0.0` exposes the port; pair it with `--advertise-host` so
`/json/version` returns a connectable URL.

## Zero-dependency alternative

Node ≥22 ships `fetch` and `WebSocket`, which is enough. See
[scripts/cdp-zero-dep.mjs](../scripts/cdp-zero-dep.mjs): `Target.createTarget` →
`Target.attachToTarget {flatten:true}` → `Page.enable` → `Page.navigate` →
poll `document.readyState` → `Runtime.evaluate` → `Page.captureScreenshot`.

Two traps that cost real time:

- **`Page.navigate` resolves early** (~5 ms) — it does *not* mean loaded. Poll
  `document.readyState`.
- **Use a request id starting at 1.** A falsy `0` id gets dropped by a
  `m.id && pending.get(m.id)` guard and the promise hangs forever.

There is also a native `LP.*` CDP domain (`LP.version`, `LP.dump`,
`LP.getSemanticTree`, `LP.clickNode`, …), but its parameter schemas are not
published in `/json/protocol`, so guessing arguments fails. Prefer standard CDP.
