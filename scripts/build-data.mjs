#!/usr/bin/env node
/**
 * dsh-nce 数据构建脚本（T1）
 *
 * 把一个结构化的内容目录（只读）转换成插件内置数据：
 *   data/index.json                课程索引 + 4 个分组
 *   data/lessons/lesson-001.json…  144 课：课文 / 对话 / 生词 / 注释 / 练习 / 课堂笔记 / 练习册
 *   data/wordbank.json             全册去重词库
 *   data/_report.json              构建统计、缺失数据与问题清单
 *
 * 契约：docs/DATA-CONTRACT.md §1–3、§5。
 * 只用 Node 内置模块；可重复执行、幂等（每次先清空 data/lessons 再写）。
 *
 * 源内容不在本仓库内（教材内容受版权保护，data/ 已被 .gitignore 排除）。
 * 内容目录需包含 `nce1/`、`notes/`、`gwb/` 三个子目录，结构见 docs/DATA-CONTRACT.md。
 *
 * 用法：
 *   NCE_CONTENT_DIR=/path/to/nce-content node scripts/build-data.mjs
 *   node scripts/build-data.mjs   # 未设置时读取 data/content/（已被 gitignore）
 *
 * 注意：绝不修改源目录与 data/phonetics.json（由 scripts/build-phonetics.mjs 生成）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// 路径与常量
// ---------------------------------------------------------------------------

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(scriptDir, '..');
const outDir = path.join(pluginDir, 'data');
const lessonsOutDir = path.join(outDir, 'lessons');

// 源内容目录：由 NCE_CONTENT_DIR 指定（旧变量名 NCE_CONTENT_ROOT 仍兼容）；
// 未设置时使用插件目录下被 gitignore 的 data/content/。教材内容受版权保护，
// 不随仓库分发，构建前必须自带一份符合 docs/DATA-CONTRACT.md 的结构化内容。
const contentEnv = process.env.NCE_CONTENT_DIR || process.env.NCE_CONTENT_ROOT;
const contentRoot = contentEnv
  ? path.resolve(contentEnv)
  : path.join(pluginDir, 'data', 'content');
const nce1Dir = path.join(contentRoot, 'nce1');
const notesDir = path.join(contentRoot, 'notes');
const gwbDir = path.join(contentRoot, 'gwb');

if (!fs.existsSync(path.join(nce1Dir, 'index.json'))) {
  console.error('build-data: 源内容目录不存在或不完整：' + contentRoot);
  console.error('  需要包含 nce1/index.json、nce1/、notes/、gwb/，结构见 docs/DATA-CONTRACT.md。');
  console.error('  请设置 NCE_CONTENT_DIR=/path/to/nce-content 后重试（本次未写入任何文件）。');
  process.exit(1);
}

const LESSON_COUNT = 144;

// DATA-CONTRACT §1：分组固定为 a=1–30, b=31–67, c=68–111, d=112–144
const GROUPS = [
  { id: 'a', title: '第 1–30 课', from: 1, to: 30 },
  { id: 'b', title: '第 31–67 课', from: 31, to: 67 },
  { id: 'c', title: '第 68–111 课', from: 68, to: 111 },
  { id: 'd', title: '第 112–144 课', from: 112, to: 144 },
];

const pad3 = (n) => String(n).padStart(3, '0');
const rel = (p) => path.relative(pluginDir, p) || '.';

// ---------------------------------------------------------------------------
// 通用工具：读 / 清洗 / 写
// ---------------------------------------------------------------------------

const issues = [];
const missing = [];
const addIssue = (message) => issues.push(message);

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

function writeJson(file, value) {
  const bad = findBadValue(value, '$');
  if (bad) throw new Error(`${rel(file)} 含非法值：${bad}`);
  const text = `${JSON.stringify(value, null, 2)}\n`;
  fs.writeFileSync(file, text, 'utf8');
  return Buffer.byteLength(text);
}

/** 递归找出 null / undefined / NaN —— 契约要求缺失字段用 [] 或 ""。 */
function findBadValue(value, at) {
  if (value === null) return `${at} 为 null`;
  if (value === undefined) return `${at} 为 undefined`;
  if (typeof value === 'number' && !Number.isFinite(value)) return `${at} 为非有限数字`;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const found = findBadValue(value[i], `${at}[${i}]`);
      if (found) return found;
    }
  } else if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      const found = findBadValue(item, `${at}.${key}`);
      if (found) return found;
    }
  }
  return '';
}

/** 任意值 → 去首尾空白的字符串；null/undefined/数字等一律归 ""。 */
function cleanStr(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** 生词 word 清洗：OCR 偶尔把音标/词性粘在词后（如 "dry/dral adj"），只保留斜杠前的词头。 */
function cleanVocabWord(value) {
  let word = cleanStr(value);
  if (!word) return '';
  const head = word.search(/[\/;]/);
  if (head > 0) word = word.slice(0, head).trim();
  word = word.replace(/\s+/g, ' ').replace(/^[^A-Za-z]+/, '').replace(/[^A-Za-z0-9'.\-]+$/g, '').trim();
  return word;
}

/** 音标清洗：OCR 常把 /ɜː/ 认成 "3"、/θ/ 认成 "0"，含 ASCII 数字的音标一律视为破损。 */
function cleanPhonetic(value) {
  const phonetic = cleanStr(value);
  return /[0-9]/.test(phonetic) ? '' : phonetic;
}

/** 练习册 section.example：词框是字符串数组，语段是 [{en,zh}]，统一成 [{en,zh}]。 */
function cleanGwbExample(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    if (typeof item === 'string') {
      const en = cleanStr(item);
      if (en) out.push({ en, zh: '' });
    } else if (item !== null && typeof item === 'object') {
      const en = cleanStr(item.en);
      const zh = cleanStr(item.zh);
      if (en || zh) out.push({ en, zh });
    }
  }
  return out;
}

/** 数组 → 字符串数组（过滤非字符串并 trim，保留空串以保真）。 */
function cleanStrList(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === 'string').map((item) => item.trim());
}

/** 数组 → 有限数字数组。 */
function cleanNumList(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === 'number' && Number.isFinite(item));
}

