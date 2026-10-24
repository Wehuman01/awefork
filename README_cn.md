<div align="center">
  <img src="assets/icon/icon.png" alt="awefork 图标" width="128" />
  <h1>awefork：非线性会话工作台</h1>
  <p><strong>任意一轮，随时分叉。每条分支，都留着。</strong></p>
  <p>把 AI 编程 agent 的会话变成一棵树的桌面工作台：选中任意历史轮次，从那里长出新分支，并行推进多条探索路径。</p>
  <p>
    <a href="./README.md">English</a> ·
    <strong>简体中文</strong> ·
    <a href="https://www.wehuman.top/">Wehuman</a>
  </p>
  <p>
    <a href="https://ko-fi.com/mugpeng"><img src="https://img.shields.io/badge/Ko--fi-Buy%20me%20a%20coffee-FF5E5B?style=flat-square&logo=ko-fi&logoColor=white" alt="Ko-fi"></a>
  </p>
  <p>
    <img src="https://img.shields.io/badge/version-0.4.6-7C3AED?style=flat-square" alt="Version">
    <img src="https://img.shields.io/badge/node-%E2%89%A522-0EA5E9?style=flat-square" alt="Node">
    <img src="https://img.shields.io/badge/license-MPL--2.0-22C55E?style=flat-square" alt="License">
  </p>
  <p>
    <img src="https://img.shields.io/badge/status-alpha-c96a3d?style=flat-square" alt="Status">
    <img src="https://img.shields.io/badge/install-download_dmg-22C55E?style=flat-square" alt="从 Release 下载 dmg">
    <img src="https://img.shields.io/badge/platform-desktop-334155?style=flat-square" alt="Platform">
    <img src="https://img.shields.io/github/stars/wehuman01/awefork?style=flat-square" alt="GitHub stars">
  </p>
</div>

<p align="center">
  <img src="assets/images/app-overview.png" alt="awefork 主界面：分支会话画布" width="860" />
</p>

> 任意一轮，随时分叉。每条分支，都留着。

