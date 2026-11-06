# dsh-nce 数据契约

> 所有文件 UTF-8、无 BOM、2 空格缩进；缺失字段用 `[]` / `""`，不要 `undefined`/`NaN`。
> 生成目录：插件目录下的 `data/`（构建产物；**教材内容受版权保护，`data/` 已被 .gitignore 排除、不随仓库分发**）。
> 源数据：结构化内容目录，由 `NCE_CONTENT_DIR` 指定（只读），需含 `nce1/`、`notes/`、`gwb/`；
> 未设置该变量时构建脚本读取插件目录下的 `data/content/`。

## 1. `data/index.json`

```json
{
  "generatedAt": "2026-11-03T19:00:00+08:00",
  "book": {
    "id": "nce1",
    "title": "新概念英语 第一册",
    "en": "New Concept English 1",
    "lessonCount": 144,
    "vocabTotal": 907
  },
  "groups": [
    { "id": "a", "title": "第 1–30 课", "from": 1, "to": 30 },
    { "id": "b", "title": "第 31–67 课", "from": 31, "to": 67 },
    { "id": "c", "title": "第 68–111 课", "from": 68, "to": 111 },
    { "id": "d", "title": "第 112–144 课", "from": 112, "to": 144 }
  ],
  "lessons": [
    {
      "id": 1,
      "titleEn": "Excuse me!",
      "titleZh": "对不起！",
      "group": "a",
      "pages": [5, 6],
      "vocabCount": 11,
      "dialogueCount": 7,
      "exerciseCount": 0,
      "notesCount": 9,
      "gwbCount": 30
    }
  ]
}
```

`notesCount` = 课堂笔记 block 数；`gwbCount` = 练习册题目条目数。课程顺序按 id 升序。

## 2. `data/lessons/lesson-001.json`（144 个，文件名补零 3 位）

```json
{
  "id": 1,
  "titleEn": "Excuse me!",
  "titleZh": "对不起！",
  "group": "a",
  "pages": { "textbook": [5, 6] },
  "question": { "en": "Whose handbag is it?", "zh": "这是谁的手袋？" },
  "dialogue": [
    { "speaker": "", "en": "Excuse me!", "zh": "对不起。" },
    { "speaker": "STEVEN", "en": "Hello, Helen.", "zh": "你好，海伦。" }
  ],
  "translation": [ { "speaker": "", "zh": "对不起。" } ],
  "vocab": [
    { "word": "excuse", "phonetic": "/ɪkˈskjuːz/", "pos": "v.", "meaning": "原谅", "example": "" }
  ],
  "textNotes": [ { "num": 1, "en": "Excuse me.", "zh": "这个短语常用于……" } ],
  "exercises": [
    {
      "label": "A",
      "titleEn": "Complete these sentences using am or is.",
      "titleZh": "完成以下句子。",
      "note": ["Word list: ..."],
      "table": [["", ""], ["", ""]],
      "example": [ { "en": "My name __ is __ Xiaohui.", "zh": "" } ],
      "items": [ { "num": 1, "text": "My name ___ Robert. I ___ a student." } ]
    }
  ],
  "notes": [
    {
      "page": 9,
      "tags": ["Words", "Grammar"],
      "blocks": [
        { "type": "vocab", "title": "handbag n.", "phonetic": "/ˈhændbæɡ/", "lines": ["hand+bag", "/æ/ /e/"] },
        { "type": "grammar", "title": "Where 特殊疑问句", "phonetic": "", "lines": ["含义：哪里?", "特殊疑问句 = 特殊疑问词 + 一般疑问句"] }
      ]
    }
  ],
  "gwb": {
    "pages": [15, 16],
    "sections": [
      {
        "label": "I.",
        "titleEn": "Practise \"My name is ...\" according to the example",
        "titleZh": "仿照例句练习说“我叫⋯⋯”。",
        "example": [ { "en": "pen pencil book coat", "zh": "" } ],
        "items": [ { "num": 1, "text": "A: What's your name? (Ken Baker)\nB: My name is Ken Baker." } ]
      }
    ],
    "answers": [ { "label": "I.", "lines": ["1. My name is Ken Baker.", "2. ..."] } ]
  }
}
```

练习册 section 还可能有 `table`（二维字符串数组，原书表格，如 lesson 110 信息表/成绩表）和
`wordBox`（字符串数组，`Use the words in the box…` 词框）；有 `table` 时 `example` 里可能是同一份内容的 OCR 平铺，
渲染端优先显示 table。配对题（`Match the questions in Column A with the answers in Column B` / 「在 B 栏中找出…」/「左右两边搭配」）
在 section 上额外带一个 `matching` 结构：`items` 只保留 A 栏（左栏）行，B 栏选项与题号→字母答案放在
`matching` 里，练习卷据此渲染成真正的 A/B 两栏并按字母自动判分。普通 section 没有这个字段。

