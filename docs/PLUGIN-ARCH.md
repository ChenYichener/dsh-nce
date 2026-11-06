# dsh-nce 插件架构与协作契约

> **权威架构文档。** 改代码前先读这里；改架构边界先改这里，而且必须让
> `node scripts/check-architecture.mjs` 通过——它把本文的规则变成了可执行的护栏。

## 0. 产品目标

在 DeepSeek Harness 侧边栏里做一个「新概念英语 1」学习面板（名称 **NCE**）。

- **信息架构（4 个入口）**：`课程 / 记忆卡 / 错题本 / 音标&自然拼读`，右上角固定「声音」菜单。
  复习不占独立入口，从记忆卡到期提示、课程页欢迎卡「今日复习」或单课「去记忆卡」进入，属于记忆卡这条线（`nav.page` 仍有 `review`）。
- **课程**：左侧常驻 144 课列表（搜索/分组/三态/3 个步骤小点）、右侧当前课详情。
- **单课 = 一页式**：页头（上一课/下一课、课号与中英标题、只读状态徽章）→
  吸顶锚点条（视频/课文/单词/语法/练习）→ 视频（默认收起，点「展开视频」才挂载播放器）→ 课文 + 单词双栏 → 语法 → 练习（作业清单 + 课堂跟读 + 练习卷）。
  学习步骤只有 3 个（单词/语法/练习），由左侧课程列表的状态下拉框（选「已学习」= 三步全勾）和各区块的「标记完成」维护；
  课程状态只在左侧列表编辑，单课页头只展示。
- **记忆卡**：Anki 式 SRS（Again/Hard/Good/Easy），全册去重词库（866 词）。
- **错题本**：练习卷判错 / 近似的题自动收集，按课分组展示题干、你的答案、参考答案与 AI 点评；
  「去重做」跳到该课练习卷，「已掌握」移出；数据在浏览器 localStorage，顶部标签显示待掌握数量。
- **音标&自然拼读**：48 音标 / 自然拼读规则 / 最小对立对 / 音节规则，全部可点读。
- 详见 `docs/LEARNING-FLOW.md`、`docs/EXERCISE-PAPER.md`、`docs/DATA-CONTRACT.md`。

## 1. 形态选择（已定）

**DSH 插件（Host Node 路由 + Client React 页面）= 本地 BS 形态，不是独立站点。**

- Host 半挂 `POST /dsh-nce/api/<op>`：读内置数据、SQLite 持久化、`say` 朗读 WAV、默认模型 AI 批改。
- Client 半通过 `sidebar.panellist` + `main` 两个 slot 注册「NCE」入口和主面板。
- 课程视频不由 Host 代理：客户端内置 B 站合集分 P 映射，直接用 `player.bilibili.com` iframe。
- 不使用 iframe 承载面板；不引入前端构建器；React 由宿主的浏览器模块表提供。

## 2. 双半架构总览

```
┌────────────────────────────── dsh-nce 包 ──────────────────────────────┐
│ cordis.patch.yml  → 插入一行插件行（Host 半 + Client manifest）        │
│                                                                        │
│ index.js  ── Host 组合根（thin composition root）                      │
│   └─ src/host/{domain,application,infrastructure,http}/  ← 分层        │
│        domain ← application ← (http / composition root)                │
│        infrastructure 通过 ports 注入 application（依赖倒置）          │
│                                                                        │
│ client.js ── Client 构建产物（勿手改）                                 │
│   └─ src/client/NN-*.js + src/client/generated/NN-*.js  ← 层带 fragment │
│        编号即依赖方向：只能引用更小编号的 fragment（同一 factory 作用域）│
│                                                                        │
│ data/  ← 只读内置内容（构建产物，脚本生成）                            │
│ locale/ icon.svg README.md docs/                                       │
└────────────────────────────────────────────────────────────────────────┘
```

两条硬规则：

1. **依赖只能指向更深/更早的层**：Host 走 ESM import 方向约束，Client 走 fragment 编号顺序约束。
2. **业务规则不依赖框架/IO**：纯逻辑在 `src/host/domain/` 与纯 fragment（`01-domain.js`、`10-paper-engine.js`），
   在 Node 里可直接单测，不需要宿主、模型或网络。

