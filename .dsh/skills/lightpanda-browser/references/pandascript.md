# PandaScript: the agent's automation path

A PandaScript is a plain `.js` file executed by the Lightpanda binary itself:

```bash
lightpanda run script.js          # from a file
cat script.js | lightpanda run -  # from stdin
```

No Node, no npm, no Puppeteer, no API key, no LLM. This is the best automation
path for an agent that only has a shell.

## Execution model

The script runs in its own V8 context that is **not** the page and **not** Node:

- No `window`, `document`, `localStorage` in script scope. Touch the page only
  via `page.*`.
- No `require`, `process`, `fs`, no npm. Also unavailable: `setTimeout`,
  `setInterval`, `fetch`, `URL`, `Buffer`, `TextEncoder`, `atob`, `btoa`,
  `structuredClone`, `queueMicrotask`.
- Available: `Page`, `console`, `JSON`, `Date`, `Math`, `RegExp`, `Promise`,
  `eval`, `globalThis`, and all standard array/string/`Map`/`Set` built-ins.
- `await page.goto(...)` is the **only** async primitive; every other `page.*`
  call is synchronous and blocking. Top-level `await` is allowed.
- `--` is not a valid argument separator. The `.js` extension is not required.

## Output contract

**The top-level `return` value is the output.**

| Script ends with | stdout |
|---|---|
| `return {…}` / `return […]` | JSON on one line |
| `return "text"` | the raw string, unquoted |
| `return 42` / `null` / `true` | `42` / `null` / `true` |
| **no `return`** | **nothing** (exit 0) |
| **bare trailing expression** | **nothing** — not printed |

`console.log(...)` writes to stdout and **will corrupt a JSON pipeline**; it also
prints objects as `[object Object]`. So:

> **`return` your data. `console.error` for debug output.**

`console.log/info/debug` → stdout; `console.warn/error` → stderr. Lightpanda's
own logs (`--log-level info/debug`) go to **stderr only**, so stderr is safe to
discard.

## Exit codes

| Situation | Exit | stderr |
|---|---|---|
| normal return, or no return | 0 | — |
| uncaught `throw` | **1** | `Error: boom` |
| syntax error | **1** | `Error: SyntaxError: …` |
| element missing (uncaught) | **1** | `Error: click failed: NodeNotFound` |
| every schema field misses | **1** | `Error: extract: no schema selector matched any element …` |
| navigation failed | **1** | `Error: navigation failed` |
| navigation timed out | **1** | `Error: navigation timed out` |
| error caught and script continues | 0 | your own `console.error` |

So an agent can gate on the exit code — but wrap optional steps in `try/catch`
if later steps should still run.

## Primitives

| Primitive | Signature | Returns / gotcha |
|---|---|---|
| `goto` | `await page.goto(url[, {timeout=10000, waitUntil="load"}])` | Same page object. **Must await** — an unawaited `goto` leaves the page not-navigated. A timeout **throws** and kills the handle once; a later successful `goto` rebinds it. |
| `extract` | `page.extract(schema)` / `{schema}` / `'<json literal>'` | Real JS values — the only non-string primitive |
| `evaluate` | `page.evaluate(script[, {timeout}])` | **Always a string**: `1+1`→`"2"`, `true`→`"true"`, objects→JSON text. The `{url}` and `{save}` options are broken in `run` mode — `goto` first |
| `screenshot` | `page.screenshot({path, selector?, fullPage?, strip?})` — never positional | `Saved 1920x1080 PNG to /abs/path.png`. `path` required in scripts (relative, no `..`, dir must exist). Text layout only — no fonts/colour/images |
| `click` | `click(sel)` / `click({selector})` | `Clicked element (selector: …). Page url: …, HTTP 200 OK, title: …` |
| `fill` | `fill(sel, val)` / `{selector, value}` | `Filled element (…) with "…". Page url: …` |
| `press` | `press(sel, key)` / `press(null, key)` / `{key[, selector]}` | `Pressed key 'Enter'. …`. **First positional is the selector** — `press("Enter")` fails |
| `hover` | `hover(sel)` / `{selector}` | `Hovered element (…)…` |
| `selectOption` | `selectOption(sel, val)` / `{selector, value}` | `Selected option 'de' (…)…` |
| `setChecked` | `setChecked(sel[, checked=true])` / `{selector, checked}` | `Set element (…) to checked.` / `to unchecked.` |
| `scroll` | `scroll({selector?, x?, y?})` — never positional | `Scrolled window to x: 0, y: 300.` Omitted axis keeps offset |
| `waitForSelector` | `waitForSelector(sel[, {timeout}])` | `Element found. backendNodeId: 1` (the id is unusable in scripts) |
| `waitForScript` | `waitForScript(expr[, {timeout}])` | `Script returned truthy.` |
| `waitForState` | `waitForState(state[, {timeout}])` | `Page reached networkidle.` States: `load`, `domcontentloaded`, `networkalmostidle`, `networkidle`, `done` |

Every action result embeds the **URL after the action**, so one call tells you
whether it navigated.

## `extract` schema cheat-sheet

Every leaf is a **string or `null`** — never a number. Text is trimmed at the
ends only; internal whitespace is preserved.

