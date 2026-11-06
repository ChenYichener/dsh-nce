# dsh-nce Host API 契约

- 前缀：`POST /dsh-nce/api/<op>`，JSON 请求/响应，`{ ok: true, ... }` / `{ ok: false, error }`。
- 只接受同源回环请求（loopback Host + 浏览器标记），其它 403。
- 进度落盘：SQLite `~/.dsh/dsh-nce/nce.sqlite`（`node:sqlite`，WAL，串行事务写入）；旧 `progress.json` 首次打开自动迁移；
  `node:sqlite` 不可用时回退 JSON `~/.dsh/dsh-nce/progress.json`。详见 `docs/PERSISTENCE.md`。
- 数据只读内置 `data/`；视频链接和进度写 progress。

## ops

| op | payload | 返回 |
|---|---|---|
| `info` | `{}` | `{ ok, book:{id,title,lessonCount,vocabTotal}, dataDir, storage:{mode:'sqlite'|'json', file, legacyFile, dbFile}, progressFile, wordCount, hasPhonetics, ttsEngine, translateHistory }` |
| `progress/reset` | `{ confirm:'reset' }` | `{ ok, progress, storage }`（清空 SQLite 所有表或回退 JSON 文件；客户端未暴露入口） |
| `index` | `{}` | `{ ok, index }`（= data/index.json） |
| `lesson` | `{ id }` | `{ ok, lesson }`（= data/lessons/lesson-XXX.json，另加 `progress` 里该课状态与视频） |
| `wordbank` | `{}` | `{ ok, wordbank }` |
| `phonetics` | `{}` | `{ ok, phonetics }` |
| `progress` | `{}` | `{ ok, progress }`（lesson/status 也附带整份 progress，客户端据此刷新） |
| `lesson/status` | `{ id, status?, steps? }` | `{ ok, lesson, progress }`（缺省字段不改；status ∈ learning/done/**unseen**，unseen 会删除该课记录；`steps` 只接受 3 个学习步骤 `words`/`grammar`/`exercise`，旧 `preview`/`review` 键会被丢弃） |
| `video/save` | `{ id, url }` | `{ ok, video }`（url 空串=删除；只允许 http(s)） |
| `word/star` | `{ key, starred }` | `{ ok, word: {...} }` |
| `review/queue` | `{ limitNew?=10, limitTranslationNew?=3, includeLocked?=false, syncTranslate?=true }` | `{ ok, queue: [{key, word, phonetic, pos, meaning, example, lesson, lessons, card, isNew}], dueCount, newCount, counts:{new,learning,due,total,lockedNew}, unlocked:{lessons,newCount,lockedNew,nextLesson}, today, dayCount, streak }`（默认只发已开始课程的新卡，`includeLocked:true` 解除限制） |
| `review/grade` | `{ key, grade:'again'|'hard'|'good'|'easy' }` | `{ ok, card, word:{key,word,phonetic,pos,meaning,lesson}, streak:{lastDay,days,totalDays}, todayCount }` |
| `review/answer` | `{ key, correct }` | 选义练习记一次对错（可选，用于记忆卡测验） |
| `translate/list` | `{ syncTranslate?=true }` | `{ ok, available, total, addedCount, records:[{id,createdAt,direction,study,source,translation,notes,added}] }`（`syncTranslate` 时先自动导入新记录；返回并标记哪些已加入） |
| `translate/add` | `{ id }` / `{ ids:[...] }` / `{ recent:N }` | `{ ok, added:[key], progress }`（把翻译记录提升为 `tr:<id>` 句子卡，`recent` 最多 20） |
| `translate/remove` | `{ id }` | `{ ok, removed:key, progress }`（同时删除对应 SRS，并记入 `translateDismissed` 不再自动加入） |
| `paper/grade` | `{ lessonId, items:[{ id, prompt, answer, group?, example?, reference? }] }`（≤30 题/次；题面/答案各 ≤500 字，`example`=本组上下文（示范/词框/表格/配对 B 栏）≤400 字，`reference`=答案册参考 ≤400 字） | `{ ok, source:'ai', model, items:[{ id, verdict:'correct'\|'close'\|'wrong', comment, answer }], cached?, repaired? }`（**整卷 AI 批改**：把全部已作答的题交给 profile 默认模型当老师，答案册参考答案随 `reference` 一起给模型；90s 超时、10min 同参缓存、解析失败自动重排一次；没有默认模型返回 503，模型返回非法 JSON 返回 502；未知 id/verdict 一律丢弃） |
| `paper/explain` | `{ lessonTitle?, group?, prompt, answer?, reference?, verdict?, comment? }`（题面 ≤800 字；学生答案 ≤500；参考答案 ≤400；AI 点评 ≤300） | `{ ok, source:'ai', model, text, cached? }`（**错题 AI 讲解**：把 `prompt/answer/reference/comment` 交给 profile 默认模型，让英语老师解释正确答案、错因（语法点）和记忆要点；45s 超时、10min 同参缓存；没有默认模型 503，模型空输出 502） |
| `tts` | `{ text, rate? }` | `audio/wav` 原始字节（Content-Type: audio/wav）；文本 ≤ 300 字符。**降级用**：client 优先调用翻译插件 `/dsh-translate/api/tts`（同一批 Edge 音色），失败才回落到本路由（macOS `say`） |
| `search` | `{ q }` | 未实现（客户端本地过滤，文档保留占位） |

## progress 视图形状（物理存储在 SQLite，API 仍返回同一形状）

```json
{
  "version": 1,
  "updatedAt": 0,
  "streak": { "lastDay": "2026-11-03", "days": 3, "totalDays": 3 },
  "history": { "2026-11-03": 24 },
  "lessons": {
    "1": { "status": "learning", "steps": { "words": true, "grammar": false, "exercise": false }, "updatedAt": 0, "lastVisit": 0 }
  },
  "words": {
    "handbag": { "starred": true, "srs": { "due": "2026-11-04T00:00:00.000Z", "stability": 1, "difficulty": 5, "scheduledDays": 1, "learningSteps": 0, "reps": 1, "lapses": 0, "state": 1, "lastReview": "2026-11-03T10:00:00.000Z" }, "right": 3, "wrong": 1 }
  },
  "videos": { "1": "https://www.bilibili.com/video/BV..." }
}
```

进度里不再有 `plan` / `tasks` 字段：旧 `progress.json` 或旧数据库里的这两个字段在加载时会被丢弃，
只保留 `streak` / `history`（记忆卡复习页仍在使用）。

### SRS 算法（host 实现，客户端只送 grade）

简化 FSRS-lite：

- `again`：`state=1`（learning），`due=now+1min`，`lapses+1`，`reps+1`，`right` 不加。
- `hard`：`due=now+10min`，`learningSteps=1`。
- `good`：首次 `due=now+1d`（`scheduledDays=1`），复习阶段 `interval = max(1, round(stability*2.5))` 天。
- `easy`：首次 `due=now+4d`（`scheduledDays=4`），后续 `interval = max(2, round(stability*3.5))` 天。
- `stability` 初始 1，good 后 `stability = interval`；每次成功评分 `reps+1`、`state>=1`。
- `due` 按当天 00:00 本地时间取整，`review/queue` 取 `due <= now` 的旧卡 + 未学过的新卡（受 `limitNew` 限制）。
- **新卡解锁**：新卡只从「已开始学习」的课程里取（`progress.lessons` 有记录；全新 profile 默认解锁第 1 课），
  最近学的课优先；到期旧卡不受此限制。`unlocked.nextLesson` 是下一门可解锁新卡的课。
- 每天首次评分时更新 `streak` 与 `history[today]`。