```json
{
  "label": "III.",
  "titleEn": "Match the questions in Column A with the answers in Column B",
  "titleZh": "在B栏中找出与A栏中问题相对应的答案。",
  "example": [],
  "items": [ { "num": 1, "text": "How is Tony today?" } ],
  "matching": {
    "leftTitle": "A",
    "rightTitle": "B",
    "left": [ { "num": 1, "text": "How is Tony today?" } ],
    "right": [ { "letter": "a", "text": "I'm very well, thank you." } ],
    "key": { "1": ["e"] },
    "keyNote": [],
    "keyLines": ["1 → e. He's very well, thank you."]
  }
}
```

说明：

- `exercises` 来自课文 `data/content/nce1/lesson-XXX.json`（约一半课程有）；没有就 `[]`。
- `notes` 来自课堂笔记 `data/content/notes/lesson-XXX.json`，把 pages 合并为数组；`type` 保持原值
  （vocab/grammar/practice/homework 等）。
- `gwb` 来自语法练习册 `data/content/gwb/lesson-XXX.json`，题目和答案都给；`sections[].example` 是词框/语段提示（字符串数组归一为 `[{en,zh}]`），`items` 非空才保留 section。
- `items[].text` 可以包含 `\n`：一个题号下多行提问时按行拆分渲染。语法练习册题还可带可选的
  `items[].exampleAnswers`（字符串数组）：印刷示例的逐行答案（如 lesson 10 I. 的 `No, I'm not.` / `Yes, I am.`）。
- `answers[].lines` 的回车/number 结构决定逐行答案：`Ask and answer…`/`Make dialogues…` 大题按答案册的问句/答句行
  逐行拆分（如 lesson 19 I、42 I、44 I），没有编号的整段答案可按每题一行/每个空一行写入，引擎会按空白数映射
  （lesson 55 II、73 II、78 II）。答案里的斜杠按「换行」或「同一个空的两种说法」两种语义处理，代词对
  （`ours/yours`、`I/we`）视为同一答句的变体。
- 含 ASCII 数字的音标（OCR 把 /ɜː/ 认成 3、/θ/ 认成 0）一律置空，不输出错误音标。
- 缺源文件/字段时用空结构，不要编造。

## 3. `data/wordbank.json`

```json
{
  "generatedAt": "…",
  "total": 780,
  "words": [
    {
      "key": "handbag",
      "word": "handbag",
      "phonetic": "/ˈhændbæɡ/",
      "pos": "n.",
      "meaning": "（女用）手提包",
      "example": "",
      "lessons": [1, 25],
      "firstLesson": 1,
      "variantCount": 1
    }
  ]
}
```

- `key = word.trim().toLowerCase()`（去多余空格；`thank you` 保留空格）。同 key 合并 `lessons`（升序去重）。
- `phonetic/pos/meaning/example` 取第一条非空；`variantCount` = 原始出现次数。
- 排序：`firstLesson` 升序 → `key` 字典序。
- 过滤纯数字/空词；`word` 至少含一个字母。

## 4. `data/phonetics.json`

```json
{
  "generatedAt": "…",
  "intro": "音标与自然拼读学习页说明（中文，2–4 句）",
  "groups": [
    { "id": "vowels", "title": "元音", "hint": "12 个单元音 + 8 个双元音" }
  ],
  "phonemes": [
    {
      "id": "i-long",
      "ipa": "iː",
      "group": "vowels",
      "kind": "long",
      "zh": "长元音 /iː/",
      "letters": "ee, ea, e, ie",
      "tips": "嘴角向两侧拉开，舌前部抬高，发音比 /ɪ/ 长而紧。",
      "examples": [ { "word": "see", "phonetic": "/siː/", "zh": "看见" } ],
      "words": ["see", "tea", "green"]            // 词库里能查到、供筛选的例词（≤8）
    }
  ],
  "phonics": [
    {
      "id": "short-a",
      "grapheme": "a",
      "position": "闭音节 (CVC)",
      "sound": "/æ/",
      "rule": "单字母 a 在辅音结尾的闭音节里读 /æ/：c-a-t。",
      "examples": [ { "word": "cat", "phonetic": "/kæt/", "zh": "猫" } ]
    }
  ],
  "minimalPairs": [
    { "a": "ship", "b": "sheep", "ipaA": "/ʃɪp/", "ipaB": "/ʃiːp/", "focus": "/ɪ/ vs /iː/", "zh": "短音 i 与长音 ee" }
  ],
  "syllableRules": [
    { "id": "open-syllable", "title": "开音节", "rule": "元音结尾的音节通常读长音：name /neɪm/。", "examples": ["name", "hi", "go"] }
  ]
}
```

要求：`phonemes` 覆盖 48 个 IPA（20 元音 + 28 辅音，含 8 双元音）；`phonics` ≥ 20 条常见
字母/组合规则；`minimalPairs` ≥ 15 对；`words` 尽量取自 wordbank（构建脚本可校验，查不到就删）。
英文标注要准确，中文讲解口语化、面向零基础。

## 5. 校验

`scripts/build-data.mjs` 结束打印：课程数、缺课、词库数、每课平均单词数；并写
`data/_report.json`（counts + issues，构建后抽查用）。构建须可重复执行、幂等。

> 实际构建结果：144 课 / 词库 866 词（原始 907 条去重合并）/ 音标 48 / 拼读 38 / 最小对立对 22 / 音节规则 6。
