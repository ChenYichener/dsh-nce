#!/usr/bin/env node
/**
 * check-data.mjs — 内置数据卫生检查（2026-11-06 全量勘误后加入）。
 *
 * 目标是把「数据重建/上游改动引入 OCR 垃圾」挡在测试里，覆盖：
 *   1. 索引与课次完整性（144 课、标题非空且无已知 OCR 残片）；
 *   2. 生词：word/meaning 非空、word 合法、音标是合法英式 IPA（仅允许 the U.S. 无音标）；
 *   3. 词库：866 词、音标/释义齐全、音标合法；
 *   4. 全文扫描已知 OCR 混淆字（钓/昀/沕/隧/诼/鉬/鈅/籟/帥/簬 等）与固定错串（米钓/自已）；
 *   5. 音标页：48 音素 = 12 元音 + 8 双元音 + 28 辅音、IPA 唯一、示例音标合法；
 *   6. 课文注释/参考译文/对话中文：不允许空 zh（有 en 时）与已知 OCR 错串。
 *
 * 用法：node scripts/check-data.mjs
 * 该检查只读 data/，不依赖任何本地源内容目录。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = path.join(root, 'data')
const failures = []
let checks = 0
const check = (condition, message) => {
  checks += 1
  if (!condition) failures.push(message)
}
const warnings = []

const readJson = async (file) => JSON.parse(await fs.readFile(file, 'utf8'))

// --- IPA 合法性 ------------------------------------------------------------
const DIPHTHONGS = ['eɪ', 'aɪ', 'ɔɪ', 'əʊ', 'aʊ', 'ɪə', 'eə', 'ʊə']
const CONSONANTS = ['tʃ', 'dʒ', 'p', 'b', 't', 'd', 'k', 'g', 'f', 'v', 'θ', 'ð', 's', 'z', 'ʃ', 'ʒ', 'h', 'm', 'n', 'ŋ', 'l', 'r', 'j', 'w']
const VOWELS = ['i', 'ɪ', 'e', 'æ', 'ɑ', 'ɒ', 'ɔ', 'ʊ', 'u', 'ʌ', 'ɜ', 'ə']
const ALLOWED = new Set([...DIPHTHONGS, ...CONSONANTS, ...VOWELS, ...VOWELS.map((v) => `${v}ː`)])

function ipaProblems(phonetic) {
  const body = phonetic.trim().replace(/^[/[]/, '').replace(/[/\]]$/, '')
  if (body === '') return 'empty'
  if (!/^[/[]/.test(phonetic.trim()) || !/[/\]]$/.test(phonetic.trim())) return `missing /: ${phonetic}`
  const units = []
  let rest = body
    .replace(/\(r\)/g, 'r')
    .replace(/[ˈˌ.]/g, '')
    .replace(/ɹ/g, 'r')
    .replace(/ɛ/g, 'e')
    .replace(/ɐ/g, 'ə')
    .replace(/ɡ/g, 'g')
    .replace(/ᵻ/g, 'ɪ')
    .replace(/ɫ/g, 'l')
    .replace(/\s+/g, '')
  while (rest.length > 0) {
    if (rest.startsWith('ː')) {
      if (units.length === 0) return `dangling length mark: ${phonetic}`
      units[units.length - 1] += 'ː'
      rest = rest.slice(1)
      continue
    }
    const pair = rest.slice(0, 2)
    if (DIPHTHONGS.includes(pair) || CONSONANTS.includes(pair)) {
      units.push(pair)
      rest = rest.slice(2)
      continue
    }
    units.push(rest[0])
    rest = rest.slice(1)
  }
  const illegal = units.filter((unit) => !ALLOWED.has(unit))
  if (illegal.length > 0) return `illegal ${illegal.join(',')}: ${phonetic}`
  const hasVowel = units.some((unit) => VOWELS.includes(unit.replace('ː', '')) || DIPHTHONGS.includes(unit))
  if (!hasVowel) return `no vowel: ${phonetic}`
  return null
}

const GARBLE_CHARS = /[钓昀沕隧诼鉬鈅籟帥簬週]/
const GARBLE_PHRASES = ['米钓', '米旅', '自已', '送米', '前化瓶', '了凌物隆']
function textProblems(text, where) {
  if (typeof text !== 'string' || text === '') return null
  if (GARBLE_CHARS.test(text)) return `${where}: OCR 混淆字 ${text}`
  for (const phrase of GARBLE_PHRASES) {
    if (text.includes(phrase)) return `${where}: OCR 错串 ${phrase}`
  }
  return null
}

// --- 索引 ------------------------------------------------------------------
const index = await readJson(path.join(dataDir, 'index.json'))
check(Array.isArray(index.lessons) && index.lessons.length === 144, `index: 课程数应为 144（实际 ${index.lessons?.length}）`)
const seen = new Set()
for (const entry of index.lessons ?? []) {
  check(!seen.has(entry.id), `index: 课程 ${entry.id} 重复`)
  seen.add(entry.id)
  check(typeof entry.titleEn === 'string' && entry.titleEn.trim() !== '', `index: 课程 ${entry.id} 缺 titleEn`)
  check(typeof entry.titleZh === 'string' && entry.titleZh.trim() !== '', `index: 课程 ${entry.id} 缺 titleZh`)
  const title = entry.titleEn ?? ''
  check(!/Les\.|\.cn/.test(title), `index: 课程 ${entry.id} 标题含 OCR 残片：${title}`)
  check(!/\d$/.test(title), `index: 课程 ${entry.id} 标题以数字结尾：${title}`)
  check(!/^['"]|,,|\?\?/.test(title), `index: 课程 ${entry.id} 标题标点异常：${title}`)
}

// --- 课次 / 生词 / 课文 ------------------------------------------------------
let vocabCount = 0
let emptyPhonetic = []
for (let id = 1; id <= 144; id += 1) {
  const file = path.join(dataDir, 'lessons', `lesson-${String(id).padStart(3, '0')}.json`)
  let lesson
  try {
    lesson = await readJson(file)
  } catch {
    failures.push(`lesson ${id}: 文件缺失或 JSON 无效`)
    continue
  }
  check(lesson.id === id, `lesson ${id}: id 字段不匹配`)
  for (const [field, value] of [['titleEn', lesson.titleEn], ['titleZh', lesson.titleZh]]) {
    check(typeof value === 'string' && value.trim() !== '', `lesson ${id}: 缺 ${field}`)
    const problem = textProblems(value, `lesson ${id} ${field}`)
    if (problem !== null) failures.push(problem)
  }
  for (const [index_, vocab] of (lesson.vocab ?? []).entries()) {
    vocabCount += 1
    const where = `lesson ${id} vocab[${index_}] ${JSON.stringify(vocab.word)}`
    check(typeof vocab.word === 'string' && /^[A-Za-z][A-Za-z .'-]*$/.test(vocab.word), `${where}: word 非法`)
    check(typeof vocab.meaning === 'string' && vocab.meaning.trim() !== '', `${where}: meaning 为空`)
    const meaningProblem = textProblems(vocab.meaning, `${where} meaning`)
    if (meaningProblem !== null) failures.push(meaningProblem)
    if (vocab.phonetic === '') {
      emptyPhonetic.push(`${id}:${vocab.word}`)
    } else {
      const problem = ipaProblems(vocab.phonetic)
      check(problem === null, `${where}: 音标无效（${problem}）`)
    }
  }
  for (const [index_, note] of (lesson.textNotes ?? []).entries()) {
    check(typeof note.zh === 'string', `lesson ${id} textNotes[${index_}]: 缺 zh`)
    const problem = textProblems(note.zh, `lesson ${id} textNotes[${index_}] zh`)
    if (problem !== null) failures.push(problem)
  }
  for (const [index_, line] of (lesson.dialogue ?? []).entries()) {
    if (typeof line.zh === 'string' && line.zh !== '') {
      const problem = textProblems(line.zh, `lesson ${id} dialogue[${index_}] zh`)
      if (problem !== null) failures.push(problem)
    }
  }
  for (const [index_, line] of (lesson.translation ?? []).entries()) {
    const problem = textProblems(line.zh, `lesson ${id} translation[${index_}] zh`)
    if (problem !== null) failures.push(problem)
  }
}
check(vocabCount === 907, `生词总数应为 907（实际 ${vocabCount}）`)
check(emptyPhonetic.length <= 1 && emptyPhonetic.every((item) => item.endsWith(':the U.S.')), `生词音标为空（仅允许 the U.S.）：${emptyPhonetic.slice(0, 6).join(', ')}`)

// --- 词库 ------------------------------------------------------------------
const bank = await readJson(path.join(dataDir, 'wordbank.json'))
check(Array.isArray(bank.words) && bank.words.length === 866, `wordbank: 词数应为 866（实际 ${bank.words?.length}）`)
for (const word of bank.words ?? []) {
  const where = `wordbank ${JSON.stringify(word.word)}`
  check(typeof word.word === 'string' && word.word.trim() !== '', `${where}: word 为空`)
  check(typeof word.meaning === 'string' && word.meaning.trim() !== '', `${where}: meaning 为空`)
  check(typeof word.phonetic === 'string' && word.phonetic !== '', `${where}: phonetic 为空`)
  const ipa = word.phonetic === '' ? 'empty' : ipaProblems(word.phonetic)
  check(ipa === null || word.phonetic === '', `${where}: 音标无效（${ipa}）`)
  const meaningProblem = textProblems(word.meaning, `${where} meaning`)
  if (meaningProblem !== null) failures.push(meaningProblem)
}

// --- 音标页 ----------------------------------------------------------------
const phonetics = await readJson(path.join(dataDir, 'phonetics.json'))
const phonemes = phonetics.phonemes ?? []
check(phonemes.length === 48, `phonetics: 音素应为 48（实际 ${phonemes.length}）`)
const byGroup = new Map()
for (const phoneme of phonemes) {
  byGroup.set(phoneme.group, (byGroup.get(phoneme.group) ?? 0) + 1)
  check(typeof phoneme.ipa === 'string' && phoneme.ipa !== '', `phonetics: ${phoneme.id} 缺 ipa`)
  check(typeof phoneme.tips === 'string' && phoneme.tips.length >= 8, `phonetics: ${phoneme.id} tips 过短`)
  for (const [index_, example] of (phoneme.examples ?? []).entries()) {
    const ipa = ipaProblems(example.phonetic)
    check(ipa === null, `phonetics: ${phoneme.id} examples[${index_}] ${example.word} 音标无效（${ipa}）`)
    const meaningProblem = textProblems(example.zh, `phonetics: ${phoneme.id} examples[${index_}] zh`)
    if (meaningProblem !== null) failures.push(meaningProblem)
  }
}
check(byGroup.get('vowels') === 12, `phonetics: 元音应为 12（实际 ${byGroup.get('vowels')}）`)
check(byGroup.get('diphthongs') === 8, `phonetics: 双元音应为 8（实际 ${byGroup.get('diphthongs')}）`)
check(byGroup.get('consonants') === 28, `phonetics: 辅音应为 28（实际 ${byGroup.get('consonants')}）`)
const ipaSet = new Set(phonemes.map((phoneme) => phoneme.ipa))
check(ipaSet.size === 48, 'phonetics: ipa 有重复')
for (const [index_, pair] of (phonetics.minimalPairs ?? []).entries()) {
  const a = ipaProblems(pair.ipaA)
  const b = ipaProblems(pair.ipaB)
  check(a === null && b === null, `phonetics: minimalPairs[${index_}] 音标无效（${a ?? b}）`)
  check(pair.ipaA !== pair.ipaB, `phonetics: minimalPairs[${index_}] 两个音标相同`)
}
for (const [index_, rule] of (phonetics.phonics ?? []).entries()) {
  check(typeof rule.sound === 'string' && /^\/.+\/$/.test(rule.sound), `phonetics: phonics[${index_}] sound 非法`)
  for (const [exampleIndex, example] of (rule.examples ?? []).entries()) {
    const ipa = ipaProblems(example.phonetic)
    check(ipa === null, `phonetics: phonics[${index_}] examples[${exampleIndex}] 音标无效（${ipa}）`)
  }
}

// ---------------------------------------------------------------------------
if (failures.length > 0) {
  console.error(`check-data: ${failures.length} failure(s) out of ${checks} checks`)
  for (const failure of failures.slice(0, 60)) console.error(`  ✗ ${failure}`)
  if (failures.length > 60) console.error(`  … and ${failures.length - 60} more`)
  process.exit(1)
}
console.log(`check-data: ok — ${checks} checks passed (${vocabCount} 生词 / ${bank.words.length} 词库 / 48 音标)`)