function cleanNum(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** 课文 exercises.example：[{en, zh}]；字符串条目包成 {en, zh:""}。 */
function cleanExample(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    if (typeof item === 'string') {
      const en = cleanStr(item);
      if (en) out.push({ en, zh: '' });
    } else if (item && typeof item === 'object') {
      const en = cleanStr(item.en);
      const zh = cleanStr(item.zh);
      if (en || zh) out.push({ en, zh });
    }
  }
  return out;
}

/** 课文 exercises.table：二维字符串表格。 */
function cleanTable(value) {
  if (!Array.isArray(value)) return [];
  return value.map((row) => (Array.isArray(row) ? row.map(cleanStr) : [cleanStr(row)]));
}

/**
 * 题目条目：[{num, text}]。
 * 源数据个别条目缺 num（gwb lesson 102），按数组序号补齐，并在 issues 里记录。
 */
function cleanItems(value, onMissingNum) {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => {
    const num = cleanNum(item && item.num, 0);
    const text = cleanStr(item && item.text);
    if (!num && typeof onMissingNum === 'function') onMissingNum(index + 1, text);
    const output = { num: num || index + 1, text };
    // 多问题目：书上每个小问各有一条答案线（如 lesson 10 I. 的示例）；
    // 可选的 exampleAnswers 逐行给出示例答案，练习卷按行渲染。
    const exampleAnswers = cleanStrList(item && item.exampleAnswers);
    if (exampleAnswers.length > 0) output.exampleAnswers = exampleAnswers;
    return output;
  });
}

// ---------------------------------------------------------------------------
// 练习册配对题（Match Column A with Column B）结构还原
//
// 扫描版的数据把两栏按“行优先”OCR 成每条 item = “A 栏一行 \n B 栏选项”，
// 直接按行渲染会让 A 问题和 B 选项错配（用户反馈过 lesson 9 III 看不懂）。
// 这里从 title + items + example + answers 还原出真正的结构：
//   { left:[{num,text}], right:[{letter,text}], key:{num:[letters]}, keyNote }
// 插件练习卷按这个结构渲染成 A/B 两栏并支持按字母判分。
// ---------------------------------------------------------------------------

const GWB_MATCH_EN = /^match\b/i;
// 只认“栏 / 搭配 / 左右两边 / 连线”这类真正的配对题；避免误伤
// “用 while 连接下列各句”这种 combine 题（lesson 117）。
const GWB_MATCH_ZH = /搭配|左右两边|栏|连线/;
const GWB_MATCH_OPTION_RE = /^\s*([a-z])\s*[.、)）]\s*(.+)$/i;
// 同一行里挤了多个选项："i. chocolate / j. paper"
const GWB_MATCH_SPLIT_RE = /\s*\/\s*(?=[a-z]\s*[.、)）])/i;
const GWB_MATCH_BLANK_RE = /_{2,}/g;

function gwbIsMatchingSection(section) {
  const en = cleanStr(section && section.titleEn);
  const zh = cleanStr(section && section.titleZh);
  return GWB_MATCH_EN.test(en) || GWB_MATCH_ZH.test(zh);
}

function gwbCleanMatchLeft(text) {
  let out = cleanStr(text)
    .replace(/^\s*\d{1,2}\s*[.、)）]\s*/, '')
    .replace(GWB_MATCH_BLANK_RE, ' … ')
    .replace(/\s+/g, ' ')
    .trim();
  if (out.endsWith(' …')) return out; // "Air …"
  return out;
}

function gwbCleanMatchRight(text) {
  const raw = cleanStr(text);
  const hadBlank = GWB_MATCH_BLANK_RE.test(raw);
  GWB_MATCH_BLANK_RE.lastIndex = 0;
  let out = raw.replace(GWB_MATCH_BLANK_RE, ' ').replace(/\s+/g, ' ').trim();
  if (hadBlank && out !== '') out = `… ${out}`;
  return out;
}

function gwbAddMatchOption(right, seen, letter, text) {
  const value = String(letter || '').toLowerCase();
  if (!/^[a-z]$/.test(value)) return;
  const body = gwbCleanMatchRight(text);
  if (body === '') return;
  const existing = seen.get(value);
  if (existing !== undefined) {
    // 同一字母在 OCR 里拆成两行：拼回去
    existing.text = `${existing.text} ${body}`.replace(/\s+/g, ' ').trim();
    return;
  }
  const option = { letter: value, text: body };
  seen.set(value, option);
  right.push(option);
}

function gwbCollectMatchOptions(lines, right, seen) {
  let current = null;
  for (const rawLine of lines) {
    const line = cleanStr(rawLine);
    if (line === '') continue;
    for (const chunk of line.split(GWB_MATCH_SPLIT_RE)) {
      const part = cleanStr(chunk);
      if (part === '') continue;
      const match = part.match(GWB_MATCH_OPTION_RE);
      if (match !== null) {
        gwbAddMatchOption(right, seen, match[1], match[2]);
        current = seen.get(match[1].toLowerCase()) ?? null;
      } else if (current !== null) {
        current.text = `${current.text} ${part}`.replace(/\s+/g, ' ').trim();
      }
    }
  }
}

