# 文件浏览：预览布局、目录多标签与预览能力扩展 — 设计

Date: 2026-10-24
Status: 阶段一、二已实现并通过验证；阶段三做了图片解码失败态
依据：2026-10-23 拖放 / 引用交互审阅（`todo/2026-10-23-file-browser-delivery.md` 的后续）+ 本轮用户反馈
适用范围：`awefork2`，文件浏览实验（Labs 门控）

## 1. 现状与问题

审阅基于 `dev` 快照，全部结论有代码位置可查。

布局：

- 预览栏无条件渲染，固定占 320px，空状态也占位，文件列表始终被压缩：
  `src/renderer/src/components/file-browser.vue:206` 的 `<aside class="fb-preview">` 没有 `v-if`，
  `src/renderer/src/style.css:7105` 的 `.fb-preview { flex: 0 0 320px; }`。
  用户描述为"空的时候挤压文件浏览，用的时候预览被压在右边"。
- 预览已有放大（`.fp.zoomed`，`src/renderer/src/style.css:7529`），但只是把同一个 320px 面板
  浮起来，不是真正的空间切换；列表不收起，放大后仍留一条压缩的列表在边上。

交互不一致：

- 文件列表单击只选中：`src/renderer/src/components/file-browser.vue:167`、`:193` 的 `@click`
  只调 `selectEntry`，`src/renderer/src/files.ts:234` 的 `selectEntry` 只写 `selectedPath`；
  预览要双击、回车或右键菜单才触发。
- 侧栏文件 dock 单击直接预览：`src/renderer/src/components/session-file-dock.vue:106`。
- 结果：列表里选中 B、预览仍显示 A，与"选择文件即可预览"的空状态文案
  （`src/renderer/src/i18n-panels.ts` 的 `files.previewEmpty`）不一致。

状态模型：

- 浏览状态只有全局一份：`src/renderer/src/files.ts:45` 的 `files` reactive 里
  `browsing` / `history` / `forward` / `filter` / `selectedPath` / `preview` 都是单值。
- 预览请求序号 `previewSeq` 也是全局一份（`src/renderer/src/files.ts:82`）。
  `load()` 在目录切换时清空 `files.preview`（`src/renderer/src/files.ts:138`），但不使在途请求失效，
  旧响应回来仍会写入 `files.preview`，把已经不在当前目录的文件重新显示出来。
  静态可确认，未运行复现。

预览能力：

- 图片读取已支持 PNG / JPEG / GIF / WebP / BMP / ICO / AVIF / SVG，上限 8 MiB：
  `src/main/file-browser.ts:30`、`:34`。
- 但图片分支只有 `<img>`，没有文件名、放大、系统打开等文字预览才有的控件：
  `src/renderer/src/components/file-preview.vue:15`。
- `<img>` 没有 `@error`：读取成功不等于解码成功，损坏文件会停在 image 状态且没有出路。
- 其余格式：CSV / TSV 按纯文本显示；PDF 与 Office 没有预览，只能"用系统应用打开"。
  文本上限 512 KiB（`src/main/file-browser.ts:28`）。

搜索范围：

- 快速搜索始终查 AI 当前项目 `store.selectedDirectory`（`src/renderer/src/components/file-browser.vue:326`），
  与正在浏览的目录无关。人在 B 目录浏览，搜索可能查 A 项目。

## 2. 目标 / 非目标

目标：

1. 预览不占位时不给列表；要读的时候预览拿主要空间；空间可预期、可恢复。
2. 单击即预览，所有入口一致；方向键可连续浏览。
3. 同一文件视图内可开多个浏览标签，各自记住路径、历史、过滤、选中、预览与滚动位置。
4. 图片有与文字一致的工具栏，损坏 / 超限有明确反馈。
5. 预览能力按 CSV/TSV 表格、PDF 的顺序扩展，明确标注截断与不支持。

非目标：

