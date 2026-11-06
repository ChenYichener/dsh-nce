# 数据与持久化

NCE 的学习数据存在本机 **SQLite** 里（`node:sqlite` 内置模块，无第三方依赖），另有一份一次性迁移用的 JSON。
本文说明存了什么、怎么读写、怎么备份/重置。

## 1. 位置

| 内容 | 路径 |
| --- | --- |
| 学习数据（主存储） | `~/.dsh/dsh-nce/nce.sqlite`（+ `-wal` / `-shm`） |
| 旧版 JSON（仅迁移用） | `~/.dsh/dsh-nce/progress.json`，首次成功后改名为 `progress.json.migrated-<时间戳>` |
| 朗读缓存 | 与翻译插件共用 `~/.dsh/dsh-translate/tts-cache/`；离线兜底 `~/.dsh/dsh-nce/tts-cache/` |
| UI 偏好 | 浏览器 `localStorage` → `dsh-nce/prefs/v1`（音色/速度/自动朗读/每日新词上限） |
| 练习卷草稿 | 浏览器 `localStorage` → `dsh-nce/paper/v1/lesson-<课号>`（每课一份；不进 SQLite、不随数据库备份） |
| 课后作业勾选 | 浏览器 `localStorage` → `dsh-nce/homework/v1/lesson-<课号>`（任务序号数组；每课一份） |
| 课程页位置 | 浏览器 `localStorage` → `dsh-nce/nav/v1`（`{page,lessonId,tab}`，`tab` 现在是单课页内的锚点 id，见下） |
| 滚动位置 | 浏览器 `localStorage` → `dsh-nce/scroll/v1/<视图>`：`page:<页面>`（记忆卡/复习/音标等页面）、`lesson:<课号>`（单课右侧详情）、`course-list`（左侧课程列表）；面板被 DSH 卸载重挂时恢复 |
| 单课视频展开 | 浏览器 `localStorage` → `dsh-nce/ui/v1/video-open:<课号>`（`1` 表示展开；没有记录时默认折叠） |
| 错题本 | 浏览器 `localStorage` → `dsh-nce/mistakes/v1`（`课号:题号` 为键：题干、你的答案、参考答案、AI 点评、错误/近似、时间、AI 讲解 `explain`；最多 600 条；由练习卷批改自动同步，AI 讲解按题缓存，「已掌握」删除） |
| 课程内容 | 插件目录 `data/`（只读，不写入） |

`nav.tab` 存的是单课一页式的**锚点 id**：`video`（视频）/ `text`（课文）/ `words`（单词）/
`grammar`（语法）/ `exercise`（练习），空串 = 不跳转。`nav.page` 只有 `home` / `words` / `mistakes` / `review` / `phonetics`
四种（旧存档里的 `plan` 会回落到 `home`）。读取旧存档时会自动映射旧的 tab id，不会报错：
`preview→text`（课文）、`video→video`（视频）、`words→words`、`grammar→grammar`、
`homework`/`exercise→exercise`（练习）、`recall`/`review→空`（只打开单课页顶部）。

`nav.tab` 是一次性的跳转指令：单课页处理完锚点后会立即清空，所以之后面板重挂载时不会又跳一次，
而是恢复该课上次的滚动位置（`dsh-nce/scroll/v1/lesson:<课号>`）。页面位置、滚动位置、单课视频展开状态
都属于面板 UI 状态：DSH 切换会话/菜单会卸载并重新挂载面板，这三类状态都会自动恢复。

`GET` 不到数据库时（例如未来换了不支持 `node:sqlite` 的 Electron），宿主会自动回退到 JSON 文件存储，
API 与 UI 行为不变；`/api/info` 的 `storage.mode` 会显示 `sqlite` 或 `json`。

## 2. 表结构（schema_version = 1）