## 3. Host 半：Clean Architecture

### 3.1 分层与依赖规则

| 层 | 目录 | 可以 import | 禁止 |
|---|---|---|---|
| domain | `src/host/domain/` | 同层 domain 模块 | `node:*`、fs/http/ctx、上层任何模块 |
| application | `src/host/application/` | `domain/*`、`../ports.js`、同层 application | `node:*`、`infrastructure/*`、`http/*`、`config.js` |
| infrastructure | `src/host/infrastructure/` | 同层、`domain/*`、`../ports.js`、`../config.js`、`node:*` | `application/*`、`http/*` |
| http | `src/host/http/` | 同层 http 模块 | 业务层、domain、infrastructure、node |
| ports / config | `src/host/ports.js`、`config.js` | `ports.js` 无 import；`config.js` 只用 `node:*` | 互相 import、任何业务模块 |
| 组合根 | 根 `index.js` | 任意层 | 不承载业务逻辑（< 300 行，`check-architecture` 强制） |

补充：Host import 图必须无环（`check-architecture` 检查）。`application` 通过工厂参数接收端口实现
（依赖倒置），端口接口用 JSDoc 写在 `src/host/ports.js`（纯类型，不产生运行时依赖）。
`RouteError`（HTTP 请求错误：状态码 + 中文文案）同样通过工厂参数注入 application，而不是 import，
所以 application 不依赖传输层，`http/handler.js` 只做 `instanceof` 映射。

### 3.2 目录与模块职责

```
index.js                    # 组合根：export inject = ['webServer']; export function apply(ctx)
                            #   wire(config) -> infrastructure -> application -> operations -> http handler
src/host/
  config.js                 # 运行期路径与常量：DATA_DIR/STATE_DIR/DB_FILE/TTS_CACHE_DIR/ROUTE_PREFIX/...
  ports.js                  # JSDoc 端口类型：ProgressRepository/DataRepository/SpeechEngine/LlmGateway/...
  domain/                   # 纯函数，无 IO
    constants.js            # LESSON_STEPS / GRADES / LESSON_STATUS / MAX_TEXT / TTS 语速上下限
    srs.js                  # FSRS-lite：gradeCard、due 计算、卡片归一化、localDayKey
    progress.js             # 进度模型：emptyProgress / normalizeProgress
    views.js                # 只读视图：lessonStateOf、到期数、解锁规则、复习队列条目
    ai-grade.js             # AI 批改的入参清洗、模型输出解析、prompt 构造
  application/              # 用例；只写“做什么”，不碰 SQLite/文件/模型细节
    progress.js             # 进度读写单元：load/save/mutate（串行锁）/reset/appendReviewLog
    payload.js              # 请求体字段读取小工具（readString 等，application 内共享）
    content.js              # info / index / lesson / wordbank / phonetics / progress 读操作
    learning.js             # lesson/status、video/save、word/star
    review.js               # review/queue、review/grade、review/answer
    grading.js              # paper/grade（默认模型批改 + 修复轮 + 10min 缓存）
    explain.js              # paper/explain（错题 AI 讲解 + 10min 缓存）
    speech.js               # tts（文本校验 + 语音引擎 + WAV 响应）
    translate.js            # translate/list|add|remove + 翻译历史自动导入
  infrastructure/           # 适配器：唯一允许碰 OS/DB/网络/模型的层
    fs-utils.js             # readJsonFile / writeAtomic / safeJson
    progress-repository.js  # node:sqlite（schema/读写/迁移/回退 JSON/复习日志）
    data-repository.js      # data/ 只读加载 + wordLookup 缓存
    speech-engine.js        # macOS say 检测/选音色/渲染 + tts 缓存
    llm.js                  # profile 默认模型解析、流式文本收集、失败诊断文件
    translate-history.js    # 只读翻译插件 history.json
  http/                     # 传输层，不认识任何业务 op
    errors.js               # RouteError(status, message)
    security.js             # 回环 Host + 浏览器标记校验
    json.js                 # readJsonBody / writeJson
    handler.js              # createHandler({ operations, ctx })，统一错误→状态码映射
```

