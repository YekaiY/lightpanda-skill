# Lightpanda 浏览器 Agent Skill

教会 AI Agent 使用 [Lightpanda](https://lightpanda.io) 无头浏览器的可复用技能包。

**核心价值**：`lightpanda run` 可以直接执行一个普通 `.js` 文件来操作网页 ——
不需要 Node、不需要 npm、不需要 Puppeteer、不需要 API key、不需要 LLM。
对只有 shell 的 Agent 来说，这是最可移植的网页自动化方式。

本技能包中每一条配方都在 **lightpanda 1.1.0-nightly.11012** 上实测验证过
（共 400+ 次 fetch 实验、49 个 CDP 探测脚本、100+ 个 PandaScript 探针），
不是从文档照抄的。

---

## 1. 安装

### 从 GitHub 用 npx 安装（推荐）

```bash
# 装进当前项目：./.dsh/skills/lightpanda-browser
npx --allow-git=all github:YekaiY/lightpanda-skill install

# 装给本机所有项目：~/.dsh/skills
npx --allow-git=all github:YekaiY/lightpanda-skill install --user

# 体检：技能文件 + lightpanda 二进制 + 一次真实渲染
npx --allow-git=all github:YekaiY/lightpanda-skill doctor
```

> **npm 12 及以上必须加 `--allow-git=all`。** npm 12 默认禁用
> `github:` 与远程 tarball 依赖（`allow-git=none`，报
> `EALLOWGIT: Fetching packages of type "git" have been disabled`）。
> npm 11 及更早没有该配置项，无需此 flag（照常传参也无副作用）。
> 实测：npm 11.7 → 未定义，npm 12.0 → `none`。
> 也可以一次性写入配置：`npm config set allow-git all`。

### 已发布到 npm 时

发布后用短形式，所有 npm 版本都无需额外 flag：

```bash
npx lightpanda-skill install
```

### 安装到哪里

技能目录（已按 DSH 技能发现规则放置）：

```
<project>/.dsh/skills/lightpanda-browser/
```

DSH 会自动发现该目录，无需注册。技能在会话中以下列形式出现：

- `lightpanda-browser`（名称，可用于 `skill` 工具直接加载）
- 触发条件写在 `description` 里：读取/抓取/交互网页、JS 渲染页、SPA、
  登录表单、分页详情页、CDP、MCP，以及 "抓回来是空的 / 只有骨架 / 一堆噪音 /
  其实是错误页" 这类诊断场景

若想全局可用（所有项目），复制到：

```bash
~/.dsh/skills/lightpanda-browser/
```

项目级（`.dsh/skills/`）优先级高于用户级（`~/.dsh/skills/`）。

## 2. 目录结构

```
.dsh/skills/lightpanda-browser/
├── SKILL.md                     # 入口：何时用、五步法、陷阱速查
├── references/                  # 按需加载的详细文档
│   ├── interfaces.md            # 五种接口怎么选 + 硬性能力边界 + 反爬现实
│   ├── fetch.md                 # lightpanda fetch：20 个陷阱、dump 模式、退出码
│   ├── pandascript.md           # PandaScript：输出契约、原语表、extract 速查
│   ├── cdp.md                   # serve/CDP：连接、API 支持矩阵、请求拦截
│   ├── mcp.md                   # MCP：32 个工具、双通道错误、会话模型
│   └── install.md               # 安装/版本/故障排查/代理/TLS/遥测
└── scripts/                     # 可直接运行的模板
    ├── lp.sh                    # 安全包装器（把 4 个陷阱默认关掉）
    ├── scrape-list-to-detail.js # 列表→详情分页抓取，输出干净 JSON
    ├── form-submit.js           # 填表 + 提交 + 提交后断言
    ├── login-lpenv.js           # $LP_* 凭据占位符用法
    ├── run-with-lightpanda.sh   # serve 启动/就绪/清理一次性搞定
    ├── cdp-puppeteer.mjs        # puppeteer-core 连接配方
    └── cdp-zero-dep.mjs         # 零依赖 raw WebSocket CDP 配方
```

**渐进加载设计**：`SKILL.md` 只有约 130 行，先给出"何时用、怎么做、别踩什么坑"；
细节全部在 `references/` 里按需读取。这样既省上下文，又保证深挖时有足够资料。

## 3. 快速开始

```bash
# 0. 确认已安装（通常已装）
lightpanda version

# 1. 最常用：把网页变成给 LLM 看的 markdown
lightpanda fetch --dump markdown --strip-mode clutter \
  --load-resources stylesheet --wait-until networkidle --wait-ms 15000 \
  --json --fail-on-http-error "https://example.com"

# 2. 结构化提取（无需任何 npm 包）
lightpanda run scripts/scrape-list-to-detail.js

# 3. 交互/登录（PandaScript）
LP_USER=alice LP_PASS=s3cret lightpanda run scripts/login-lpenv.js
```

## 4. 为什么要用这个技能：它替你避开的真实故障

普通 Agent 直接调用 `lightpanda fetch` 会踩到一批**静默给出错误数据**的坑。
以下全部实测复现，并写进了技能正文：

| 坑 | Agent 看到的现象 | 正确做法 |
|---|---|---|
| **HTTP 4xx/5xx 退出码是 0** | 把 404 页面当正文总结，"数据缺失" | `--fail-on-http-error`（退出 22）或读 `http_status` |
| **导航失败在 stdout 打印假页面** | 语料里混进 `# Navigation failed` | 判定退出码 1，而不是"输出非空即成功" |
| **`--wait-ms` 太小 → 静默空输出** | 空内容、退出 0、`error: null`（看不出是超时） | 给足 `--wait-ms`；把"空内容 + `http_status:0`"当超时 |
| **默认不加载外部样式表** | `display:none` 的隐藏内容混进正文；`--strip-mode invisible` 无效 | `--load-resources stylesheet` |
| **`load` 是渲染前快照** | SPA 抓回骨架屏 / 加载中 | `--wait-until networkidle`，重度 SPA 用 `done` |
| **`clutter` 会静默回退** | 导航栏、Cookie 横幅还在，体积和未修剪一致 | 与未修剪版本比字节数 |
| **`extract` 返回的全是字符串** | `price + 1` 变成字符串拼接 | 自己 `Number()`，并防 `null` |
| **`["a","b"]` 只读第一个选择器** | 第二个选择器静默丢失 | 拆成两个字段 |
| **`console.log` 污染 stdout** | JSON 管道解析失败 | 用 `return` 传数据，`console.error` 调试 |
| **`run` 模式下 `--cookie` 静默失效** | 以为已带 cookie，实际没发 | 用 `--http-header "Cookie: k=v"` |
| **`--json` + `--metrics` 不是合法 JSON** | `json.loads` 报 `Extra data` | 永不组合使用 |

### 一个特别值得注意的发现

Lightpanda 诚实地标识自己（UA `Lightpanda/1.0`，`Sec-Ch-Ua: "Lightpanda"`），
且 `--user-agent` 会**拒绝**任何包含 `Mozilla` 的值。因此遇到 UA 拦截站点会拿到
挑战页 —— 这是稳定结果，不是临时失败。技能里明确写了：不要重试挑战页，
应改用其他数据源或换真实浏览器。同时给出了合规做法：
`--user-agent-suffix " (+mytool)"`、`--http-nav-delay`、`--obey-robots`。

## 5. 接口选择（技能的核心决策树）

```
内容在初始 HTML 或短暂 JS 渲染后就有？
├── 是 → fetch（单进程、无依赖、确定性最好）
└── 否 —— 需要点击 / 输入 / 登录 / 多步跳转
    ├── 已有 Puppeteer/Playwright 代码？ → serve (CDP)
    ├── 调用方是 MCP Host？              → mcp
    └── 其他（只有 shell 的 Agent）       → PandaScript
```

**PandaScript 是 Agent 的首选**：一个 `.js` 文件，单二进制执行，零依赖。

### 已知能力边界（不是配置问题，是引擎特性）

- **不渲染像素**：`screenshot`/`png`/`pdf` 只渲染文本布局，不含图片/字体/颜色。
  **不要用于视觉回归测试或像素级截图对比。**
- **不支持 `file://`**：需用 HTTP 服务本地文件。
- **无扩展、无 Chrome 打印管线、无 WebGL**。
- **CDP 下每个实例只能有一个页面**（无标签页/多上下文），并发靠多连接。
- **CDP 下 `page.click` 不会自动滚动**，视口外元素点击必失败。

## 6. 验证情况

本次验证由 3 个并行 Agent 分工完成，全部使用真实二进制实测：

| 范围 | 证据量 | 代表成果 |
|---|---|---|
| `fetch` | 402 次运行、确定性本地 fixture | 20 条陷阱表、退出码矩阵、`--wait-until` 语义表 |
| `serve`/CDP | 49 个探测脚本、2 份 API 矩阵 | Puppeteer 82 项/Playwright 52 项通过-失败清单 |
| PandaScript/MCP | 100+ 探针、真实 JSON-RPC 抓取 | 输出契约、原语返回串、32 个 MCP 工具清单 |

**技能内所有脚本都经过本轮回归**：

```
scripts/scrape-list-to-detail.js   exit 0, 477 B 干净 JSON, ~14 s
scripts/form-submit.js             exit 0,                           ~2 s
scripts/login-lpenv.js             exit 0（占位符已验证在页面解析、回显串不解密）
scripts/cdp-zero-dep.mjs           exit 0, 标题+截图 59520 bytes
scripts/run-with-lightpanda.sh     就绪轮询 OK；端口占用拒绝(exit 1)；payload 退出码透传(42→42)；无进程泄漏
scripts/lp.sh                      md/text/html/json/shot/run/which 全部 exit 0；404→22；坏域名→1
```

同时修正了我们在过程中发现的**自己写错的两处文档**：

1. `serve` 下"请求拦截基本不可用" → **错误**。真实原因是拦截处理器没有为
   document 请求调用 `continue()`，导致 `goto` 挂到超时；补上后拦截完全可用
   （已实测 mock JSON 注入 + 资源 abort）。
2. "CDP 下 `--load-resources` 只影响 `document.styleSheets`" → 不准确。
   真实影响更大：**默认根本不会发起子资源请求**（实测默认只看到 1 个
   document 请求；加上 `--load-resources image` 后才有 image 请求）。

## 7. 已知未验证 / 局限

诚实记录，避免过度承诺：

- `lightpanda agent`（带 LLM 的 REPL，`/save` 等）未测 —— 需要 LLM API key。
  技能中所有 PandaScript 结论都来自 `lightpanda run`，不来自录制。
- Lightpanda Cloud 差异未测（只用本地二进制）。
- `evaluate` 文档中的 `{url}` / `{save}` 选项在 `run` 模式下不可用（实测报错并
  使句柄失效）；技能已注明改用 `goto`。
- `page_status.blocked.*` 计数器在 `--block-urls` 时不增长；
  `bot_challenge` 在任何测试中都没出现非 null 值。技能将它们标注为"参考信息，
  不可作为断言依据"。
- Wikipedia / Hacker News 在验证环境不可达（curl 也超时），因此
  `--wait-until` 调优是基于本地确定性 fixture 完成的。
- 3xx 重定向与 `--fail-on-http-error` 的交互、`ETag` 重验证未单独验证。

## 8. 维护

- 升级 Lightpanda 后，先用 `lightpanda help <command>` 校准 flag（内置帮助永远
  是该二进制的权威），再跑一遍上文的脚本回归。
- 若 LLM 使用 GenAI skill 的渐进加载，`SKILL.md` 应保持在 ~150 行以内；
  新增细节请写进 `references/`。
- 版本基线：`lightpanda 1.1.0-nightly.11012+f24eb6c7a`（2026-10）。

## 9. 参考

- 官方文档：<https://lightpanda.io/docs>
- GitHub：<https://github.com/lightpanda-io/browser>
- CLI 参考：<https://lightpanda.io/docs/reference/cli>
- MCP 工具：<https://lightpanda.io/docs/reference/mcp-tools>
- PandaScript：<https://lightpanda.io/docs/reference/pandascript>
