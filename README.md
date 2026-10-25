# Lightpanda Browser Agent Skill

[中文文档](docs/lightpanda-skill.md) · [Skill source](.dsh/skills/lightpanda-browser/SKILL.md)

A reusable agent skill that teaches an AI agent to use the
[Lightpanda](https://lightpanda.io) headless browser.

**The key advantage:** `lightpanda run` executes a plain `.js` file that drives a
real browser — no Node, no npm, no Puppeteer, no API key, no LLM. For an agent
with only a shell, it is the most portable way to click, type, and paginate.

Every recipe here was verified against **lightpanda 1.1.0-nightly.11012** —
400+ `fetch` runs, 49 CDP probe scripts, and 100+ PandaScript probes. Nothing is
copied from the docs without a test.

---

## What it is

```
.dsh/skills/lightpanda-browser/
├── SKILL.md                     # entry point: when to use, 5-step method, trap index
├── references/                  # loaded on demand
│   ├── interfaces.md            # which of the 5 interfaces + hard capability limits
│   ├── fetch.md                 # 20 silent-failure traps, dump modes, exit codes
│   ├── pandascript.md           # output contract, primitive table, extract cheat-sheet
│   ├── cdp.md                   # serve/CDP, API support matrix, request interception
│   ├── mcp.md                   # 32 MCP tools, dual error channels, session model
│   └── install.md               # install, version, troubleshooting, proxy, TLS
└── scripts/                     # runnable, regression-tested templates
    ├── lp.sh                    # safe wrapper: closes 4 traps by default
    ├── scrape-list-to-detail.js # paginated list→detail scrape → clean JSON
    ├── form-submit.js           # fill + submit + post-submit assertion
    ├── login-lpenv.js           # $LP_* credential placeholders
    ├── run-with-lightpanda.sh   # serve start/ready/teardown in one file
    ├── cdp-puppeteer.mjs        # puppeteer-core connection recipe
    └── cdp-zero-dep.mjs         # raw WebSocket CDP, no npm at all
```

`SKILL.md` stays under ~150 lines and defers detail to `references/`, so the
catalog entry is cheap while deep material is one read away.

## Install

### npx from GitHub

No clone, no global install:

```bash
# install into this project (./.dsh/skills/lightpanda-browser)
npx --allow-git=all github:YekaiY/lightpanda-skill install

# install for every project on this machine (~/.dsh/skills)
npx --allow-git=all github:YekaiY/lightpanda-skill install --user

# verify: skill files + the lightpanda binary + a real render
npx --allow-git=all github:YekaiY/lightpanda-skill doctor
```

> **The `--allow-git=all` flag is required on npm 12 and later.** npm 12
> disabled `github:` and remote-tarball dependencies by default (`allow-git=none`
> → `EALLOWGIT: Fetching packages of type "git" have been disabled`). npm 11 and
> earlier have no such setting and don't need the flag — they pass it through
> harmlessly. Verified: npm 11.7 → unset, npm 12.0 → `none`. You can also set it
> once in your config:
>
> ```bash
> npm config set allow-git all
> ```
>
> Arguments go after the package spec, so keep the explicit `install` when
> adding flags.

### From npm

After publishing (`npm publish`), the short form works on every npm version,
with no flags, because it is a normal registry package:

```bash
npx lightpanda-skill install
```

### CLI reference

| Command | Does |
|---|---|
| `install` | Copy the skill into `./.dsh/skills/` (default command) |
| `install --user` | Install to `~/.dsh/skills/` |
| `install --dir <path>` | Install into a specific project |
| `install --force` | Overwrite an existing install (default: refuse) |
| `install --dry-run` | Show the resolved target, write nothing |
| `print [--file F]` | Print a bundled file to stdout (default `SKILL.md`) |
| `where` | Show where the bundled skill lives |
| `doctor` | Check skill install, binary, and a live render |

`install` never clobbers an existing skill unless you pass `--force`, because the
installed copy is yours to edit.

### Manual

The skill is just files. Copy `.dsh/skills/lightpanda-browser/` into your
project (or `~/.dsh/skills/`). DSH discovers both roots automatically; the
project-level one takes precedence.

### The browser itself

The skill drives the `lightpanda` binary, which is separate:

```bash
lightpanda version || curl -fsSL https://pkg.lightpanda.io/install.sh | bash
```

## Quick start

```bash
# confirm the binary
lightpanda version

# the default page read that is actually correct
lightpanda fetch --dump markdown --strip-mode clutter \
  --load-resources stylesheet --wait-until networkidle --wait-ms 15000 \
  --json --fail-on-http-error "https://example.com"

# structured extraction, no npm needed
lightpanda run scripts/scrape-list-to-detail.js
```

## Failure modes it protects you from

These are real, reproduced failures — each one silently returns *wrong data*:

| Trap | What the agent sees | Fix |
|---|---|---|
| **4xx/5xx exits 0** | Summarizes a 404 page as content | `--fail-on-http-error` (exit 22), or check `http_status` |
| **Navigation failure prints a fake page on stdout** | `# Navigation failed` ends up in the corpus | Gate on exit code 1, not on non-empty output |
| **`--wait-ms` too small → silent empty output** | Empty body, exit 0, `error: null` | Raise the deadline; treat empty + `http_status:0` as a timeout |
| **External stylesheets not loaded by default** | CSS-hidden content leaks in; `--strip-mode invisible` does nothing | `--load-resources stylesheet` |
| **`load` is a pre-render snapshot** | SPA skeleton / spinner captured | `--wait-until networkidle`, `done` for heavy SPAs |
| **`clutter` silently falls back** | Nav and cookie banners still present | Compare byte size with an unstripped dump |
| **`extract` leaves are strings** | `price + 1` concatenates | `Number()` and guard `null` |
| **`["a","b"]` reads only the first selector** | Second selector silently dropped | Use separate fields |
| **`console.log` corrupts stdout** | JSON pipeline fails to parse | `return` data, `console.error` for debug |
| **`--cookie` is a no-op in `run` mode** | Cookies never sent | `--http-header "Cookie: k=v"` |
| **`--json` + `--metrics` is invalid JSON** | `Extra data: line 2` | Never combine them |

### Capability limits that are not configuration problems

- **No pixel rendering.** `screenshot`/`png`/`pdf` render computed text layout
  only — no images, fonts, or colours. Do not use it for visual regression or
  pixel-accurate screenshot comparison.
- **`file://` is unsupported** — serve local files over HTTP.
- **One page per CDP instance** (no tabs, no multiple contexts); parallelism
  comes from separate connections.
- **`page.click` does not auto-scroll** — off-viewport elements always fail.
- **Honest identity:** UA `Lightpanda/1.0`, `Sec-Ch-Ua: "Lightpanda"`, and
  `--user-agent` rejects anything containing `Mozilla`. UA-gated sites return a
  challenge page; that is a stable outcome, not a flaky failure. Use
  `--user-agent-suffix`, `--http-nav-delay`, and `--obey-robots` instead.

## Interface decision tree

```
Content present in initial HTML or after brief JS rendering?
├── Yes → fetch              (single process, no deps, deterministic)
└── No — needs clicks / typing / login / multi-step
    ├── Existing Puppeteer/Playwright code? → serve (CDP)
    ├── Caller is an MCP host?              → mcp
    └── Otherwise (shell-only agent)        → PandaScript
```

PandaScript is the sweet spot for agents: one `.js` file, one binary, zero
dependencies.

## Verification

Three parallel agents verified the surface against the real binary:

| Area | Evidence | Output |
|---|---|---|
| `fetch` | 402 runs, deterministic local fixtures | 20-trap table, exit-code matrix, `--wait-until` semantics |
| `serve`/CDP | 49 probe scripts, 2 API matrices | Puppeteer 82-check / Playwright 52-check pass-fail lists |
| PandaScript/MCP | 100+ probes, real JSON-RPC capture | Output contract, primitive return strings, 32 MCP tools |

Every shipped script was re-run in this pass:

```
scripts/scrape-list-to-detail.js   exit 0, 477 B clean JSON, ~14 s
scripts/form-submit.js             exit 0,                     ~2 s
scripts/login-lpenv.js             exit 0 (placeholder resolves on page, never echoed)
scripts/cdp-zero-dep.mjs           exit 0, title + 59520-byte screenshot
scripts/run-with-lightpanda.sh     ready-poll OK; busy port refused (exit 1);
                                   payload exit code propagated (42 → 42); no leaked process
scripts/lp.sh                      md/text/html/json/shot/run/which all exit 0;
                                   404 → 22; bad domain → 1
```

Two of our own earlier claims were **corrected by the verification**:

1. "Request interception barely works under CDP" — **wrong**. The real cause was a
   handler that never called `continue()` for the document request, hanging
   `goto` to timeout. With a complete handler, interception fully works
   (mock JSON injection and resource abort both verified).
2. "`--load-resources` under CDP only affects `document.styleSheets`" —
   inaccurate. Default is `none`, so **subresource requests are never made at
   all** (1 document request by default vs. an image request once
   `--load-resources image` is added).

## Not verified / limitations

- `lightpanda agent` (the LLM REPL, `/save`, …) — needs an API key; all
  PandaScript findings come from `lightpanda run`, not recordings.
- Lightpanda Cloud differences — local binary only.
- `evaluate`'s documented `{url}` / `{save}` options are broken in `run` mode.
- `page_status.blocked.*` does not increment for `--block-urls`, and
  `bot_challenge` was never non-null. Treat both as advisory, not assertions.
- Wikipedia / Hacker News were unreachable from the verification sandbox, so
  `--wait-until` tuning is fixture-based.
- 3xx redirect interaction with `--fail-on-http-error`, and `ETag` revalidation,
  were not isolated.

## Maintenance

- After upgrading Lightpanda, calibrate flags with `lightpanda help <command>` —
  built-in help is authoritative for the binary you actually have — then re-run
  the script regression above.
- Keep `SKILL.md` around 150 lines; put new detail in `references/`.
- Version baseline: `lightpanda 1.1.0-nightly.11012+f24eb6c7a` (2026-10).

## References

- Docs: <https://lightpanda.io/docs>
- CLI: <https://lightpanda.io/docs/reference/cli>
- MCP tools: <https://lightpanda.io/docs/reference/mcp-tools>
- PandaScript: <https://lightpanda.io/docs/reference/pandascript>
- GitHub: <https://github.com/lightpanda-io/browser>