### 3.3 组合根与端口注入

`index.js` 是唯一知道“具体实现”的地方（模块作用域构建容器，保持重构前的进程单例语义；
DB 与数据仍然懒加载；`apply` 只做 HTTP handler 装配与路由挂载）：

```js
export const inject = ['webServer']

const config = createConfig()
const progressRepository = createProgressRepository(config)   // infrastructure
const dataRepository = createDataRepository(config)
const progressService = createProgressService({ repository: progressRepository }) // application
const contentOperations = createContentOperations({ dataRepository, progressService, /* ... */ })

/** op name -> async (payload, { ctx, res }) */
const operations = { ...contentOperations, /* ... */ }

export function apply(ctx) {
  const handler = createHandler({ operations, ctx, routePrefix: config.routePrefix, maxBodyBytes: config.maxBodyBytes })
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix', path: config.routePrefix, handler,
  }), 'dsh-nce: /dsh-nce/api routes')
}
```

要点：
- `operations` 是 `op name -> async (payload, { ctx, res })` 的映射；`http/handler.js` 只做
  信任校验 / POST 校验 / body 解析 / 分发 / 错误映射，不含业务分支。`ctx` 只用于让 paper-grade
  通过 LLM 端口解析默认模型；`res` 只用于 `/tts` 写原始 WAV 字节。
- 新增一个 API op = domain（若需要纯逻辑）+ application 用例 + 组合根注册 + `docs/API-CONTRACT.md`；
  不允许在 `http/` 里写业务判断。
- 懒初始化语义保持不变：DB 首次访问才打开、进度首次读才加载。

### 3.4 行为契约（重构/改代码都必须保持）

- API 形状与端口：`docs/API-CONTRACT.md`（`{ok}` 包络、错误码/中文错误文案）。
- 持久化：`docs/PERSISTENCE.md`（SQLite schema v1、WAL、旧 JSON 一次性迁移、损坏回退、热备份/重置方式）。
- 安全：只接受回环 Host + 浏览器标记的同源 POST；请求体 ≤ 64 KiB；TTS 文本 ≤ 300 字符。
- 缓存：数据文件、词表、AI 批改 / 错题讲解（各 10 min）各一份模块级缓存，行为与命中条件不得改变。
- 朗读：`/dsh-nce/api/tts` 返回原始 `audio/wav`，client 优先走翻译插件 `/dsh-translate/api/tts`，失败回落本路由，
  再失败回退浏览器 Web Speech。

## 4. Client 半：分层 fragment 架构

### 4.1 构建模型

`scripts/build-client.mjs` 把 fragment 按 **两位数字前缀升序** 拼进同一个
`window.__ModuleLoader__.load({ id: 'dsh-nce', factory(require) { ... } })` factory 作用域，输出 `client.js`。

- **不许 `import`/`export`**：fragment 共享同一作用域，裸符号名就是跨文件接口。
- 前缀在 `src/client/` 与 `src/client/generated/` 之间必须全局唯一。
- `client.js` 是构建产物，不手改；`npm run build` 重新生成，`npm run build:check` 校验是否最新。
- React 只能通过 factory 的 `require('react')` 获取（仅 `00-platform.js` 允许）。

### 4.2 层带与文件（编号即依赖顺序）