function gwbParseMatchingKey(lines) {
  const key = {};
  const keyNote = [];
  for (const rawLine of Array.isArray(lines) ? lines : []) {
    const line = cleanStr(rawLine);
    if (line === '') continue;
    if (/注\s*[:：]/.test(line)) {
      keyNote.push(line);
      continue;
    }
    const pattern = /(?:^|[\s.、])?(\d{1,2})\s*[-–—]\s*([a-z](?:\s*[,，、/]\s*[a-z])*)/gi;
    let match = pattern.exec(line);
    while (match !== null) {
      const num = Number(match[1]);
      const letters = Array.from(match[2].matchAll(/[a-z]/gi)).map((item) => item[0].toLowerCase());
      if (Number.isFinite(num) && num > 0 && letters.length > 0) {
        if (!key[num]) key[num] = [];
        for (const letter of letters) if (!key[num].includes(letter)) key[num].push(letter);
      }
      match = pattern.exec(line);
    }
  }
  return { key, keyNote };
}

/**
 * 还原一个配对题 section。返回 null 表示不是配对题。
 * @param {object} section 源 section（items / example / titleEn / titleZh）
 * @param {object} rawAnswer 源 answers 里与 section.label 对应的 {lines}
 */
function buildGwbMatchingSection(section, rawAnswer) {
  if (!gwbIsMatchingSection(section)) return null;
  const items = Array.isArray(section.items) ? section.items : [];
  if (!items.length) return null;
  const left = [];
  const right = [];
  const seen = new Map();
  for (const item of items) {
    const lines = String((item && item.text) || '').split('\n').map(cleanStr).filter(Boolean);
    if (!lines.length) continue;
    const numText = cleanNum(item && item.num, 0);
    const num = numText || left.length + 1;
    left.push({ num, text: gwbCleanMatchLeft(lines[0]) });
    gwbCollectMatchOptions(lines.slice(1), right, seen);
  }
  // lesson 81 这种 A 栏在 items、B 栏在 example 的版式
  if (right.length === 0) {
    const exampleLines = [];
    for (const entry of Array.isArray(section.example) ? section.example : []) {
      const text = typeof entry === 'string' ? entry : cleanStr(entry && entry.en);
      if (text !== '') exampleLines.push(text);
    }
    gwbCollectMatchOptions(exampleLines, right, seen);
  }
  if (!left.length || right.length < 2) return null;
  const answerLines = rawAnswer && Array.isArray(rawAnswer.lines) ? rawAnswer.lines : [];
  const parsedKey = gwbParseMatchingKey(answerLines);
  const matching = {
    left,
    right,
    key: parsedKey.key,
    keyNote: parsedKey.keyNote,
    keyLines: [],
  };
  if (Object.keys(matching.key).length === 0) {
    matching.key = {};
  } else {
    const byLetter = new Map(right.map((option) => [option.letter, option.text]));
    for (const row of left) {
      const letters = matching.key[row.num] || [];
      if (!letters.length) continue;
      matching.keyLines.push(`${row.num} → ${letters.map((letter) => `${letter}. ${byLetter.get(letter) || ''}`).join(' / ')}`);
    }
  }
  return matching;
}

