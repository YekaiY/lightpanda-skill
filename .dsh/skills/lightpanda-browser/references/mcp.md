# MCP mode: `lightpanda mcp`

Use when the caller is an MCP host. It exposes 32 tools plus 3 resources, with
no LLM and no API key on the Lightpanda side.

## Start

```bash
lightpanda mcp                 # stdio, the default for MCP hosts
lightpanda mcp --port 8000     # HTTP, one isolated session per client
```

Client config for a generic MCP host:

```json
{"mcpServers":{"lightpanda":{"command":"/usr/bin/lightpanda","args":["mcp"],"env":{}}}}
```

Add `"--obey-robots"` or `"--cookie", "<file>"` to `args` as needed. Both work in
`mcp` mode (unlike `run`, where they are silently ignored).

## Transport facts

- **stdio**: line-delimited JSON-RPC, one message per line. Startup prints
  **nothing**. `initialize` is **not required** before `tools/call`, and
  `notifications/initialized` is not required. `Content-Length:` framing is
  **not** supported (it replies `Parse error`). Malformed input gets a `Parse
  error` and the server keeps serving.
- **HTTP**: `POST /mcp` (also `/` and `/mcp/`) with `Content-Type:
  application/json`; `text/plain` → 415, `GET` → 405, bad JSON → `-32700`. Port
  in use → exit 1, `AddressInUse`.

```bash
curl -s -D hdr.txt -X POST http://localhost:8000/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"1.0"}}}'
# response header: mcp-session-id: s1

curl -s -X POST http://localhost:8000/mcp -H 'Content-Type: application/json' -H 'Mcp-Session-Id: s1' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"goto","arguments":{"url":"https://example.com"}}}'
```

Session semantics (verified):

- No `Mcp-Session-Id` header → the always-present `default` session, persisting
  across requests.
- `initialize` **creates** a new session and returns its id in the header.
- **An unknown id is accepted and silently gets a fresh session.** It is a
  routing key, not a security boundary.
- Repeating `initialize` allocates more sessions.
- `session_new` / `session_list` / `session_close` are **HTTP-only**; over stdio
  they return `isError: true` ("multiple sessions require the HTTP transport").

## Tools (32)

Navigation & search: `goto`, `search`
Reading: `markdown`, `html`, `screenshot`, `links`, `tree`, `nodeDetails`,
`interactiveElements`, `structuredData`, `detectForms`
Data & scripting: `evaluate`, `extract`
Interaction: `click`, `fill`, `scroll`, `hover`, `press`, `selectOption`,
`setChecked`, `findElement`
Waiting: `waitForSelector`, `waitForScript`, `waitForState`
State: `consoleLogs`, `getUrl`, `getCookies`, `getEnv`
Session: `save`, `session_new`, `session_list`, `session_close`

Agent workflow tips:

- `search` works **keyless** via a public endpoint (~8 s). Prefer it over
  navigating to google.com/search.
- `markdown` accepts `url` — reading with `url` set is cheaper than a separate
  `goto`.
- `extract`'s `schema` is a **string**, not an object; passing an object returns
  `InvalidParams`.
- `links` and `interactiveElements` filter hidden elements; `extract` does not.
- `consoleLogs` **clears on read** — buffer it yourself if you need it twice.
- `getEnv` reads `LP_*` variables; use `$LP_*` placeholders for secrets rather
  than asking for a credential by name.
- `save` writes a replayable PandaScript you can run later with
  `lightpanda run` — a good way to freeze a trajectory.
- With `extract`/`evaluate` + `save`, the result is stored in the `lp.*` bridge
  and the tool reply is empty; read it back with `evaluate("lp.name")`. Values
  in `lp.*` survive navigation.

## Error handling: check **both** channels

Errors arrive through two different shapes, and a client that checks only one
will miss half of them:

1. JSON-RPC `error`: `-32601` (tool/method not found), `-32602`
   (`InvalidParams`, `NodeNotFound`), `-32604` (`FrameNotLoaded` — no page
   loaded), `-32002` (`NavigationTimeout`).
2. `result.isError: true` with the message inside `content[].text`:
   navigation failures, `InvalidParams`, missing required argument, extract
   no-match, bad path.

## Timeouts are SOFT here (opposite of `run` mode)

This is the single most important cross-interface difference:

| Situation | Result |
|---|---|
| No response at all (bad host) | JSON-RPC error `-32002 NavigationTimeout`; page empty |
| HTTP status arrived, `load` never fired | **`isError: false`** with text `Navigation started (HTTP 200 OK) but the page did not finish loading before the timeout.` — **the page stays usable**, and a later `markdown` reads it |

So in MCP mode a slow page is a warning, not a failure. Do not port a
`run`-mode assumption here: a PandaScript `goto` timeout **kills** the page
handle; an MCP soft timeout does not.

## Resources (3)

| URI | Purpose |
|---|---|
| `mcp://page/markdown` | Current page as markdown (requires a loaded page) |
| `mcp://page/html` | Current page as HTML (requires a loaded page) |
| `mcp://skill/pandascript` | 12 KB of PandaScript authoring rules — needs no page |

Without a loaded page, the two page resources return `-32604 Page not loaded`.

## When not to use MCP

MCP adds a protocol layer. If you are an agent with shell access, `fetch` and
`run` are simpler and expose the same engine. Use MCP when the *host* speaks
MCP and expects tools.
