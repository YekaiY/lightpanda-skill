# Choosing an interface

Lightpanda exposes five ways in. Pick by **what has to happen on the page**, not
by preference — most agent failures come from picking a scripted interface when a
one-shot fetch would have worked, or vice versa.

| You need | Use | Why |
|---|---|---|
| Page text/markdown for an LLM | `lightpanda fetch --dump markdown` | One process, no setup, rendered post-JS |
| Structured records from a page | `lightpanda fetch --dump markdown` + a PandaScript `extract` | Selector schemas return JSON |
| Click, fill, log in, paginate | PandaScript (`lightpanda run`) | Real DOM events, no npm install |
| An existing Puppeteer/Playwright suite | `lightpanda serve` (CDP) | Same protocol, point the client at it |
| An MCP host (Claude Desktop, Cursor…) | `lightpanda mcp` | Native MCP tools |
| Task in English, no code | `lightpanda agent --task` | Requires an LLM API key |

## The decision in practice

```
Does the content appear in the initial HTML or after a short JS render?
├── Yes → fetch. Cheapest, one process, deterministic.
└── No — needs clicks / typing / login / multi-step navigation
    ├── Do you already have Puppeteer/Playwright code? → serve (CDP)
    ├── Is the caller an MCP host?                     → mcp
    └── Otherwise (an AI agent with only a shell)      → PandaScript
```

**PandaScript is the sweet spot for agents.** It needs no npm packages, no
Node/Python at all, no CDP client library, and no API key. It is a plain `.js`
file the single binary runs, which makes it the most portable automation path
here. Prefer it over `serve` unless you specifically need a CDP client library
or an already-written Puppeteer suite.

## Hard limits to plan around

These are engine characteristics, not configuration mistakes:

- **No page rendering.** There is no pixel-accurate paint: `screenshot` and the
  `png`/`pdf` dumps render the *computed text layout*, not images, fonts, or CSS
  colours. Do not use Lightpanda for visual regression testing or for
  screenshot-based visual QA. Use Chrome for that.
- **`file://` is not supported** (`Reason: UnsupportedProtocol`). Serve fixtures
  over HTTP, or pass data with `--inject-script`.
- **No browser-UI features.** No extensions, no PDF printing via Chrome's
  pipeline, no download management, no WebGL.
- **Stylesheets are not fetched by default in `fetch`/`serve`/`run`** (only
  `mcp`/`agent` default to loading them). This matters for both visual detail
  and visibility checks — see [fetch.md](fetch.md#css-hidden-content-leaks-into-output).
- **WebDriver BiDi** exists alongside CDP (for Selenium); CDP is the better
  supported path and the one Puppeteer/Playwright use.

## Bot walls

Lightpanda identifies itself honestly: the default User-Agent is
`Lightpanda/1.0` with `Sec-Ch-Ua: "Lightpanda"`, and `--user-agent` **rejects**
any value containing `Mozilla` (`invalid user-agent … can't contain Mozilla`).
Consequences:

- Sites that gate on a browser UA (Google, some CDNs, some retail sites) return
  a challenge page, not content. That is by design; Lightpanda will not
  impersonate Chrome.
- `--user-agent-suffix` is the sanctioned way to identify your tool to site
  owners: `--user-agent-suffix " (+mytool)"`.
- For a UA-gated target, either use a target that serves content to non-browser
  clients, or fall back to a full browser. Do not retry a challenge page
  repeatedly — it is a stable outcome, not a transient failure.
- Respect `--obey-robots` when crawling: it is off by default.