/** 当前本地时间 → 带时区偏移的 ISO 字符串（如 2026-11-03T19:29:30+08:00）。 */
function isoLocal(date = new Date()) {
  const pad2 = (n) => String(Math.abs(n)).padStart(2, '0');
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const hh = pad2(Math.floor(Math.abs(offsetMinutes) / 60));
  const mm = pad2(Math.abs(offsetMinutes) % 60);
  return (
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}` +
    `T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}${sign}${hh}:${mm}`
  );
}

function groupOf(id) {
  const group = GROUPS.find((item) => id >= item.from && id <= item.to);
  return group ? group.id : '';
}

/** 摘要显示 id 列表：超过 24 个时省略中间，完整列表见 _report.json 的 gaps。 */
function formatIds(ids) {
  if (!ids.length) return '';
  if (ids.length <= 24) return ids.join(', ');
  return `${ids.slice(0, 12).join(', ')} … ${ids.slice(-3).join(', ')}（共 ${ids.length} 节课）`;
}

// ---------------------------------------------------------------------------
// 读取源索引（分组 / 标题回退）
// ---------------------------------------------------------------------------

const sourceIndex = readJson(path.join(nce1Dir, 'index.json'));
const sourceIndexLessons = new Map();
if (sourceIndex && Array.isArray(sourceIndex.lessons)) {
  for (const item of sourceIndex.lessons) {
    if (item && typeof item === 'object' && Number.isFinite(item.id)) sourceIndexLessons.set(item.id, item);
  }
}
if (!sourceIndexLessons.size) {
  addIssue('源索引 nce1/index.json 缺失或格式异常：课程标题仅取自单课文件。');
}

// ---------------------------------------------------------------------------
// 统计容器
// ---------------------------------------------------------------------------

const stats = {
  vocabRaw: 0, // 课文生词条目总数（含跨课重复）
  lessonsWithVocab: 0,
  lessonsWithDialogue: 0,
  lessonsWithTranslation: 0,
  lessonsWithTextNotes: 0,
  lessonsWithExercises: 0,
  dialogueLines: 0,
  translationLines: 0,
  textNotes: 0,
  questionCount: 0,
  exercises: 0,
  exerciseItems: 0,
  exercisesEmptyItems: [],
  notesPages: 0,
  notesBlocks: 0,
  lessonsWithNotes: 0,
  notesBlocksEmptyLines: 0,
  gwbSections: 0,
  gwbMatchingSections: 0,
  gwbItems: 0,
  gwbAnswers: 0,
  gwbAnswerLines: 0,
  lessonsWithGwb: 0,
  gwbSectionsWithExample: 0,
  phoneticOcrDropped: [],
  gwbMissingTitleZh: [],
  missingItemNum: [],
  vocabEmptyMeaning: [],
  cleanedVocabWords: [],
};

const gaps = {
  missingLessonFiles: [],
  missingNotesFiles: [],
  missingGwbFiles: [],
  emptyQuestion: [],
  emptyDialogue: [],
  emptyTranslation: [],
  emptyTextNotes: [],
  emptyVocab: [],
  emptyExercises: [],
};

const indexLessons = [];
const sourceLessons = new Map(); // id → 输出后的单课数据（供词库合并）

// ---------------------------------------------------------------------------
// 单课构建
// ---------------------------------------------------------------------------

function buildLesson(id) {
  const fileId = pad3(id);
  const group = groupOf(id);
  const indexEntry = sourceIndexLessons.get(id);

  // 源分组校验（分组以契约固定区间为准，源分组不一致时记录问题）
  const sourceGroup = cleanStr(indexEntry && indexEntry.group);
  if (sourceGroup && sourceGroup !== group) {
    addIssue(`lesson-${fileId}：源索引分组为 "${sourceGroup}"，与契约分组 "${group}" 不一致，已按契约分组输出。`);
  }

  const raw = readJson(path.join(nce1Dir, `lesson-${fileId}.json`));
  if (!raw || typeof raw !== 'object') {
    gaps.missingLessonFiles.push(id);
    missing.push(`nce1/lesson-${fileId}.json`);
    return {
      id,
      titleEn: cleanStr(indexEntry && indexEntry.titleEn),
      titleZh: cleanStr(indexEntry && indexEntry.titleZh),
      group,
      pages: { textbook: [] },
      question: { en: '', zh: '' },
      dialogue: [],
      translation: [],
      vocab: [],
      textNotes: [],
      exercises: [],
      notes: [],
      gwb: { pages: [], sections: [], answers: [] },
    };
  }

  if (cleanNum(raw.id, 0) !== id) {
    addIssue(`lesson-${fileId}：源文件 id=${JSON.stringify(raw.id)} 与文件编号不一致，已按文件编号 ${id} 输出。`);
  }

  const titleEn = cleanStr(raw.titleEn) || cleanStr(indexEntry && indexEntry.titleEn);
  const titleZh = cleanStr(raw.titleZh) || cleanStr(indexEntry && indexEntry.titleZh);
  if (!titleEn || !titleZh) {
    addIssue(`lesson-${fileId}：缺少${!titleEn ? ' titleEn' : ''}${!titleZh ? ' titleZh' : ''}。`);
  }

  // --- 预习：问题 / 对话 / 参考译文 -----------------------------------------
  const rawQuestion = (raw.question && typeof raw.question === 'object') ? raw.question : {};
  const question = { en: cleanStr(rawQuestion.en), zh: cleanStr(rawQuestion.zh) };
  if (!question.en && !question.zh) {
    gaps.emptyQuestion.push(id);
  } else {
    stats.questionCount += 1;
  }

  const dialogue = (Array.isArray(raw.dialogue) ? raw.dialogue : []).map((line) => ({
    speaker: cleanStr(line && line.speaker),
    en: cleanStr(line && line.en),
    zh: cleanStr(line && line.zh),
  }));
  if (!dialogue.length) {
    gaps.emptyDialogue.push(id);
  } else {
    stats.lessonsWithDialogue += 1;
    stats.dialogueLines += dialogue.length;
  }

  const translation = (Array.isArray(raw.translation) ? raw.translation : []).map((line) => ({
    speaker: cleanStr(line && line.speaker),
    zh: cleanStr(line && line.zh),
  }));
  if (!translation.length) {
    gaps.emptyTranslation.push(id);
  } else {
    stats.lessonsWithTranslation += 1;
    stats.translationLines += translation.length;
  }

  // --- 生词 ---------------------------------------------------------------
  const rawVocab = Array.isArray(raw.vocab) ? raw.vocab : [];
  const vocab = rawVocab.map((item) => {
    const rawWord = cleanStr(item && item.word);
    const word = cleanVocabWord(rawWord);
    if (word !== rawWord) stats.cleanedVocabWords.push(`lesson-${pad3(id)}:${JSON.stringify(rawWord)}→${JSON.stringify(word)}`);
    const rawPhonetic = cleanStr(item && item.phonetic);
    const phonetic = cleanPhonetic(rawPhonetic);
    if (phonetic !== rawPhonetic) stats.phoneticOcrDropped.push(`lesson-${pad3(id)}:${word || '?'} ${rawPhonetic}→""`);
    return {
      word,
      phonetic,
      pos: cleanStr(item && item.pos),
      meaning: cleanStr(item && item.meaning),
      example: cleanStr(item && item.example),
    };
  });
  stats.vocabRaw += vocab.length;
  if (!vocab.length) {
    gaps.emptyVocab.push(id);
  } else {
    stats.lessonsWithVocab += 1;
  }
  vocab.forEach((item) => {
    if (!item.meaning) stats.vocabEmptyMeaning.push(`${fileId}:${item.word || '?'}`);
  });

  // --- 课文注释 -----------------------------------------------------------
  const textNotes = (Array.isArray(raw.textNotes) ? raw.textNotes : []).map((note, index) => ({
    num: cleanNum(note && note.num, index + 1),
    en: cleanStr(note && note.en),
    zh: cleanStr(note && note.zh),
  }));
  if (!textNotes.length) {
    gaps.emptyTextNotes.push(id);
  } else {
    stats.lessonsWithTextNotes += 1;
    stats.textNotes += textNotes.length;
  }

  // --- 书面练习 -----------------------------------------------------------
  const rawExercises = Array.isArray(raw.exercises) ? raw.exercises : [];
  const exercises = rawExercises.map((exercise) => {
    const items = cleanItems(exercise && exercise.items, (num, text) => {
      stats.missingItemNum.push(`lesson-${fileId} exercises 第 ${num} 条（${text.slice(0, 24)}…）`);
    });
    if (!items.length) {
      stats.exercisesEmptyItems.push(`lesson-${fileId}/${cleanStr(exercise && exercise.label) || '?'}`);
    }
    return {
      label: cleanStr(exercise && exercise.label),
      titleEn: cleanStr(exercise && exercise.titleEn),
      titleZh: cleanStr(exercise && exercise.titleZh),
      note: cleanStrList(exercise && exercise.note),
      table: cleanTable(exercise && exercise.table),
      example: cleanExample(exercise && exercise.example),
      items,
    };
  });
  stats.exercises += exercises.length;
  stats.exerciseItems += exercises.reduce((sum, exercise) => sum + exercise.items.length, 0);
  if (!exercises.length) {
    gaps.emptyExercises.push(id);
  } else {
    stats.lessonsWithExercises += 1;
  }

  // --- 课堂笔记 -----------------------------------------------------------
  const rawNotes = readJson(path.join(notesDir, `lesson-${fileId}.json`));
  const notes = [];
  if (!rawNotes || typeof rawNotes !== 'object') {
    gaps.missingNotesFiles.push(id);
    missing.push(`notes/lesson-${fileId}.json`);
  } else {
    if (cleanNum(rawNotes.lesson, 0) !== id) {
      addIssue(`notes/lesson-${fileId}.json：lesson 字段=${JSON.stringify(rawNotes.lesson)} 与文件编号不一致。`);
    }
    for (const page of Array.isArray(rawNotes.pages) ? rawNotes.pages : []) {
      const blocks = (Array.isArray(page && page.blocks) ? page.blocks : []).map((block) => {
        const lines = cleanStrList(block && block.lines);
        if (!lines.length) stats.notesBlocksEmptyLines += 1;
        return {
          type: cleanStr(block && block.type),
          title: cleanStr(block && block.title),
          phonetic: cleanStr(block && block.phonetic),
          lines,
        };
      });
      notes.push({
        page: cleanNum(page && page.page, 0),
        tags: cleanStrList(page && page.tags).filter(Boolean),
        blocks,
      });
    }
    if (!notes.length) {
      addIssue(`notes/lesson-${fileId}.json 存在但没有 pages。`);
    }
  }
  const notesCount = notes.reduce((sum, page) => sum + page.blocks.length, 0);
  stats.notesPages += notes.length;
  stats.notesBlocks += notesCount;
  if (notesCount) stats.lessonsWithNotes += 1;

  // --- 语法练习册 ---------------------------------------------------------
  const rawGwb = readJson(path.join(gwbDir, `lesson-${fileId}.json`));
  const gwb = { pages: [], sections: [], answers: [] };
  if (!rawGwb || typeof rawGwb !== 'object') {
    gaps.missingGwbFiles.push(id);
    missing.push(`gwb/lesson-${fileId}.json`);
  } else {
    if (cleanNum(rawGwb.lesson, 0) !== id) {
      addIssue(`gwb/lesson-${fileId}.json：lesson 字段=${JSON.stringify(rawGwb.lesson)} 与文件编号不一致。`);
    }
    stats.lessonsWithGwb += 1;
    gwb.pages = cleanNumList(rawGwb.pages);
    const rawAnswers = (Array.isArray(rawGwb.answers) ? rawGwb.answers : []).map((answer) => ({
      label: cleanStr(answer && answer.label),
      lines: cleanStrList(answer && answer.lines),
    }));
    for (const section of Array.isArray(rawGwb.sections) ? rawGwb.sections : []) {
      if (!section || typeof section !== 'object') continue;
      const items = cleanItems(section.items, (num, text) => {
        stats.missingItemNum.push(`lesson-${fileId} gwb ${cleanStr(section.label) || '?'} 第 ${num} 条（${text.slice(0, 24)}…）`);
      });
      if (!items.length) continue; // 契约：sections 必须有 items 才保留
      const titleZh = cleanStr(section.titleZh);
      if (!titleZh) stats.gwbMissingTitleZh.push(`lesson-${fileId}/${cleanStr(section.label) || '?'}`);
      // 练习册 section 的 example（词框 / 语段提示）按 DATA-CONTRACT §2 输出为 [{en,zh}]。
      const example = cleanGwbExample(section.example);
      if (example.length > 0) stats.gwbSectionsWithExample += 1;
      const sectionLabel = cleanStr(section.label);
      const answerForSection = rawAnswers.find((answer) => answer.label === sectionLabel);
      // 配对题（Match Column A/B）：还原成 A/B 两栏 + 题号→字母答案，供练习卷按真实版式渲染。
      const matching = buildGwbMatchingSection(section, answerForSection);
      const output = {
        label: sectionLabel,
        titleEn: cleanStr(section.titleEn),
        titleZh,
        example,
        table: cleanTable(section.table),
        wordBox: cleanStrList(section.wordBox).filter((word) => word !== ''),
        note: cleanStrList(section.note).filter((line) => line !== ''),
        items,
      };
      if (matching) {
        output.matching = matching;
        output.items = matching.left.map((row) => ({ num: row.num, text: row.text }));
        stats.gwbMatchingSections += 1;
      }
      gwb.sections.push(output);
    }
    gwb.answers = rawAnswers;
    if (!gwb.sections.length) {
      addIssue(`gwb/lesson-${fileId}.json 存在但没有有效 sections。`);
    }
  }
  stats.gwbSections += gwb.sections.length;
  stats.gwbItems += gwb.sections.reduce((sum, section) => sum + section.items.length, 0);
  stats.gwbAnswers += gwb.answers.length;
  stats.gwbAnswerLines += gwb.answers.reduce((sum, answer) => sum + answer.lines.length, 0);

  // --- 页码 ---------------------------------------------------------------
  const textbookPages = cleanNumList(raw.pages && raw.pages.textbook);
  if (!textbookPages.length) {
    addIssue(`lesson-${fileId}：缺少 pages.textbook 页码。`);
  }

  // --- 组装单课（严格按 DATA-CONTRACT §2 的字段与顺序） -------------------
  return {
    id,
    titleEn,
    titleZh,
    group,
    pages: { textbook: textbookPages },
    question,
    dialogue,
    translation,
    vocab,
    textNotes,
    exercises,
    notes,
    gwb,
  };
}

// ---------------------------------------------------------------------------
// 1) 构建 144 课
// ---------------------------------------------------------------------------

for (let id = 1; id <= LESSON_COUNT; id += 1) {
  const lesson = buildLesson(id);
  sourceLessons.set(id, lesson);

  const exerciseCount = lesson.exercises.reduce((sum, exercise) => sum + exercise.items.length, 0);
  const notesCount = lesson.notes.reduce((sum, page) => sum + page.blocks.length, 0);
  const gwbCount = lesson.gwb.sections.reduce((sum, section) => sum + section.items.length, 0);

  indexLessons.push({
    id: lesson.id,
    titleEn: lesson.titleEn,
    titleZh: lesson.titleZh,
    group: lesson.group,
    pages: lesson.pages.textbook,
    vocabCount: lesson.vocab.length,
    dialogueCount: lesson.dialogue.length,
    exerciseCount,
    notesCount,
    gwbCount,
  });
}

// ---------------------------------------------------------------------------
// 2) 词库（DATA-CONTRACT §3）
// ---------------------------------------------------------------------------

const wordMap = new Map();
const skippedWords = [];
const suspiciousWords = [];

for (const lesson of sourceLessons.values()) {
  for (const item of lesson.vocab) {
    const word = item.word.replace(/\s+/g, ' ').trim();
    if (!word || !/[A-Za-z]/.test(word)) {
      skippedWords.push(`lesson-${pad3(lesson.id)}:${JSON.stringify(item.word)}`);
      continue;
    }
    const key = word.toLowerCase();
    let entry = wordMap.get(key);
    if (!entry) {
      entry = {
        key,
        word,
        phonetic: '',
        pos: '',
        meaning: '',
        example: '',
        lessons: [],
        firstLesson: lesson.id,
        variantCount: 0,
      };
      wordMap.set(key, entry);
    }
    entry.variantCount += 1;
    if (!entry.lessons.includes(lesson.id)) entry.lessons.push(lesson.id);
    // 音标 / 词性 / 释义 / 例句取第一条非空
    if (!entry.phonetic) entry.phonetic = item.phonetic;
    if (!entry.pos) entry.pos = item.pos;
    if (!entry.meaning) entry.meaning = item.meaning;
    if (!entry.example) entry.example = item.example;
    // 疑似 OCR 噪声词条（word 里夹带音标/分号等），只记录不改写
    if (/[^A-Za-z0-9\s'.\- ]/.test(word)) suspiciousWords.push(`lesson-${pad3(lesson.id)}:${word}`);
  }
}

const words = [...wordMap.values()].sort((a, b) => {
  if (a.firstLesson !== b.firstLesson) return a.firstLesson - b.firstLesson;
  if (a.key < b.key) return -1;
  if (a.key > b.key) return 1;
  return 0;
});
for (const word of words) {
  word.lessons.sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// 3) 缺失数据 / 问题汇总（写进 _report.json）
// ---------------------------------------------------------------------------

if (gaps.missingLessonFiles.length) {
  addIssue(`缺少课文源文件 ${gaps.missingLessonFiles.length} 个：${formatIds(gaps.missingLessonFiles)}`);
}
if (gaps.missingNotesFiles.length) {
  addIssue(`缺少课堂笔记源文件 ${gaps.missingNotesFiles.length} 个：${formatIds(gaps.missingNotesFiles)}`);
}
if (gaps.missingGwbFiles.length) {
  addIssue(`缺少练习册源文件 ${gaps.missingGwbFiles.length} 个：${formatIds(gaps.missingGwbFiles)}`);
}

const gapLabels = [
  ['emptyDialogue', '对话 dialogue'],
  ['emptyTranslation', '参考译文 translation'],
  ['emptyTextNotes', '课文注释 textNotes'],
  ['emptyVocab', '生词 vocab'],
  ['emptyExercises', '课文练习 exercises'],
  ['emptyQuestion', '预习问题 question'],
];
for (const [key, label] of gapLabels) {
  if (gaps[key].length) {
    addIssue(`课文数据缺口：${label} 为空 ${gaps[key].length} 课：${formatIds(gaps[key])}（空结构已按契约输出）。`);
  }
}
if (stats.exercisesEmptyItems.length) {
  addIssue(`课文 exercises 中有 ${stats.exercisesEmptyItems.length} 个练习无 items（表格题/听写题等，保留原文）：${stats.exercisesEmptyItems.join('、')}`);
}
if (stats.gwbMissingTitleZh.length) {
  addIssue(`练习册有 ${stats.gwbMissingTitleZh.length} 个 section 缺 titleZh，已补空串：${stats.gwbMissingTitleZh.join('、')}`);
}
if (stats.missingItemNum.length) {
  addIssue(`题目缺 num 已按条目顺序补号 ${stats.missingItemNum.length} 处：${stats.missingItemNum.join('、')}`);
}
if (stats.gwbSectionsWithExample) {
  addIssue(`练习册有 ${stats.gwbSectionsWithExample} 个 section 含 example（词框/语段提示），已按 DATA-CONTRACT §2 输出。`);
}
if (stats.phoneticOcrDropped.length) {
  addIssue(`音标 OCR 噪声已清空 ${stats.phoneticOcrDropped.length} 条（含 ASCII 数字的破损音标）：${stats.phoneticOcrDropped.join('、')}`);
}
if (stats.notesBlocksEmptyLines) {
  addIssue(`课堂笔记有 ${stats.notesBlocksEmptyLines} 个 block 的 lines 为空（保留空数组）。`);
}
if (stats.vocabEmptyMeaning.length) {
  addIssue(`生词 meaning 为空 ${stats.vocabEmptyMeaning.length} 条（按契约保留空串）：${stats.vocabEmptyMeaning.join('、')}`);
}
if (skippedWords.length) {
  addIssue(`词库构建跳过 ${skippedWords.length} 条空词/纯数字词：${skippedWords.join('、')}`);
}
if (stats.cleanedVocabWords.length) {
  addIssue(`生词 word 清洗 ${stats.cleanedVocabWords.length} 条（斜杠后夹带的音标/词性已去掉）：${stats.cleanedVocabWords.join('、')}`);
}
if (suspiciousWords.length) {
  addIssue(`词库含 ${suspiciousWords.length} 个疑似 OCR 噪声词条（word 夹带音标/分号等，未改写，供后续人工校对）：${suspiciousWords.join('、')}`);
}

// ---------------------------------------------------------------------------
// 4) 生成 index / wordbank / report
// ---------------------------------------------------------------------------

const generatedAt = isoLocal();
const vocabTotal = stats.vocabRaw;

const index = {
  generatedAt,
  book: {
    id: 'nce1',
    title: '新概念英语 第一册',
    en: 'New Concept English 1',
    lessonCount: LESSON_COUNT,
    vocabTotal,
  },
  groups: GROUPS.map((group) => ({
    id: group.id,
    title: group.title,
    from: group.from,
    to: group.to,
  })),
  lessons: indexLessons,
};

const wordbank = {
  generatedAt,
  total: words.length,
  words,
};

const report = {
  generatedAt,
  source: contentRoot,
  output: outDir,
  counts: {
    lessons: indexLessons.length,
    lessonsMissing: gaps.missingLessonFiles.length,
    groups: GROUPS.length,
    words: words.length, // 去重词库词数
    vocabTotal, // 原始生词条目数（含跨课重复）
    cleanedVocabWords: stats.cleanedVocabWords.length,
    lessonsWithVocab: stats.lessonsWithVocab,
    lessonsWithDialogue: stats.lessonsWithDialogue,
    lessonsWithTranslation: stats.lessonsWithTranslation,
    lessonsWithTextNotes: stats.lessonsWithTextNotes,
    lessonsWithExercises: stats.lessonsWithExercises,
    lessonsWithNotes: stats.lessonsWithNotes,
    lessonsWithGwb: stats.lessonsWithGwb,
    dialogueLines: stats.dialogueLines,
    translationLines: stats.translationLines,
    textNotes: stats.textNotes,
    questionCount: stats.questionCount,
    exercises: stats.exercises,
    exerciseItems: stats.exerciseItems,
    notesPages: stats.notesPages,
    notesBlocks: stats.notesBlocks,
    notesBlocksEmptyLines: stats.notesBlocksEmptyLines,
    gwbSections: stats.gwbSections,
    gwbMatchingSections: stats.gwbMatchingSections,
    gwbItems: stats.gwbItems,
    gwbAnswers: stats.gwbAnswers,
    gwbSectionsWithExample: stats.gwbSectionsWithExample,
    phoneticOcrDropped: stats.phoneticOcrDropped.length,
    gwbAnswerLines: stats.gwbAnswerLines,
    avgVocabPerLesson: Number((stats.vocabRaw / LESSON_COUNT).toFixed(2)),
    avgWordsPerLesson: Number((words.length / LESSON_COUNT).toFixed(2)),
  },
  missing,
  issues,
  gaps,
};

// ---------------------------------------------------------------------------
// 5) 写盘（先清空 data/lessons，保证幂等；不动 data/phonetics.json）
// ---------------------------------------------------------------------------

fs.mkdirSync(outDir, { recursive: true });
fs.rmSync(lessonsOutDir, { recursive: true, force: true });
fs.mkdirSync(lessonsOutDir, { recursive: true });

let totalBytes = 0;
let maxLessonBytes = 0;
let maxLessonId = 0;
for (const lesson of sourceLessons.values()) {
  const bytes = writeJson(path.join(lessonsOutDir, `lesson-${pad3(lesson.id)}.json`), lesson);
  totalBytes += bytes;
  if (bytes > maxLessonBytes) {
    maxLessonBytes = bytes;
    maxLessonId = lesson.id;
  }
}

const indexBytes = writeJson(path.join(outDir, 'index.json'), index);
const wordbankBytes = writeJson(path.join(outDir, 'wordbank.json'), wordbank);
writeJson(path.join(outDir, '_report.json'), report);

// ---------------------------------------------------------------------------
// 6) 自检（不通过直接抛错，避免产出坏数据）
// ---------------------------------------------------------------------------

function assert(condition, message) {
  if (!condition) throw new Error(`自检失败：${message}`);
}

const writtenLessonFiles = fs.readdirSync(lessonsOutDir).filter((name) => /^lesson-\d{3}\.json$/.test(name));
assert(writtenLessonFiles.length === LESSON_COUNT, `lessons 文件数为 ${writtenLessonFiles.length}，应为 ${LESSON_COUNT}`);
assert(index.lessons.length === LESSON_COUNT, `index.lessons 长度为 ${index.lessons.length}`);
assert(index.lessons.every((lesson, i) => lesson.id === i + 1), 'index.lessons 未按 id 升序排列');
assert(wordbank.total === words.length && wordbank.words.length === words.length, 'wordbank.total 与 words 长度不一致');
assert(words.every((word) => word.key === word.key.trim().toLowerCase()), '词库 key 未规范化');
assert(words.every((word) => word.lessons.length > 0 && word.lessons[0] === word.firstLesson), '词库 firstLesson 与 lessons 不一致');
assert(
  words.every((word) => word.lessons.every((lessonId, i) => i === 0 || word.lessons[i - 1] < lessonId)),
  '词库 lessons 未升序去重',
);
assert(
  words.every((word, i) => i === 0 || words[i - 1].firstLesson < word.firstLesson || (words[i - 1].firstLesson === word.firstLesson && words[i - 1].key < word.key)),
  '词库排序不符合 firstLesson → key 规则',
);
for (const lesson of sourceLessons.values()) {
  const indexLesson = indexLessons[lesson.id - 1];
  assert(indexLesson.vocabCount === lesson.vocab.length, `lesson-${pad3(lesson.id)} vocabCount 不一致`);
  assert(indexLesson.dialogueCount === lesson.dialogue.length, `lesson-${pad3(lesson.id)} dialogueCount 不一致`);
  assert(
    indexLesson.exerciseCount === lesson.exercises.reduce((sum, exercise) => sum + exercise.items.length, 0),
    `lesson-${pad3(lesson.id)} exerciseCount 不一致`,
  );
  assert(
    indexLesson.notesCount === lesson.notes.reduce((sum, page) => sum + page.blocks.length, 0),
    `lesson-${pad3(lesson.id)} notesCount 不一致`,
  );
  assert(
    indexLesson.gwbCount === lesson.gwb.sections.reduce((sum, section) => sum + section.items.length, 0),
    `lesson-${pad3(lesson.id)} gwbCount 不一致`,
  );
}

const outputBytes = totalBytes + indexBytes + wordbankBytes;
assert(outputBytes < 4 * 1024 * 1024, `数据体积 ${(outputBytes / 1024 / 1024).toFixed(2)}MB 超过 4MB 上限`);

// ---------------------------------------------------------------------------
// 7) 打印统计（DATA-CONTRACT §5）
// ---------------------------------------------------------------------------

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;
const groupCounts = GROUPS.map((group) => `${group.id}=${indexLessons.filter((lesson) => lesson.group === group.id).length}`).join(' / ');

console.log('=== dsh-nce 数据构建完成 ===');
console.log(`源目录    ：${contentRoot}`);
console.log(`输出目录  ：${rel(outDir)}/`);
console.log(`课程数    ：${indexLessons.length}（缺课 ${gaps.missingLessonFiles.length}；分组 ${groupCounts}）`);
console.log(`词库数    ：${words.length}（原始生词 ${vocabTotal} 条；跳过 ${skippedWords.length}）`);
console.log(`平均/课   ：生词 ${report.counts.avgVocabPerLesson} 个、词库词 ${report.counts.avgWordsPerLesson} 个`);
console.log(`对话/译文 ：${stats.dialogueLines} 行 / ${stats.translationLines} 行（对话为空 ${gaps.emptyDialogue.length} 课、译文为空 ${gaps.emptyTranslation.length} 课）`);
console.log(`课文练习  ：${stats.exercises} 个 / ${stats.exerciseItems} 题（无练习 ${gaps.emptyExercises.length} 课）`);
console.log(`课堂笔记  ：${stats.notesPages} 页 / ${stats.notesBlocks} blocks（${stats.lessonsWithNotes} 课）`);
console.log(`练习册    ：${stats.gwbSections} 节 / ${stats.gwbItems} 题 / ${stats.gwbAnswers} 组答案（${stats.gwbAnswerLines} 行）`);
console.log(`输出大小  ：lessons 合计 ${mb(totalBytes)}（最大 lesson-${pad3(maxLessonId)} ${kb(maxLessonBytes)}），总计 ${mb(outputBytes)}`);
console.log(`问题记录  ：${issues.length} 项（详见 ${rel(path.join(outDir, '_report.json'))}）`);
for (const issue of issues) console.log(`  - ${issue}`);