- 不做文件编辑、重命名、删除。
- 不做多选拖放（规格已留到后续）。
- 不把查看与附件发送合并：`chat-input.vue` 的附件流程保持不变，预览里的"引用到对话"
  仍是插入路径文本，不产生附件 chip、不触发发送。
- 不改变浏览与 AI 项目目录的解耦：文件浏览不调 `switchDirectory`
  （`src/renderer/src/files.ts:1` 的注释即此边界）。

## 3. 阶段一：浏览与预览的空间分配

三态，由 `files.preview` 驱动：

| 状态 | 列表 | 预览 |
| --- | --- | --- |
| 无预览 | 占满 `.fb-body` | 不渲染 |
| 已选中 | 紧凑导航栏（可收窄） | 主区域，默认 320px 起，分隔线可拖 |
| 阅读中 | 收起为一条返回栏 | 占满 `.fb-body` |

规则：

- 空预览不占位：`.fb-preview` 加 `v-if="files.preview"`，宽度样式移到有预览的分支上。
- 分栏宽度可拖，记录在浏览标签上（阶段二落地），首次预览给一个默认值，之后只跟随用户。
- 阅读模式入口：双击文件、`⤢`、空格。退出：Esc、返回栏按钮、`⤢` 再点一次。
  阅读态是预览自己的状态，不写进 `settings`。
- 中间区域过窄时（`.fb-body` 宽度低于阈值，如 640px）不做两栏硬塞：预览覆盖在列表之上，
  保留关闭按钮回到列表。
- 首次从无预览到有预览时调整布局，之后切换文件只换内容，不跳动。

交互统一：

- 列表与网格的 `@click` 改为选中 + 预览（文件）或进入（目录）；`@dblclick` 留给阅读模式与进入目录。
- `↑` / `↓` 移动选中并同步预览，与侧栏 dock 的单击预览对齐。
- 目录的单击仍是选中（选中目录不触发预览），双击进入；回车进入。

需要同步修改的既有行为：`src/renderer/src/components/file-browser.vue:167`、`:193`、
`src/renderer/src/files.ts:234`（`selectEntry` 与 `previewEntry` 的调用点），
以及 `tests/renderer-files-store.test.ts` 里断言"单击只选中"的用例。

## 4. 阶段二：目录多标签

标签 = 一个浏览位置。外观与操作复用画布标签（`src/renderer/src/components/canvas-tabs.vue:1`）：
活动态、关闭 ×、中键关闭、关闭后激活相邻标签（参考
`src/renderer/src/state.ts:1471` 的邻居规则）。**不复用** `CanvasTab` /
`activateCanvasTab` / `openCanvasTab`：它们会切换 AI 会话与项目目录
（`src/renderer/src/state.ts:1394`、`:1428`），文件标签必须保持当前会话不变。

每个标签持有完整浏览状态：

- `browsing`、独立 `history` / `forward`、`filter`、`selectedPath`、`preview`
- 列表滚动位置、分栏宽度、阅读态
- 预览请求序号按标签计，切标签、关标签、清空时使本标签在途请求失效

因此 `src/renderer/src/files.ts:45` 的单值状态要改成"标签数组 + 活动标签 id"，
`previewSeq` / `listSeq` / `quickSeq` 归到标签上。组件继续通过 `files.*` 读写活动标签的字段，
不需要知道标签数组的存在。

开标签的方式：

- `＋` 复制当前浏览位置开新标签（与画布 `＋` 创建会话同形，这里是复制目录）
- 目录右键菜单加"在新标签页打开"
- 普通进入子目录留在当前标签，不自动开新标签

标题用目录名，重名时补一层父目录，完整路径放 `title`。关闭最后一个标签时回到一个默认目录
（当前项目根，否则 home），不留空视图。

快速搜索改为跟随当前标签的根目录，工具栏明确显示"搜索范围：<目录>"，
与"只过滤当前目录"的输入框区分开。

## 5. 阶段三：预览能力

先补一致性，再扩格式。