| 前缀 | 文件 | 职责 | 允许依赖 |
|---|---|---|---|
| 00 | `00-platform.js` | React 绑定、`NS/PANEL_ID/PANEL_ORDER`、`CSS_PARTS/addCss`、纯工具函数 | — |
| 01 | `01-domain.js` | 纯视图模型：课状态/到期/解锁、`LESSON_STEPS/GRADES/COPY`、`LessonArray` | 00 |
| 02 | `02-persistence.js` | localStorage 适配：prefs / nav / 滚动位置 / UI flag（`PREFS_KEY/NAV_KEY/readScrollOffset/writeScrollOffset/readUiFlag/writeUiFlag/useScrollMemory`） | 00 |
| 03 | `03-api.js` | Host API 客户端 `api(op, payload, {signal})` | 00 |
| 04 | `04-tts.js` | 朗读基础设施：翻译插件 TTS 桥、浏览器回退、音频状态、`playText/useSpeaking` | 00 |
| 05 | `05-data.js` | 数据 hooks：`useRemote/useIndex/useWordbank/usePhonetics/useLesson` + 缓存 | 00/03 |
| 06 | `06-store.js` | 学习状态 store：`NceProvider/useNce`（导航 + 进度乐观更新） | 00–05 |
| 07 | `07-ui.js` | 设计系统：`Icon/Btn/Chip/Section/Empty/Loading/ErrorBox/Stat/Bar/Modal/Speaker/VoiceMenu/Badge` | 00–04 |
| 08 | `08-styles.js` | 面板基础 CSS（宿主 token、box-sizing、滚动链） | 00 |
| 09 | `09-pdf-export.js` | 独立浏览器 PDF 导出能力（IIFE，暴露 `window.PaperPdfExport` 等） | — |
| 10 | `10-paper-engine.js` | **纯** 练习卷解析/判分引擎（无 React/DOM/网络） | — |
| 14 | `generated/14-bilibili.js` | B 站分 P 映射（`build-bilibili.mjs` 生成，勿手改） | — |
| 11 | `11-mistake-rows.js` | 纯错题视图 `PaperWrongRows`（判错/近似行 → 题干/答案/参考） | 10 |
| 15 | `15-mistakes.js` | 错题本 localStorage 存储与同步 `mistakesList/mistakesSyncLesson/mistakesSyncPaper/mistakesRemove/mistakesClearLesson/useMistakeCount` | 00, 11 |
| 30 | `30-paper-ui.js` | 练习卷 UI/草稿持久化/错题本同步/PDF 集成 `LessonExerciseTab` | 00–15 |
| 31 | `31-flow-ui.js` | 练习区里的作业清单（localStorage 勾选）与课堂跟读 `LessonHomeworkChecklist/LessonPracticeBlocks` | 00–07 |
| 32 | `32-lesson-tabs.js` | 单课内容区块：视频/课文/单词/语法（含对话行、笔记块）`LessonVideoSection/LessonTextSection/LessonWordsSection/LessonGrammarSection/LessonNoteBlock/LessonDialogueLine` + 锚点映射 `LessonAnchorOf` | 00–14 |
| 33 | `33-lesson-page.js` | 单课页壳 `LessonPage`（页头、吸顶锚点条 `LessonAnchorBar`、区块容器 `LessonSection`、步骤开关 `LessonStepToggle`、区块滚动） | 00–32 |
| 40 | `40-home.js` | 课程首页两区域：`CourseRow`（每行 3 个步骤小点）+ 内嵌 `LessonPage` | 00–33 |
| 50 | `50-words.js` | 记忆卡库 `WordsPage`（浏览/筛选/收藏/翻卡/翻译卡） | 00–06 |
| 60 | `60-review.js` | 复习队列 `ReviewPage`（SRS 结算） | 00–07 |
| 70 | `70-phonetics.js` | 音标与自然拼读 `PhoneticsPage` | 00–07 |
| 80 | `80-mistakes.js` | 错题本页面 `MistakesPage`（按课分组/筛选/去重做/已掌握/AI 讲解/历史练习卷回填）+ 样式 | 00–15 |
| 99 | `99-entry.js` | ModuleLoader 包装 + `apply(ctx)` 注册 slot + 错误边界 + 样式注入 | 全部页面 |

