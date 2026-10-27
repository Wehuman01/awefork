# 画布多选会话 → 事后总结（Session Digest）— 设计

Date: 2026-10-26
Status: 待审阅
依据：本轮用户需求（"在画布里直接选择某些会话，然后可以直接选中进行总结操作"）+ 2026-10-26 交互确认
适用范围：多模型 Labs 门控（`labs.parallelModels`），零新增设置键；本设计由 `awefork4` 实现后合入 `dev`。

## 1. 现状与问题

多模型汇总链路已经完整存在，且全部可复用：

- **生成**：`createParallelSummary`（`src/renderer/src/state.ts`）把各 target 的文本拼成
  `【i · label】` 分节材料，从 anchor ✂ 无上下文 fork 出汇总 session，发汇总 prompt，
  结果落 `summaryVersions`。
- **画布 UI**：✦ 汇总卡片（含来源列表）、⇄ 源徽章、source→summary 连线，全部由
  `parallelGroups` 推导（`session-canvas.vue` 的 `isParallelSummary` / `parallelSummaryOf` /
  `parallelSourceOf`）。
- **阅读面板**：`parallel-results.vue` 渲染汇总文本 + 每来源一张卡（标题、状态、摘要行、
  折叠全文、打开、compare 双选）——来源条目本来就是按「会话」组织的。
- **持久化**：`persistRound` → `RoundRecord`（`src/shared/rounds-types.ts`）→ rounds.json，
  重启后 `loadRoundsFromMain` 恢复为惰性记录（无 watcher、不占 busy）。
- **画布点选范式**：compare 的 armed pick（`beginComparePick` → `selectNode` 劫持点击 →
  完成配对）证明「画布上先 arm、再点卡」是本代码库已验证的交互。

缺口：汇总是「轮次」的附属品——源永远是同一 prompt 的各模型回答。用户跑完几个独立会话
（故事）之后，没有办法把它们合起来总结。

## 2. 目标 / 非目标

目标：

1. 画布上直接挑选 2–4 个会话，一键生成总结；挑选过程可见、可取消。
2. 总结 session 作为 ✂ 无上下文 fork 落在**第一个选中故事**的树上（用户已确认）。
3. 全链路复用：汇总生成、✦ 卡片、来源列表、阅读面板、RoundRecord 持久化；
   digest 不引入第二套汇总机制。
4. Labs 门控复用 `labs.parallelModels` 一个开关；模型/长度默认值复用
   `labs.parallel.summaryModel` / `labs.parallel.summaryLength`；零新增设置键。

非目标：

- 跨 backend 挑选：画布是单 backend 视图，digest 同 backend。
- 修改任何源会话历史：digest 是只读聚合，fork 只落在 anchor 一侧。
- 独立 Labs 开关、设置里新行。
- 长度 "none"：digest 必然要产出总结，对话框只给精简/标准。

## 3. 入口与挑选模式（armed pick，对齐 compare）

入口两处：

- 卡片 hover 按钮排新增「Σ」（现有 🗑 ★ ↻ ⎇ 那排，`session-canvas.vue` 模板卡内按钮区）。
- sidebar 会话右键菜单新增「总结多个会话…」，与 `compareFromMenu` 并列
  （`side-bar.vue` 的 `menuInDirectory` 同类门控：仅同目录会话显示）。

状态（`src/renderer/src/state.ts`）：

- `store.digestPick: string[]` —— 有序 sessionId，上限 `DIGEST_MAX_SOURCES = 4`；
  armed 态 = 数组非空。

挑选语义（`session-canvas.vue` 的 `selectNode`，在 comparePick 分支之后）：

- 点已选卡 → 从数组移除；数组空则 disarm。
- 点未选卡且未满 → 追加（顺序即 ①②③④）。
- 已满 4 再点新卡 → 忽略 + `flashNotice` 提示上限。
- Esc 或浮动条「取消」→ 清空。
- 挑选不清空 `selectedId`：不打断用户当前阅读，选中环只是叠加样式。

视觉：

- 已选卡：淡紫圆环 + 序号角标（配色思路复用 compare 的 l/r 着色，`style.css` compare 段）。
- 浮动条：画布底部居中，「已选 n/4」+ [取消] + [生成总结]（n<2 禁用）。

## 4. 生成对话框（`digest-dialog.vue`，新组件）

- 模型选择：复用 `model-picker.vue` 的分组（收藏/最近/全部）；
  默认值 = `settings.labs.parallel.summaryModel`。
- 长度：精简 / 标准；默认值 = `settings.labs.parallel.summaryLength`。
- 指令 textarea：预填默认模板（中英各一），可改。默认模板描述任务
  （"总结这些会话：各自做了什么、关键结论、分歧与建议"），不写死四段式——四段式在
  prompt 模板里。
- 所选会话标题列表（所见即所得）；无内容的会话在此过滤并提示。

## 5. 合成 round（`src/renderer/src/digest.ts`，新模块）

三个纯函数 + 一个构造器：

- `serializeSession(messages)`：逐轮精简文本（`### 用户` / `### 助手`），不带走模型元数据
  （那是 `branch-markdown.ts` 导出格式的重负载，digest 不需要）。
  每源上限 `DIGEST_SOURCE_MAX_CHARS = 50_000`：从**最旧**轮次开始丢，丢过的部分在源节
  末尾注明 `（更早的轮次已省略）`。