统一工具栏（文字、图片、错误态共用）：文件名、路径、语言 / 类型徽标、截断标记、
引用到对话、系统打开、`⤢`、关闭。图片分支补上这些控件
（`src/renderer/src/components/file-preview.vue:15`）。

图片：

- `<img>` 加 `@error`，解码失败落到 error 态，给"用系统应用打开"。
- 显示原始像素尺寸与字节数；超限（`too-large`）时说明上限来自设置里的图片上限。
- SVG 按图片渲染已有，注意其中脚本不执行（`<img>` 天然不执行脚本）。

新格式，按此顺序，每步独立可交付：

1. CSV / TSV：表格预览，前若干行 + 列数，超出说明截断；仍走文本读取，不改主进程。
2. PDF：只读首页或前几页为图片，需要新的主进程通道；不做文本选择、不做标注。
3. Office（docx / xlsx）： mammoth 已在依赖里，可做 docx 转 Markdown 预览；
   xlsx 需要解析器，成本更高，放最后评估。

## 6. 边界

- 浏览不调 `switchDirectory`；文件标签切换不动 AI 会话、草稿与项目目录。
- 查看不等于发送：预览不产生附件，不触发后端请求；附件能力门控
  （Codex / ZCode 为 false）与预览无关。
- 主进程只读：新通道（如 PDF）同样只读，经 `FsResult` 返回，renderer 不获得 Node 能力。
- 本地路径链接与文件改动卡片继续走"用系统应用打开"，不强行纳入预览层。

## 7. 验证计划

- `tests/renderer-files-store.test.ts`：切目录丢弃在途预览；每标签独立的历史 / 过滤 / 选中 / 预览；
  关闭标签使请求失效。
- `tests/gui-file-drop.test.mjs` 或新增 GUI 用例：空预览不占位、单击即预览、阅读模式进出、
  标签切换后 AI 会话与草稿不变、窄窗口单栏覆盖。
- `npm run verify`（typecheck + biome + vitest）与 `npm run test:gui`。
- Windows 相关路径行为沿用本期已知未覆盖项，不在本次扩大。

## 8. 建议实施顺序

1. 阶段一（空间分配 + 单击预览）——直接对应用户当前最强烈的两个感受。
2. 阶段二（目录多标签 + 状态归属到标签）——依赖阶段一的分栏宽度 / 阅读态可归属。
3. 阶段三（工具栏统一、图片反馈、CSV/TSV、PDF）——前三项可先做，PDF 单独一期。

## 9. 阶段一实现记录（2026-10-24）

已落地：

- `src/renderer/src/files.ts`：新增 `selectOrPreviewEntry`（单击即预览，目录只选中，
  `openOnDouble === "system"` 时单击只选中）与 `clearPreview`（关闭预览不动选中）；
  `load()` 开头 `previewSeq += 1`，切目录即让在途预览失效，迟到的旧响应不再回填。
- `src/renderer/src/components/file-browser.vue`：预览栏改为 `v-if="files.preview !== null"`，
  空状态不再占位；`ResizeObserver` 观察 `.main-col`，窄于 640px 时预览覆盖列表；
  新增可拖分栏 `.fb-split`，宽度写入 `--fb-preview-width`；`↑` / `↓` 走列表并同步预览。
- `src/renderer/src/components/file-preview.vue`：text / image / error 三种状态共用同一个
  `.fp-head`，图片与错误态补上文件名、语言徽标、`⤢`、`↗`、`✕`。
- `src/renderer/src/style.css`：`.fb-preview` 用 `flex: 0 0 var(--fb-preview-width, 340px)`；
  新增 `.fb-split` 与 `.fb-body-narrow .fb-preview` 覆盖式布局。
- `src/renderer/src/i18n-panels.ts`：新增 `files.kindImage`、`files.closePreview`。

验证：

- `tests/renderer-files-store.test.ts`：31 通过（新增 4 例——单击预览、目录只选中、
  `openOnDouble` 为 system 时单击只选中、切目录丢弃在途预览、`clearPreview` 不动选中）。