awefork 是本地编程 agent 的非线性工作台，当前支持 [opencode](https://opencode.ai)、Codex、[pi](https://github.com/badlogic/pi-mono) 和 ZCode。它围绕一个核心动作构建：**节点级分叉** —— 选中会话里的任意一条用户消息，从那一轮长出一个新会话，在全新的上下文里继续，原会话毫发无损。

范围刻意收窄：投影你的真实 agent 会话，分叉与续聊全部走各 agent 的原生 API，renderer 不接触后端专属数据。不重写会话格式、没有锁定 —— 它创建的每个会话都仍是所选 agent 的原生会话。

「会话是一张图，随时分叉」这个想法源自 [PiX](https://github.com/huang-sh/PiX)——它最早把非线性会话图带进 AI agent 工作台。awefork 通过一套统一的 adapter 接口把这条思路适配到多个 agent 后端。

## 工作方式

```text
┌──────────────┬──────────────────────────────────┐
│ 会话列表      │  选中回合的问答内容                │
│ （分叉树 ⎇，  │                                  │
│  目录可折叠） │  ▸ 点画布卡片或左侧会话，          │
│              │    右侧跳到对应回合                │
│ /repo        │                                  │
│  · session A │  底部输入框继续                   │
│    · ⎇ A-1   │  这条分支                         │
└──────────────┴──────────────────────────────────┘
```

- **导航器** —— 当前 agent 的会话按项目目录分组（目录可折叠）；分叉嵌套在父会话之下，任意分支的子树可从行首 ▸/▾ 折叠（搜索期间折叠自动挂起）；点 ★ 收藏一条会话，收藏跨项目集中在侧栏顶部的「★ 收藏」区，画布只画当前选中的故事，不受收藏影响。右键可重命名或归档；右键目录可归档整个项目。归档项从所有视图隐藏（搜索、命令面板、画布），在侧栏底部归档区一键恢复——目录归档后新增的会话也保持隐藏，直到目录恢复。
- **增强搜索** —— 搜索框右侧的 ✦ 打开范围勾选（标题 / 标签 / 正文）、项目下拉（默认跨所有项目，可限定到单个项目）和搜索上限（默认 1000；可选 100 / 300 / 500 / 1000 / 全部）；同样的能力也能直接敲语法：`body:词` 扫会话正文（大小写不敏感，结果异步补上，命中片段高亮，点击定位到画布上的对应回合）、`#标签`、`title:`、`dir:`、`is:收藏` / `is:fork` / `is:运行中`、`"精确短语"`、`-词` 排除。全角冒号、前缀后带空格都能识别。
- **回合面板** —— 右侧只显示一个回合的提问与回复，头部带耗时与输出 token。点画布卡片或左侧会话，面板跳到对应回合；新回合运行时自动跟随；用 ‹ › 或 ←/→ 在回合间移动。
- **Fork here** —— 任意一轮都能长出新分支，新会话完整保留该轮（提问 + 回答），并直接进入新会话。
- **模型选择** —— 可搜索的选择器（70+ 模型不犯愁）用在新分支上；主输入框旁也有按会话记忆的模型选择。★ 可把模型钉进「常用」，手动选过的自动进「最近」，两组都排在选择器顶部。
- **思考强度** —— 模型旁选择本次运行的推理档位（minimal/low/medium/high…），画布卡片以「模型 · 档位」标注每轮实际使用的配置。
- **审批与表单** —— Codex 审批和 opencode 权限/表单请求显示在对应会话对话末尾；可设置自动拒绝时间，未知或无人回答的请求不会默认放行。后台会话的请求会停在自己的面板里等待。
- **文件与文件夹输入** —— 两个输入框都支持粘贴/拖入文件（按后端与模型能力门控）；图片、文本以及 Word/RTF 文档作为有上限的附件，文件夹则作为绝对路径插入成可编辑的草稿文本。发出的消息带附件角标。
- **失败重跑** —— 失败回合的 ↻（卡片或面板头部）会用原文和原模型预填草稿，改完再发；中途回合重跑长成新分支，失败的原回合原样保留。
- **回合文件改动** —— edit/write 工具事件流经时当场快照；回合下方挂一张文件卡：状态、增删行数、保存的 diff（不随后续编辑改变）、打开文件。awefork 之外跑的回合（分叉继承或离线期间）如实标注"未记录"，不猜。仅 opencode。
- **续聊** —— 在 awefork 里直接发消息，回复实时流式显示；选中较早回合时回复会从那一轮分叉。
- **画布** —— 选中回合后高亮从根到该回合的整条路径，其余淡化；适配视图；小地图常驻左下角，实时框出当前视口。
- **对比与导出** —— 可对比分支与母本，或两个独立会话；也可把当前分支导出为 Markdown，并附模型、耗时和 token 信息。右键会话可在 agent 自己的终端里恢复。
- **关键对话标记** —— 用 ★ 标记任意回合（卡片角标或右侧面板头部）。已标记回合在画布上呈玫红描边，小地图上是玫红点，「★ 关键节点」面板可一键跳转。纯 overlay（`marks.json`），不碰 agent 存储。
- **命令面板** —— ⌘K / Ctrl+K 快速切会话、执行动作；拖动分栏手柄调宽，双击折叠。
- **原生会话** —— 分叉调用当前 agent 的原生分叉能力，产物是真实会话，可随时回到该 agent 自己的工具里继续。
- **多 Agent** —— 可在同一窗口切换 agent，也可启用独立窗口，为每个 agent 保留一个窗口。查看其他后端时，后台运行和事件流仍会继续。
- **设置与 Labs** —— ⌘, / Ctrl+, 打开设置，覆盖外观、语言、agent、模型、画布、文件、搜索、快捷键、存储、更新和 Labs。文件浏览和多模型轮次目前都由 Labs 开关控制，默认关闭。
- **文件浏览** —— 打开 Labs 后，可在中间栏或侧栏浏览本地文件，预览 Markdown、源码、图片、CSV/TSV 与 PDF 前几页，并把文件引用插入画布草稿。读取只在本机进行、只读、有大小上限，并遵守忽略规则。
- **多模型轮次** —— 打开 Labs 后，可把同一问题发给最多四个模型，每个模型各自分叉运行，并排读取回答；可选地在完成的回答上再加一条汇总分支。
- **故事标签页** —— 用浏览器式标签页打开彼此独立的 fork tree；标签会换行显示而不是消失，各自保留画布视口，也可从侧栏或命令面板打开。

## 安装

**直接下载** —— 从[最新 Release](https://github.com/wehuman01/awefork/releases/latest) 下载 `awefork-<版本>-arm64.dmg`（macOS，Apple Silicon），拖进「应用程序」即可。构建未签名：首次启动请右键应用选「打开」（或用 `xattr -d com.apple.quarantine /Applications/awefork.app` 清除隔离标记）。

**Windows** —— 源码构建 `npm run dist:win`（NSIS 安装包）。需要当前选择的 agent CLI 在 PATH 上，npm 安装的 `.cmd` 形式也能自动识别。

**从源码运行** —— 需要 Node.js ≥ 22，且至少一个受支持的 agent CLI 在 PATH 上：`opencode`、`codex`、`pi` 或 ZCode。应用内 agent 选择器会提示缺失的 CLI，并可为 opencode、Codex 和 pi 安装。

```bash
git clone https://github.com/wehuman01/awefork.git
cd awefork
npm install
```

opencode 会复用兼容的现有服务，或按需启动。Codex、pi 和 ZCode 使用各自的 app-server 或 RPC 生命周期；选择已安装的 agent 后，只在需要时启动。

## 快速开始（源码方式）

```bash
npm run dev
```

1. 在顶栏选择已安装的 agent。
2. 在左侧树里选一个会话。
3. 找到想分叉的那一轮 → 点 **⎇ fork here**。
4. 新分支打开，在输入框里继续对话。
5. 原会话不受影响，随时切回。

## 配置

应用把自己的状态保存在 Electron 的 `userData` 目录中，不会改写 agent 自己的会话存储。

| 事实 | 值 |
|---|---|
| 应用选择与服务事实 | `<userData>/settings.json`（当前后端、opencode 最近端口、退出行为、引导状态） |
| renderer 偏好 | renderer storage 中的 `awefork:settings` 与 `awefork:layout`（主题、语言、布局、文件、Labs） |
| 按后端隔离的 overlay | `<userData>/*-<backend>.json`（谱系、收藏、标记、标签、回收站、归档、草稿、目录） |
| 文件改动快照 | `<userData>/file-changes/<backend>/<sessionId>/` |

sidecar 只保存 awefork 在原生会话之外补充的事实。旧的无后缀 opencode store 仍可读取，新后端使用带后缀的文件。删除 overlay 可能丢失树形关联、标记或界面状态，但不会删除 agent 的会话。opencode 会依次探测最近端口、`AWEFORK_OPENCODE_PORT`、经典候选端口和已注册的 v2 后台服务，不会假定 4096 一定可用。

## 兼容性

opencode 的易变协议事实保存在 `src/shared/agents/opencode.json`（1.18–1.19 API）和 `src/shared/agents/opencode-v2.json`（v2 `/api` 服务）中：端点、SSE 事件名、字段路径、fork 切点转换、能力标记和测试版本区间。adapter 解释这些封闭词汇表，校验器会在启动时拒绝未知字段。Codex、pi 和 ZCode 的后端生命周期与协议映射保留在各自 adapter 和主进程 facade 中。

| 后端 | 原生协议 | 重命名 | 删除会话 | 导出分支 | 说明 |
|---|---|---:|---:|---:|---|
| opencode 1.18–1.19 | HTTP + SSE | 支持 | 支持 | 支持 | descriptor 驱动的 v1 协议 |
| opencode 2.0–2.1 | 鉴权 `/api` + events | 支持 | 支持 | 支持 | 不支持删除单条消息 |
| Codex | `codex app-server` JSON-RPC | 支持 | 支持 | 不支持 | 合并 aweswitch 的多账号 home |
| pi | JSONL sessions + RPC | 支持 | 不支持 | 不支持 | `npm install -g @earendil-works/pi-coding-agent` |
| ZCode | app-server / v4 commands | 支持 | 支持（软删除） | 不支持 | 自动发现 macOS 应用，或设置 `AWEFORK_ZCODE_CLI` |

四个后端都支持分叉、续聊、流式回复和会话压缩。图片、文本与文档附件按后端能力显示；逐回合文件改动仍只支持 opencode。opencode 版本不在 `≥1.18.0, <1.19.0` 与 `≥2.0.0, <2.2.0` 区间时，切换器会显示警告。

## 多 Agent 路线

核心是 `AgentAdapter` 协议（`src/shared/types.ts`）：会话列表、消息、模型、创建、分叉/导出、删除、重命名、prompt/abort、压缩、交互请求和规范化事件订阅。opencode、Codex、pi 和 ZCode 均已实现；主进程 backend registry 负责按需生命周期和能力路由。后续计划：Claude Code（带 `parentUuid` 的 JSONL + `--resume`）。

## 赞助与支持

如果 awefork 帮到了你，欢迎支持一下：

- ⭐ 给项目点个 Star — 让更多人看到它。
- ☕ [Ko-fi](https://ko-fi.com/mugpeng) — 请我喝杯咖啡。
- 💬 微信 — 扫描下方收款码。

<p align="center">
  <img src="assets/images/wechat-pay.jpg" alt="微信收款码" width="240">
</p>

> awefork 是免费开源的，你的支持让它持续维护下去 — 谢谢。

## 开发

```bash
npm run typecheck   # tsc + vue-tsc
npm run lint        # biome
npm test            # vitest（假 HTTP/stdio/RPC agent，不需要真实 agent）
npm run test:gui    # 真实 Electron + mock adapter 交互检查
```

架构与设计约束见 [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md)。

- [贡献指南](./docs/CONTRIBUTING.md)
- [更新日志](./docs/CHANGELOG.md)

## Awesome 软件生态

awefork 是一个不断壮大的 "awesome" 工具家族中的一员 — 围绕 AI 编程 agent 打造，local-first、可被 agent 直接操作。

### CLI 工具

- **[aweskill](https://aweskill.wehuman.top/)** — CLI 优先的技能包管理器，支持 47+ AI 编程 agent。
- **[aweswitch](https://github.com/wehuman01/aweswitch)** — Claude Code、Codex、OpenCode 的 agent 配置切换器。
- **[awerouter](https://github.com/wehuman01/awerouter)** — 智能路由器，用结构信号把请求分给 Flash 或 Pro 模型，减少不必要的模型开销。
- **[aweshelf](https://github.com/wehuman01/aweshelf)** — 收藏、分类、恢复 AI 编程会话，还能搭配 aweswitch 实现保存配置，一键启动。
- **[aweshare](https://github.com/wehuman01/aweshare)** — 通过自建 Hub 共享本地 Ollama/vLLM，或国产厂商 coding plan，或已授权的 OpenAI/Anthropic 帐号订阅，实现 token 的共享经济。
- **[awewarm](https://github.com/wehuman01/awewarm)** — 订阅窗口保持器，让 AI 编程套餐的窗口持续激活，无论是本地设置，还是通过远程连接的服务器。
- **[awescholar](https://github.com/wehuman01/awescholar)** — AI agent 可自主执行的科学文献发现与策展，搜索、标注、筛选和报告学术论文。
- **[awecontrib](https://github.com/wehuman01/awecontrib)** — 每个仓库一条 verify 入口：写入一个小的 verify 脚本和最小 CI，本地和 CI 跑的是同一条命令。

### 桌面应用

- **[awefork](https://github.com/wehuman01/awefork)** — 本项目。把 AI 编程 agent 的会话变成一棵树：任意一轮，随时分叉，每条分支都留着。搭配 aweswitch 用更顺手 — 用 profile 启动会话，再回到这里浏览、分叉它的历史。
- **[awedot](https://awedot.wehuman.top/)** — 悬浮球驻留屏幕边缘，实时追踪当前 AI 会话；一键收藏、随时恢复，并可搭配 aweswitch 固定 agent 配置（比如用 GLM 模型启动）。

### Project Collections

- **[Awesome AI Meets Biology](https://github.com/Webioinfo01/Awesome-AI-Meets-Biology)** — AI 在生物学、生物信息学和生物医学研究中应用的精选综述。由 awescholar 驱动。
- **[Awesome AI Virtual Tumor](https://github.com/Webioinfo01/Awesome-AI-Virtual-Tumor)** — 面向虚拟肿瘤建模与仿真的前沿 AI 系统精选合集：静态模型、动态模型、agent、基准与综述。
- **[AgentX](https://github.com/Webioinfo01/agentx-hub)** — 科研 AI agent 社区目录：Verified Run 评审、实时 GitHub 指标和月度报告，由 awescholar 校验流水线策展。