- `buildDigestPrompt(instruction, sources)`：digest 版模板。与轮次模板的差别：
  材料是 N 个**独立会话记录**而非同一问题的多个回答；"原问题"换成用户指令；
  四段式保留（结论、共识、分歧（标明来源）、建议下一步）；语言跟随 UI locale；
  注明缺失/被截断的来源。输出结构与轮次一致：`【i · 标题】` 分节。
- `createDigestGroup(sessions, { model, length, instruction })` → `ParallelGroup`：
  - `anchorSessionId` = 第一个选中会话，`anchorMessageId` = null（从末梢 fork）；
  - `contextMode: "none"`；
  - `prompt` = instruction，`attachments: []`；
  - `targets`：每会话一条 `{ id: "digest-<i>", sessionId, label: 会话标题,
    status: "done", text: serializeSession 结果, model: null, baselineMessageIds: [] }`；
  - `settings: { model, length }`；
  - `digest: true`（`ParallelGroup` 新字段，见下）；
  - 无内容会话跳过；剩余不足 2 个则返回 null（调用方提示）。

执行：`summarizeParallelGroup(group.id)` 原样链路（fork → `sendPromptToBackend` →
settle → `summaryVersions` → `persistRound` → `refreshSessions`）。唯一需要分叉的是
prompt 模板：`createParallelSummary` 按 `group.digest` 选择 digest 模板或轮次模板
（模板函数提取后二选一，其余逻辑零改动）。

`ParallelGroup.digest?: boolean`（`src/renderer/src/parallel-groups.ts`）：标记这是事后
总结组。用途：阅读面板措辞、持久化截断规则。canvas 徽章不读它。

## 6. 画布与阅读面板

- ✦ 卡片 / 来源列表 / ⇄ 徽章 / source→summary 连线：**零改动**（digest 组就是
  ParallelGroup）。
- `parallel-results.vue`：digest 组换措辞——标题「会话总结」、phase「n 个来源」，
  经 `parallel-i18n.ts` 加少量字符串 + 模板按 `group.digest` 选词。
  source 卡的 retry 按钮仅 failed/unknown 显示，digest 源恒为 done，天然不出现。
- 总结落地后选中总结 session：digest 是用户刚点的操作，always land；
  `autoOpenReading` 是给「没人盯的轮次」用的，不适用于此。

## 7. 持久化

- `RoundRecord` 结构不变，`roundRecordFromGroup`（`src/renderer/src/rounds.ts`）对 digest 组
  把 `target.text` 截到约 4_000 字节选：完整材料在生成时已进 summary prompt，源会话一键
  可达；4 源 × 200k（MAX_TEXT）全量落 rounds.json 是纯浪费。
- 恢复后阅读面板 source fold 显示节选；标题、打开、compare 不受影响。

## 8. 文件改动清单

| 文件 | 改动 |
| --- | --- |
| `src/renderer/src/digest.ts` | 新：序列化、截断、prompt 模板、`createDigestGroup` |
| `src/renderer/src/parallel-groups.ts` | `ParallelGroup` 加 `digest?: boolean` |
| `src/renderer/src/state.ts` | `digestPick` 状态、挑选处理器、`startDigest`、`selectNode` 接线、模板分叉 |
| `src/renderer/src/rounds.ts` | digest 组 persist 截断 |
| `src/renderer/src/components/session-canvas.vue` | Σ 按钮、选中环/角标、浮动条、Esc |
| `src/renderer/src/components/side-bar.vue` | 右键入口（同目录门控） |
| `src/renderer/src/components/digest-dialog.vue` | 新对话框 |
| `src/renderer/src/components/parallel-results.vue` | digest 措辞 |
| `src/renderer/src/i18n-panels.ts` / `parallel-i18n.ts` | 中英字符串 |
| `tests/digest.test.ts` | 新：序列化、截断、模板、group 形状 |
| `tests/renderer-digest-pick.test.ts` | 新：挑选状态机 + labs 门控 |
| `tests/rounds-restore.test.ts` | 扩：digest 记录往返 + 截断 |

## 9. 测试与验证

- 单元（`tests/digest.test.ts`）：截断从最旧轮次丢且注记；模板含全部来源与指令；
  空会话被排除；`createDigestGroup` 的 anchor=第一个、targets 形状、`digest: true`。
- 状态机（`tests/renderer-digest-pick.test.ts`）：labs 关闭时无入口；arm→追加→
  满 4 忽略→再点移除→Esc 清空；`selectedId` 不受挑选影响。
- 持久化（`tests/rounds-restore.test.ts` 扩）：digest 记录往返恢复为惰性组；
  `text` 落盘被截断。
- 门禁：`npm run verify`（typecheck + biome + vitest 全量）全绿后才算完成。

## 10. 风险与边界

- **超长会话**：50k/源上限 + prompt 注明截断；4 源最坏 ~200k 进 prompt，与轮次回答
  （MAX_TEXT 200k/target）同量级，不引入新上限。
- **fork 时 anchor  backend 正忙**：与轮次汇总相同路径（settle 等待 + unknown 可重试），
  不新增处理。
- **总结 session 继承 anchor 的目录**：与现有轮次汇总行为一致，用户在对话框所见标题
  即来源会话，不会误解。
- **digest 组与轮次共用 `parallelGroups`**：恢复后的 digest 组同样是惰性的，不会占
  busy、不会拦截发送——与轮次恢复语义一致。