**依赖规则（`check-architecture` 强制）**：
- `NN` fragment 只能引用 `MM < NN` fragment 声明的符号；反向引用 = 失败。
- 每个 fragment 声明的符号必须至少被引用一次（不留死代码/死导出）。
- `01-domain.js` 与 `10-paper-engine.js` 必须是纯的：禁止 `document/window/globalThis/localStorage/fetch/require/React/h/addCss/hooks/api()`。
- `generated/` 下的文件必须带 `GENERATED by scripts/...` 横幅，由脚本生成、禁止手改。
- 手写 fragment 单文件 ≤ 1500 行；超了按层带拆新文件（不要塞回旧文件）。
- 文件头 `// Layer: NN` 必须存在且与文件名前缀一致；顶层 `return` 之后不能再有代码（否则是死代码）。
- **CSS 单源**：同一个 selector 不允许在两个 fragment 里给出不同声明——CSS 的 cascade 依赖 fragment 顺序，
  重复定义会在重排文件时静默改变视觉；确属有意的覆盖（如 `.nce-scroll` 打印布局）必须写进
  `check-architecture.mjs` 的 `CSS_ORDER_ALLOWLIST` 并注明理由。

### 4.3 跨 fragment 契约（不能改的名字）

- 平台：`h/Fragment/NS/PANEL_ID/PANEL_ORDER/CSS_PARTS/addCss/cx/clamp/pct/dayKey/todayKey/normWord/errorMessage/sleep/isAbortError`
- 领域：`LESSON_STEPS/GRADES/DONE_STEP_KEYS/COPY/dueLabel/lessonTitle/lessonStateOf/doneLessonCount/startedLessonIds/isWordUnlocked/nextUnlockLessonId/dueWordCount/videoEmbedUrl/LessonArray`
- 数据/持久化/API：`PREFS_KEY/NAV_KEY/DEFAULT_PREFS/readNav/writeNav/readPrefs/writePrefs/readScrollOffset/writeScrollOffset/readUiFlag/writeUiFlag/useScrollMemory/API_BASE/api`
- 朗读/数据/Store：`playText/useSpeaking/useTtsInfo/useRemote/useIndex/useWordbank/usePhonetics/useLesson/NceProvider/useNce`
- UI：`Icon/Btn/Chip/Section/Empty/Loading/ErrorBox/Stat/Bar/Speaker/VoiceMenu/Badge`
- 领域数据/课程/页面：`BILIBILI_SOURCE/bilibiliEpisodes/bilibiliEmbedUrl/bilibiliPageUrl`、
  `PaperBuildModel/PaperEvaluate/PaperAiRows/PaperWrongRows/PaperReadState/LessonExerciseTab`、
  `mistakesList/mistakesRemove/mistakesSetExplain/mistakesSyncLesson/mistakesSyncPaper/mistakesClearLesson/useMistakeCount/MistakesPage`、
  `LessonAnchorOf/LessonVideoSection/LessonTextSection/LessonWordsSection/LessonGrammarSection`、
  `LessonHomeworkChecklist/LessonPage`、`HomePage/WordsPage/MistakesPage/ReviewPage/PhoneticsPage`、
  入口 `PAGES/NAV_ITEMS/Root/Shell/App/PanelErrorBoundary/NceIcon/inject/apply`
- 需要增删这些符号时：先改 `scripts/check-architecture.mjs` 的 `REQUIRED_CLIENT_SYMBOLS` 与本表，再动代码。

### 4.4 页面与导航

- `99-entry.js` 的 `PAGES = { home: HomePage, words: WordsPage, mistakes: MistakesPage, review: ReviewPage, phonetics: PhoneticsPage }`；
  `lesson` 不是独立路由，课程详情是 `home` 页右栏（`LessonPage { embedded: true }`）。
- 顶部导航有 4 个入口：`课程 / 记忆卡 / 错题本 / 音标&自然拼读`（`NAV_ITEMS`，错题本带待掌握数量角标）；`review` 页挂在记忆卡这条线上，
  `nav.page` 的白名单是 `home`/`words`/`mistakes`/`review`/`phonetics`（旧存档里的 `plan` 会回落到 `home`）。
- `nav`（page/lessonId/tab）持久化到 `localStorage['dsh-nce/nav/v1']`；面板重挂载恢复上次页面。
- `nav.tab` 是一次性锚点：单课页跳转后清空（`clearLessonTab`）；重挂载时不会重复跳转，而是恢复滚动位置。
- 单课页内导航靠锚点（`LessonAnchorOf`）：`nav` 的 `tab` 存锚点 id
  `video`（视频）/ `text`（课文）/ `words`（单词）/ `grammar`（语法）/ `exercise`（练习）。
  旧 tab id 自动映射（`preview→text`、`video→video`、`words→words`、`grammar→grammar`、
  `homework`/`exercise→exercise`、`recall`/`review→空`），深链/存档不失效。