```js
{ t: "h1" }                                   // { t: "All products" } | null
{ v: { selector: "img", attr: "src" } }        // attribute; href/src made absolute
{ v: ["h3 a"] }                               // string[]  (all matches' text)
{ v: [{ selector: "a", attr: "href" }] }      // string[]  (all matches' attr)
{ recs: [{ selector: "article", limit: 3,     // [{…}]    (records)
           fields: { title: "h3 a",
                     url: { selector: "h3 a", attr: "href" } } }] }
[{ selector: "h3 a", limit: 2 }]               // bare array → array itself
page.extract('{"h":"h1"}')                     // JSON string form
fields: { text: "" }                           // the matched element's own text
```

Verified limitations:

- **`["a","b"]` reads only the first selector** — silently, no error. Use
  separate fields: `{ heading: "h1", items: ["#list li"] }`.
- **All top-level fields missing → throws** (including `{}`). An empty array
  field is fine (`[]`); a missing scalar is `null`.
- **`limit` is `Array.slice`, not a max.** `limit: -1` drops the last item;
  `limit: "2"` (string) is silently ignored; negative/string limits are hazards.
- **`extract` reads hidden elements** — no visibility filtering. Use MCP
  `links`/`interactiveElements` if you need visible-only.
- `""` outside a `fields` block throws `TypeError`; numeric/boolean schema values
  do too.
- `page.extract("h1")` → `InvalidParams`; the string form must be a JSON object.
- The `save` option is REPL/MCP-only.

## Waiting — the most common source of wrong data

`goto` defaults to `waitUntil: "load"`, a fast snapshot that **misses content
rendered by post-load JavaScript**. Verified on a fixture that renders 600 ms
after load:

| `waitUntil` | content present? |
|---|---|
| `load` (default) | no |
| `domcontentloaded` | no |
| `networkalmostidle` | no (for a single late `fetch`) |
| `networkidle` | **yes** |
| `done` | **yes** |

```js
await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
// or navigate then wait for the specific thing
await page.goto(url);
page.waitForSelector(".product");
```

Prefer `waitForSelector` on pages with constant background chatter; avoid `done`
there. A page that never reaches the state throws `navigation timed out`.

## Timeouts and slow sites

Default `goto` timeout is **10 000 ms**. Measured load times: example.com 1.07 s,
httpbin.org/html 1.51 s, but **books.toscrape.com ~9–10 s** (curl: 1.3 s) — right
at the default budget, causing intermittent `navigation timed out`. For slow
sites pass `{ timeout: 30000 }`.

`waitForSelector`/`waitForScript`/`waitForState` default to 5000 ms.

## Interaction gotchas

- `press("Enter")` binds "Enter" as the *selector* → `missing required argument
  'key'`. Use `press(null, "Enter")` or `press({ key: "Enter" })`.
- `$LP_*` placeholders resolve on the page but **the return string still shows
  the placeholder**. Never read a credential back out of a primitive's reply;
  verify with `evaluate`.
- An **unset** `$LP_*` does not error — it stays a literal string, so a typo'd
  variable silently posts `$LP_NOPE`.
- `click` succeeds even on `display:none` elements.
- **`--cookie` / `--cookie-jar` are silently ignored in `run` mode.** Use
  `--http-header "Cookie: k=v"` instead. They do work in `fetch` and `mcp`.

## Parallelism

`new Page()` per URL with `Promise.allSettled` works and helps on fast hosts
(5 URLs: serial 1627 ms → parallel 824 ms). Caveats: `Promise.all` rejects on
**any** rejected `goto` including a timeout, and same-host fan-out does not beat
serial because connections are capped (~6/host). Fan out across different hosts.

## List → detail pattern

```js
const BASE = "https://books.toscrape.com";
const OPTS = { timeout: 30000, waitUntil: "load" };
const page = new Page();
const rows = [];

for (const n of [1, 2]) {
  await page.goto(`${BASE}/catalogue/page-${n}.html`, OPTS);
  const { items } = page.extract({
    items: [{ selector: "article.product_pod",
      fields: { title: "h3 a",
                url: { selector: "h3 a", attr: "href" },
                price: ".price_color" } }]
  });
  for (const it of items) rows.push(it);
}

const books = [];
for (const row of rows.slice(0, 3)) {
  await page.goto(row.url, OPTS);
  const d = page.extract({ availability: ".availability" });
  books.push({ title: row.title, url: row.url,
    price: Number(row.price.replace(/[^0-9.]/g, "")),
    inStock: d.availability.startsWith("In stock") });
}

return { listed: rows.length, books };   // printed as JSON
```

Script-side state survives navigation, so assembly happens in plain JS.

## Runnable templates

| File | Does | Verified |
|---|---|---|
| [scripts/scrape-list-to-detail.js](../scripts/scrape-list-to-detail.js) | 2 catalogue pages → 40 records → detail pages merged, numeric parsing | ~14 s, 477 B clean JSON |
| [scripts/form-submit.js](../scripts/form-submit.js) | fill + Enter submit + post-submit assertion | ~2 s |
| [scripts/login-lpenv.js](../scripts/login-lpenv.js) | `$LP_USER`/`$LP_PASS`, proves the placeholder resolves on the page only | ~2 s |
