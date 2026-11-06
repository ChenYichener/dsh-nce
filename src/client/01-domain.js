// Layer: 01 domain — depends on: 00-platform (`normWord`) only; no React, DOM, storage or network.
// Pure lesson/word view-models, the fixed lesson metadata and the COPY strings.

/**
 * The three study steps a lesson tracks. The single-page lesson merges video,
 * text, words, grammar and the exercise paper, so 预习 / 复习 are no longer part
 * of it: only 单词 / 语法 / 练习 can be ticked, and selecting 已学习 in the
 * course list ticks all three.
 */
const LESSON_STEPS = [
  { id: 'words', label: '单词' },
  { id: 'grammar', label: '语法' },
  { id: 'exercise', label: '练习' },
]

/** Anki-style grade buttons: Again / Hard / Good / Easy. */
const GRADES = [
  { id: 'again', label: '重来', hint: '1 分钟后', tone: 'again' },
  { id: 'hard', label: '困难', hint: '10 分钟后', tone: 'hard' },
  { id: 'good', label: '良好', hint: '明天', tone: 'good' },
  { id: 'easy', label: '简单', hint: '4 天后', tone: 'easy' },
]

/** Split a printed answer into the question / answer rows the book rules for 提问并回答 exercises. */
function paperAskAnswerRows(segments) {
  const text = (Array.isArray(segments) ? segments : []).map((segment) => String(segment ?? '').trim()).filter(Boolean).join(' ')
    .replace(/\s*\/\s*(?=[A-Z("'])/g, ' ')
  const rows = []
  for (const sentence of text.split(/(?<=[.?!])\s+(?=[A-Z("'])/).map((part) => part.trim()).filter(Boolean)) {
    if (sentence.endsWith('?') || rows.length === 0 || rows[rows.length - 1].endsWith('?')) rows.push(sentence)
    else rows[rows.length - 1] += ` ${sentence}`
  }
  return rows
}

const COPY = {
  panel: 'NCE',
  panelSub: '新概念英语 1',
  home: '课程',
  plan: '计划',
  words: '记忆卡',
  review: '复习',
  phonetics: '音标',
  lessons: '课程',
}

/** Human due hint for a card. */
function dueLabel(card) {
  if (card === null || typeof card !== 'object' || card.state === 0) return '新卡'
  const at = Date.parse(card.due)
  if (!Number.isFinite(at)) return '新卡'
  const days = Math.ceil((at - Date.now()) / 86_400_000)
  if (at <= Date.now()) return '待复习'
  if (days <= 1) return '今天稍后'
  return `${days} 天后`
}

function lessonTitle(lesson) {
  if (lesson === null || lesson === undefined) return ''
  const en = String(lesson.titleEn ?? '').trim()
  const zh = String(lesson.titleZh ?? '').trim()
  if (en !== '' && zh !== '') return `${en} · ${zh}`
  return en || zh || `第 ${lesson.id ?? ''} 课`
}

const DONE_STEP_KEYS = LESSON_STEPS.map((step) => step.id)

/** Normalize one lesson's progress with defaults for a missing entry. */
function lessonStateOf(progress, id) {
  const raw = progress !== null && progress !== undefined && progress.lessons !== null && progress.lessons !== undefined
    ? progress.lessons[String(id)] ?? progress.lessons[id]
    : undefined
  const steps = {}
  for (const key of DONE_STEP_KEYS) steps[key] = raw?.steps?.[key] === true
  const doneSteps = DONE_STEP_KEYS.filter((key) => steps[key]).length
  // Three study states: never opened (unseen), in progress, finished.
  const state = raw?.status === 'done' ? 'done' : raw !== undefined ? 'learning' : 'unseen'
  return {
    state,
    status: state === 'done' ? 'done' : 'learning',
    steps,
    doneSteps,
    updatedAt: Number(raw?.updatedAt) || 0,
    lastVisit: Number(raw?.lastVisit) || 0,
  }
}

function doneLessonCount(progress) {
  if (progress === null || progress === undefined || progress.lessons === undefined) return 0
  return Object.values(progress.lessons).filter((item) => item?.status === 'done').length
}

/** Lessons the learner has started; a fresh profile unlocks lesson 1. */
function startedLessonIds(progress) {
  const ids = new Set()
  for (const [id, entry] of Object.entries(progress?.lessons ?? {})) {
    const value = Number(id)
    if (Number.isInteger(value) && value > 0 && entry !== null && typeof entry === 'object') ids.add(value)
  }
  if (ids.size === 0) ids.add(1)
  return [...ids].sort((left, right) => left - right)
}

/** A word joins the review rotation once any of its lessons has been started. */
function isWordUnlocked(word, startedSet) {
  const first = Number(word?.firstLesson)
  if (Number.isInteger(first) && startedSet.has(first)) return true
  const lessons = Array.isArray(word?.lessons) ? word.lessons : []
  return lessons.some((id) => startedSet.has(Number(id)))
}

/** First not-yet-started lesson that holds locked new words (0 = none). */
function nextUnlockLessonId(words, startedSet) {
  const maxStarted = startedSet.size === 0 ? 1 : Math.max(...startedSet)
  let best = 0
  for (const word of words) {
    const first = Number(word?.firstLesson)
    if (!Number.isInteger(first) || first <= maxStarted || startedSet.has(first)) continue
    if (best === 0 || first < best) best = first
  }
  return best
}

/** Words whose card is due now (or new cards not seen yet are excluded). */
function dueWordCount(progress, wordbank) {
  if (progress === null || progress === undefined || wordbank === null || wordbank === undefined) return 0
  const words = Array.isArray(wordbank.words) ? wordbank.words : []
  const now = Date.now()
  let count = 0
  for (const word of words) {
    const key = word?.key ?? normWord(word?.word)
    const card = progress.words?.[key]?.srs
    if (card === undefined || card === null) continue
    if (card.state === 0) continue
    const at = Date.parse(card.due)
    if (Number.isFinite(at) && at <= now) count += 1
  }
  return count
}

/** Bilibili / YouTube watch URLs → embeddable player URLs; null otherwise. */
function videoEmbedUrl(rawUrl) {
  const url = String(rawUrl ?? '').trim()
  if (url === '') return null
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.replace(/^www\./, '')
    if (host === 'bilibili.com' || host === 'm.bilibili.com') {
      const match = /BV[0-9A-Za-z]+/.exec(parsed.pathname)
      if (match !== null) {
        const part = Number(parsed.searchParams.get('p') ?? parsed.searchParams.get('page') ?? '')
        const suffix = Number.isFinite(part) && part > 0 ? `&page=${Math.round(part)}` : ''
        return `https://player.bilibili.com/player.html?bvid=${match[0]}${suffix}&high_quality=1&autoplay=0`
      }
    }
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      const id = parsed.searchParams.get('v')
      if (id !== null && id !== '') return `https://www.youtube.com/embed/${id}`
    }
    if (host === 'youtu.be') {
      const id = parsed.pathname.slice(1)
      if (id !== '') return `https://www.youtube.com/embed/${id}`
    }
  } catch {
    return null
  }
  return null
}

function LessonArray(value) {
  return Array.isArray(value) ? value : []
}