### 4.5 面板状态与本地持久化

- 滚动位置：`localStorage['dsh-nce/scroll/v1/<视图>']`（`page:<页面>` / `lesson:<课号>` / `course-list`），
  由 `useScrollMemory` 监听滚动并在面板卸载前落盘、重挂载时按帧恢复（DSH 切换会话会卸载面板）。
- 单课视频展开：`localStorage['dsh-nce/ui/v1/video-open:<课号>']`（默认折叠，展开后记住）。
- 错题本：`localStorage['dsh-nce/mistakes/v1']`（`课号:题号` → 题干/你的答案/参考答案/AI 点评/错误或近似/时间），
  由练习卷 UI 在批改后同步，页面只读；最多 600 条。
- 练习卷草稿：`localStorage['dsh-nce/paper/v1/lesson-<id>']`（answers/marks/graded/revealed/ai），判分纯本地。
- 课后作业勾选：`localStorage['dsh-nce/homework/v1/lesson-<id>']`（任务序号数组）。
- 偏好：`localStorage['dsh-nce/prefs/v1']`（音色/速度/自动朗读/每日新词上限）。
- 进度只走 `useNce()` 暴露的方法（乐观更新 + `lesson/status`、`review/grade` 落盘），组件不直接改 state。
- 朗读链：翻译插件 `/dsh-translate/api/tts` → `/dsh-nce/api/tts`（macOS `say`）→ 浏览器 Web Speech；
  音色列表来自翻译插件 `/dsh-translate/api/info`，插件停用时用 `FALLBACK_VOICES`。

### 4.6 UI 纪律

- 只用宿主主题 token：`--dsw-alias-*`、`--dsw-specific-sidebar-fill`；禁止写死颜色（朗读波形等装饰除外）。
- 面板根 `.nce-root` 自建 `box-sizing: border-box`；滚动链由面板内部负责，不改 body。
- 继承宿主字体/字号；中文 UI、英文内容原样；所有 class 以 `nce-` 前缀。
- 不读别的插件 DOM、不 append 到 `document.body`、不引入外部依赖（React 来自 factory 的 `require`）。
- 空态/加载/错误三态给全；列表 key 稳定；错误边界 `PanelErrorBoundary` 包住整个面板（渲染异常显示错误文本而非空白）。

## 5. 数据与持久化

- 内置内容：`data/index.json`（课程索引+分组）、`data/lessons/lesson-001..144.json`、`data/wordbank.json`、
  `data/phonetics.json`；`build-data.mjs` 从外部结构化内容目录（`NCE_CONTENT_DIR`，结构见 `docs/DATA-CONTRACT.md`）
  生成前三份，`build-phonetics.mjs` 生成音标页（内容手写在该脚本内）；运行时不联网。
- 学习数据：`~/.dsh/dsh-nce/nce.sqlite`（WAL），旧 `progress.json` 首次自动迁移，`node:sqlite` 不可用时回退 JSON。
  详见 `docs/PERSISTENCE.md`。
- 可再生成片段：`generated/14-bilibili.js`（`npm run build:bilibili`，默认走线上分 P API，`--from` 用离线 JSON）。
- 课程视频链接由用户保存到 progress（`video/save`），不写进数据文件。

## 6. 架构护栏与验证

```bash
npm run build            # 重新生成 client.js（拼接所有 fragment）
npm run build:check      # 校验 client.js 是否与 fragment 同步（不写文件）
npm run check:architecture  # 分层/依赖顺序/死代码/纯度/文档路径（见下）
npm test                 # 全套（会先重建 client.js）：architecture + client-load + lesson-page + paper + paper-ui + ai-grade + host-domain + host API smoke
```

`check-architecture.mjs` 强制执行（失败即退出非 0）：

- Host：分层 import 白名单（支持多行 import）、无环、无孤儿模块、import 目标必须存在、
  组合根 < 300 行且导出 `inject/apply`。