- `vue-tsc` + `tsc` 双 tsconfig 无错误；`biome check .` 仍为 6 个 warning（与改动前一致）。
- 全量 `vitest run`：1197 通过，1 个失败为 `tests/codex-server.test.ts` 的
  `CODEX_HOME` 用例，改动前同样失败，与文件浏览无关。

未做（留给后续）：可拖宽度尚未持久化；窄窗口阈值固定在 640px；阶段二、三未开始。

## 10. 阶段二实现记录（2026-10-24）

已落地：

- `src/renderer/src/files.ts`：浏览状态从 store 的单值字段搬到 `FileTab`，store 只保留
  `tabs` / `activeTabId` 和跨标签共享的偏好（视图、隐藏文件、快速搜索隐藏开关、侧栏树、notice）。
  每个 tab 自带 `browsing` / `history` / `forward` / `entries` / `error` / `capped` /
  `selectedPath` / `filter` / `quick*` / `preview` / `previewWidth` / `scrollTop`，
  以及自己的 `previewSeq` / `listSeq` / `quickSeq`——切标签、关标签、清空都只失效本标签的请求。
  新增 `parkFileTab` / `openFileTab` / `openFileTabFor`（同目录去重）/ `activateFileTab` /
  `closeFileTab`（关闭最后一个落在 home，不留空视图）/ `fileTabLabel`（重名补父目录）/
  `setPreviewWidth` / `setListingScroll`，以及 `browsingDir` / `selectedPath` 两个 computed
  供侧栏树和 dock 读活动标签。
- `src/renderer/src/components/file-browser.vue`：模板改读 `tab.*`，`tab` 是解析活动标签的
  computed；新增标签栏（复用画布标签外观：活动态、× 关闭、中键关闭、＋ 新建），`＋` 复制当前
  浏览位置；分栏宽度改存到 tab。
- `src/renderer/src/components/file-menu.vue`：目录右键加“在新标签页中打开”。
- `src/renderer/src/components/file-tree.vue` / `file-tree-node.vue` / `session-file-dock.vue`：
  改读 `browsingDir` / `selectedPath`。
- `src/renderer/src/style.css`：新增 `.fb-tabs` / `.fb-tab` / `.fb-tab-x` / `.fb-tab-new`。
- `src/renderer/src/i18n-panels.ts`：新增 `files.tabsLabel`、`files.tabBlank`、`files.tabNew`、
  `files.tabClose`、`files.openInNewTab`。

边界保持：文件标签切换不动 AI 会话、草稿、项目目录；浏览仍不调 `switchDirectory`。

验证：

- `tests/renderer-files-store.test.ts`：38 通过（新增 7 例——各标签位置/选中/预览互不污染、
  各标签独立前进后退、同目录去重、关闭激活邻居、关闭最后一个不停在空视图、
  关闭即失效在途预览、重名标签补父目录）。
- 全量 `vitest run`：1204 通过，1 个失败仍为 `tests/codex-server.test.ts` 的 `CODEX_HOME`
  用例（改动前同样失败，与文件浏览无关）。
- `vue-tsc` + `tsc` 双 tsconfig 无错误；`biome check .` 仍为 6 个 warning（与改动前一致）。

未做（阶段三）：统一工具栏的图片解码失败态、CSV/TSV 表格、PDF；分栏宽度与标签未持久化到
localStorage。

## 11. 阶段三首批实现记录（2026-10-24）

- `src/renderer/src/components/file-preview.vue`：`<img>` 加 `@error`，读取成功但解码失败
  （损坏文件、扩展名撒谎）不再卡在图片态，落到错误面板并保留“用系统应用打开”；
  放大按钮在图片损坏时隐藏；新增 `files.errImageDecode` 文案。
- 未做：CSV/TSV 表格、PDF、Office 预览，以及分栏宽度与标签的持久化。