```sql
meta           (key TEXT PRIMARY KEY, value TEXT)            -- schema_version / updated_at
lessons        (lesson_id INTEGER PK, status, steps_json, updated_at, last_visit)
words          (word_key TEXT PK, starred, right_count, wrong_count, srs_json, updated_at)
videos         (lesson_id INTEGER PK, url, updated_at)
daily_history  (day TEXT PK, reviews INTEGER)
streak         (singleton INTEGER PK CHECK(singleton=1), last_day, days, total_days)
reviews        (id INTEGER PK AUTOINCREMENT, word_key, grade, created_at, due_before, due_after)
translation_cards (key TEXT PK, record_id, direction, source, translation, notes, examples_json, created_at, added_at)
```

- `lessons.steps_json` 存 3 个学习步骤（`{"words":...,"grammar":...,"exercise":...}`）。旧数据里的
  `preview` / `review` 键在读取时会被丢弃，课程状态（学习中 / 已学完）和 `words`/`grammar`/`exercise` 保留。
- `words.srs_json` 存卡片的 SRS 字段（due/stability/scheduledDays/state/reps/lapses…）
- `reviews` 是追加日志（每次评分一行），用于后续统计/复习曲线，目前只写不读
- `translation_cards` 存从翻译插件自动同步的句子卡；SRS/收藏仍复用 `words` 表（key 形如 `tr:<recordId>`）
- 被移除的翻译卡记在 `meta.translate_dismissed`（JSON），自动同步会跳过这些记录
- 旧版的 `tasks` 表与 `meta.plan` 键已不再使用：打开数据库时会清理（`tasks` 表删除、`meta.plan` 键删除）；
  旧 `progress.json` 里的 `plan` / `tasks` 字段在读取时丢弃，`streak` / `history` 保留（记忆卡复习页仍在用）
- 翻译历史本体不复制：只在加入时快照 source/translation/notes 到卡里，原文仍由翻译插件管理
- `PRAGMA journal_mode = WAL`，读不阻塞写

## 3. 读写路径

- **启动/首次访问**：打开数据库 → 建表 → 清掉旧版遗留的 `tasks` 表与 `meta.plan` 键 → 若 `meta.schema_version`
  不存在，则把旧的 `progress.json` 导入一次（成功后改名备份），然后读入内存。
- **写操作**：`lesson/status`、`video/save`、`word/star`、`review/grade`、`review/answer`、`progress/reset`
  → 在内存对象上修改 → `progressLock` 串行化 → 一个事务内刷新 lessons/words/videos/daily_history/streak。
  `review/grade` 额外向 `reviews` 追加一行。
- **读操作**：直接读内存中的 `progressState`；重启后从数据库恢复。
- **损坏容错**：数据库打不开/读失败时回退 JSON；旧 JSON 损坏时会改名为 `progress.json.corrupt-<时间戳>` 再空状态启动。

## 4. 备份 / 恢复 / 重置

```bash
# 热备份（WAL 模式下安全）
sqlite3 ~/.dsh/dsh-nce/nce.sqlite ".backup '/tmp/nce-backup.sqlite'"

# 恢复：先退出 DSH（或至少停用插件），再把备份文件覆盖回去
# 重置全部学习进度（会清空数据，需显式确认）；<port> 换成当前 DSH Web 端口
curl -X POST http://127.0.0.1:<port>/dsh-nce/api/progress/reset \
  -H 'content-type: application/json' -d '{"confirm":"reset"}'
```

也可以直接用 SQL 查询，例如：

```sql
-- 每天复习量
SELECT day, reviews FROM daily_history ORDER BY day DESC LIMIT 14;
-- 最容易错的词
SELECT word_key, wrong_count FROM words WHERE wrong_count > 0 ORDER BY wrong_count DESC LIMIT 10;
-- 已学完课程
SELECT COUNT(*) FROM lessons WHERE status = 'done';
```

## 5. 边界

- 单用户、单宿主进程；写入由 `progressLock` 串行化，不需要跨进程锁。
- 目前只有 `schema_version`，没有逐版本 migration 框架；改表结构时升版本并在打开时做兼容处理。
- `reviews` 表会缓慢增长（每次评分一行，量级很小），未来可加按年归档。
- 不做云同步；要跨设备同步时，同步 `nce.sqlite`（先 checkpoint）或改用外部存储即可。