- Client：前缀唯一且升序、无 import/export、单向依赖（只能引用更早 fragment）、无死符号、
  纯 fragment 无 React/DOM/IO、`99-entry.js` 最后且注册 ModuleLoader、必选跨文件符号存在、
  Layer 头与文件名一致、顶层 return 之后无死代码、CSS selector 单源（见上）。
- 文档：README/docs（顶层）/scripts 不得引用旧扁平文件名；文档里提到的 `src/client/**`、`src/host/**`、`scripts/**`
  必须真实存在。内部审计存档（不随仓库分发）记录的是当时（重构前）的文件布局，不在该规则内。

测试矩阵：

| 命令 | 覆盖 |
|---|---|
| `node scripts/test-paper.mjs` | 练习卷解析/判分引擎（真实 144 课数据，~19500 断言） |
| `node scripts/test-ai-grade.mjs` | AI 批改入参清洗/模型输出解析/prompt（纯函数，无网络） |
| `node scripts/test-host-domain.mjs` | SRS、进度归一化、课程状态/解锁、AI 批改解析 |
| `node scripts/test-client-load.mjs` | 构建产物在 `node:vm` 沙箱里加载 + 假 React 渲染各页面初始态（无浏览器；只覆盖加载态，交互/视觉需真机） |
| `node scripts/test-lesson-page.mjs` | 单课一页式：页头、锚点条、区块布局与 3 个步骤开关（假 React，无浏览器） |
| `node scripts/test-mistakes.mjs` | 错题本：错题行提取、同步/去重、历史回填、页面渲染与 AI 讲解按钮 |
| `node scripts/test-explain.mjs` | 错题 AI 讲解：入参清洗、prompt、输出清理、路由/缓存/503/502 |
| `HOME=$(mktemp -d) node scripts/smoke-api.mjs` | 真实 handler 的全 API 契约（SQLite 迁移、缓存、错误码、安全校验） |

## 7. 开发流程

**加一个页面/功能**
1. 先确定层带：纯逻辑先进 `domain`（Host）或 `01-domain`/新纯 fragment（Client），UI 再包一层；
2. Client 新 fragment 用当前层带内未占用的两位前缀，头部写 `// Layer: NN ...`，接线只引用更早 fragment；
3. 跨文件新符号 → 更新 §4.3 契约表与 `check-architecture.mjs`；
4. `npm run build && npm test`。

**加一个 Host API op**
1. 纯规则进 `src/host/domain/`；用例进 `src/host/application/`，通过端口依赖 IO；
2. 组合根注册 operation，`http/` 不写业务分支；
3. 在 `docs/API-CONTRACT.md` 补一行契约；`npm test`。

**改课程/词库数据**
- 课程：改 `scripts/build-data.mjs`（或源数据）→ `npm run build:data`；
- 视频分 P：`npm run build:bilibili`（联网）或 `--from offline.json`。

**改了 Host 半或内置数据后**：需要重启一次 DSH（宿主模块与数据缓存都在进程内）。

## 8. 已知边界与技术债（后续打磨方向，不改行为前先登记）

- Host 的 AI 批改依赖 profile 默认模型；无模型时必须优雅降级（自评），不能报错阻塞学习。
- 客户端所有排版/配色都靠手写 CSS + 宿主 token，没有设计系统抽层；改视觉时优先抽 `07-ui` 组件与 CSS token。
- CSS 的 cascade 依赖 fragment 编号顺序：新增/拆分 fragment 时，若移动了带新 selector 的 `addCss` 块，
  必须跑 `npm test`（`check-architecture` 的 CSS 单源规则会拦住重复定义，但拦不住“新 selector 之间的顺序”）。
- `09-pdf-export.js` 是独立 IIFE，通过 `window.PaperPdfExport` 暴露给 30-paper-ui；如要彻底模块化需改 build 机制，
  当前有意保持不变（零依赖、离线可用）。
- 数据质量（练习卷 OCR 残留、重复词）见 `docs/DATA-QUALITY.md`，属于内容债，不与架构债混在一起修。
