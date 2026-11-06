/**
 * Pure host-domain unit tests: the rules that must not depend on a host, a
 * database or a model provider.
 *
 *   - SRS scheduling (`gradeCard` transitions, due helpers, card normalization)
 *   - progress model defaults and normalization of untrusted JSON
 *   - lesson progress, unlock rules and review-queue items
 *   - AI-teacher grading parsing/prompt edge cases
 *
 * Usage: node scripts/test-host-domain.mjs
 */
import assert from 'node:assert/strict'

import {
  AI_GRADE_MAX_ITEMS,
  AI_VERDICTS,
  aiJsonCandidates,
  aiNormalizeVerdict,
  aiResolveItemId,
  aiRowField,
  aiRowsFromJson,
  aiGradeSystemPrompt,
  aiGradeUserPrompt,
  aiRepairSystemPrompt,
  cleanAiGradeItems,
  parseAiGrades,
} from '../src/host/domain/ai-grade.js'
import { LESSON_STEPS } from '../src/host/domain/constants.js'
import { emptyProgress, normalizeProgress } from '../src/host/domain/progress.js'
import { DAY_MS, dueAfterDays, localDayKey, gradeCard, isDue, normalizeCard } from '../src/host/domain/srs.js'
import {
  isWordUnlocked,
  lessonProgressOr,
  nextUnlockLesson,
  queueItem,
  recentLessonIds,
  startedLessonIds,
  translationQueueItem,
  wordCardOr,
} from '../src/host/domain/views.js'

const checks = []
let failed = 0

function check(name, run) {
  try {
    const result = typeof run === 'function' ? run() : run
    if (result === false) throw new Error('condition is false')
    checks.push({ name, ok: true })
    console.log(`PASS  ${name}`)
  } catch (error) {
    failed += 1
    checks.push({ name, ok: false, error })
    console.error(`FAIL  ${name}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function equal(name, actual, expected) {
  check(name, () => assert.deepEqual(actual, expected))
}

function near(name, actualIso, expectedMs, toleranceMs = 5_000) {
  check(name, () => {
    const actual = Date.parse(actualIso)
    assert.ok(Number.isFinite(actual), `not a timestamp: ${actualIso}`)
    assert.ok(Math.abs(actual - expectedMs) <= toleranceMs, `${actualIso} is ${actual - expectedMs}ms away from expected`)
  })
}

function localMidnightAfter(days) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/** Error factory the pure ai-grade module gets injected (mirrors RouteError). */
function fail(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

const TODAY = localDayKey(new Date())
const INDEX = {
  book: { lessonCount: 3 },
  lessons: [
    { id: 1, titleEn: 'Excuse me!' },
    { id: 2, titleEn: 'Is this your...?' },
    { id: 3, titleEn: 'Are you a teacher?' },
  ],
}
const BANK = {
  words: [
    { key: 'handbag', word: 'handbag', phonetic: 'ˈhændbæɡ', pos: 'n.', meaning: '手提包', example: 'Is this your handbag?', firstLesson: 1, lessons: [1, 2] },
    { key: 'teacher', word: 'teacher', pos: 'n.', meaning: '老师', firstLesson: 2, lessons: [2, 3] },
    { key: 'coat', word: 'coat', meaning: '大衣', firstLesson: 3, lessons: [3] },
  ],
}

// ---------------------------------------------------------------------------
// 1. SRS: card normalization and grade transitions
// ---------------------------------------------------------------------------
{
  const blank = normalizeCard(null)
  equal('srs: normalizeCard(null) stability', blank.stability, 0)
  equal('srs: normalizeCard(null) difficulty', blank.difficulty, 5)
  equal('srs: normalizeCard(null) scheduledDays', blank.scheduledDays, 0)
  equal('srs: normalizeCard(null) learningSteps', blank.learningSteps, 0)
  equal('srs: normalizeCard(null) reps', blank.reps, 0)
  equal('srs: normalizeCard(null) lapses', blank.lapses, 0)
  equal('srs: normalizeCard(null) state', blank.state, 0)
  equal('srs: normalizeCard(null) lastReview', blank.lastReview, '')
  check('srs: normalizeCard(null) fills due with now', Math.abs(Date.parse(blank.due) - Date.now()) < 5_000)

  const clamped = normalizeCard({ due: '2026-01-01T00:00:00.000Z', stability: -3, difficulty: 99, scheduledDays: -1, learningSteps: -2, reps: -4, lapses: -5, state: 9, lastReview: 123 })
  equal('srs: normalizes due string', clamped.due, '2026-01-01T00:00:00.000Z')
  equal('srs: clamps stability', clamped.stability, 0)
  equal('srs: clamps difficulty high', clamped.difficulty, 10)
  equal('srs: clamps scheduledDays', clamped.scheduledDays, 0)
  equal('srs: clamps learningSteps', clamped.learningSteps, 0)
  equal('srs: clamps reps', clamped.reps, 0)
  equal('srs: clamps lapses', clamped.lapses, 0)
  equal('srs: rejects out-of-range state', clamped.state, 0)
  equal('srs: non-string lastReview', clamped.lastReview, '')
  equal('srs: difficulty floor', normalizeCard({ difficulty: -1 }).difficulty, 1)

  const input = { due: '2026-01-01T00:00:00.000Z', reps: 2 }
  const again = gradeCard(input, 'again')
  equal('srs: again bumps reps', again.reps, 3)
  equal('srs: again bumps lapses', again.lapses, 1)
  equal('srs: again from new card enters learning', again.state, 1)
  equal('srs: again resets scheduledDays', again.scheduledDays, 0)
  equal('srs: again resets learningSteps', again.learningSteps, 0)
  near('srs: again due in one minute', again.due, Date.now() + 60_000)
  equal('srs: gradeCard does not mutate input', input.reps, 2)

  const hard = gradeCard(null, 'hard')
  equal('srs: hard enters learning state', hard.state, 1)
  equal('srs: hard sets learningSteps', hard.learningSteps, 1)
  equal('srs: hard keeps scheduledDays 0', hard.scheduledDays, 0)
  near('srs: hard due in ten minutes', hard.due, Date.now() + 600_000)

  const good = gradeCard(null, 'good')
  equal('srs: good from new card', good.state, 2)
  equal('srs: good first interval', good.scheduledDays, 1)
  equal('srs: good stores stability', good.stability, 1)
  equal('srs: good clears learningSteps', good.learningSteps, 0)
  near('srs: good due tomorrow local midnight', good.due, localMidnightAfter(1), 60_000)

  const easy = gradeCard(null, 'easy')
  equal('srs: easy from new card state', easy.state, 2)
  equal('srs: easy first interval', easy.scheduledDays, 4)
  equal('srs: easy stores stability', easy.stability, 4)

  const reviewCard = { due: '2026-01-01T00:00:00.000Z', state: 2, stability: 10, scheduledDays: 10, reps: 3 }
  equal('srs: good review interval grows by 2.5x', gradeCard(reviewCard, 'good').scheduledDays, 25)
  equal('srs: easy review interval grows by 3.5x', gradeCard(reviewCard, 'easy').scheduledDays, 35)
  equal('srs: review interval never below one day', gradeCard({ ...reviewCard, stability: 0.1 }, 'good').scheduledDays, 1)
  equal('srs: easy review interval never below two days', gradeCard({ ...reviewCard, stability: 0.1 }, 'easy').scheduledDays, 2)
  const relearn = gradeCard(reviewCard, 'again')
  equal('srs: again on review card enters relearning', relearn.state, 3)
  equal('srs: again on review card bumps lapses', relearn.lapses, 1)
  equal('srs: hard on review card keeps state', gradeCard(reviewCard, 'hard').state, 2)

  check('srs: DAY_MS constant', DAY_MS === 86_400_000)
  const now = Date.now()
  equal('srs: isDue rejects state 0', isDue({ state: 0, due: new Date(now - 1000).toISOString() }, now), false)
  equal('srs: isDue rejects future card', isDue({ state: 2, due: new Date(now + 60_000).toISOString() }, now), false)
  equal('srs: isDue accepts past card', isDue({ state: 2, due: new Date(now - 1000).toISOString() }, now), true)
  equal('srs: isDue rejects null', isDue(null, now), false)
  equal('srs: isDue rejects bad due', isDue({ state: 2, due: 'not-a-date' }, now), false)

  near('srs: dueAfterDays(0) is local midnight', dueAfterDays(0), localMidnightAfter(0), 60_000)
  check('srs: localDayKey pads', localDayKey(new Date(2026, 0, 5)) === '2026-01-05')
}

// ---------------------------------------------------------------------------
// 2. Progress model: defaults and normalization of untrusted JSON
// ---------------------------------------------------------------------------
{
  const empty = emptyProgress()
  equal('progress: version', empty.version, 1)
  equal('progress: updatedAt', empty.updatedAt, 0)
  equal('progress: streak defaults', empty.streak, { lastDay: '', days: 0, totalDays: 0 })
  equal('progress: empty collections', [empty.history, empty.lessons, empty.words, empty.videos, empty.translations, empty.translateDismissed], [{}, {}, {}, {}, {}, {}])
  equal('progress: normalizeProgress(null) falls back to defaults', normalizeProgress(null), empty)
  equal('progress: normalizeProgress("nope") falls back to defaults', normalizeProgress('nope'), empty)
  equal('progress: normalizeProgress({}) falls back to defaults', normalizeProgress({}), empty)

  const raw = {
    updatedAt: 42,
    streak: { lastDay: '2026-11-05', days: -3, totalDays: '7' },
    history: { '2026-11-05': 4, 'not-a-day': 9, '2026-11-06': 'x' },
    lessons: {
      1: { status: 'done', steps: { words: true, grammar: 'yes' }, updatedAt: 5, lastVisit: 6 },
      abc: { status: 'learning' },
      2: 'nope',
    },
    words: {
      handbag: { starred: true, srs: { state: 2, due: '2026-01-01T00:00:00.000Z', stability: 3, reps: '2' }, right: 4, wrong: 0 },
      empty: {},
    },
    videos: { 1: 'https://example.com/v', 2: 'javascript:alert(1)', x: 'https://example.com/x' },
    translations: {
      'tr:t1': { direction: 'zh-en', source: ' 你好 ', translation: ' hello ', examples: [' a ', 'b', 'c'], notes: 'n', createdAt: 'c', addedAt: 'a' },
      'bad-key': { source: 'x', translation: 'y' },
      'tr:t2': { source: 'no translation' },
    },
    translateDismissed: { t1: true, 'bad key': true },
    plan: { dailyLessons: 99, dailyNewWords: -1, dailyTranslation: 999, targetDate: '2026-12-31' },
    tasks: [
      { id: 'task-1', date: '2026-11-05', type: 'custom', title: '  read aloud  ', target: -2, status: 'done', payload: { a: 1 }, createdAt: 'c', doneAt: 'd' },
      { id: 'task-2', date: 'bad-date', type: 'custom', title: 'x' },
      { id: 'task-3', date: '2026-11-05', type: 'nope', title: 'x' },
    ],
  }
  const progress = normalizeProgress(raw)
  equal('progress: keeps updatedAt', progress.updatedAt, 42)
  equal('progress: streak clamps negative days', progress.streak, { lastDay: '2026-11-05', days: 0, totalDays: 7 })
  equal('progress: history keeps valid days only', progress.history, { '2026-11-05': 4 })
  equal('progress: lesson status kept', progress.lessons['1'].status, 'done')
  equal('progress: lesson steps filled', progress.lessons['1'].steps, { words: true, grammar: false, exercise: false })
  equal('progress: lesson timestamps kept', [progress.lessons['1'].updatedAt, progress.lessons['1'].lastVisit], [5, 6])
  equal('progress: non-numeric lesson id dropped', progress.lessons.abc, undefined)
  equal('progress: non-object lesson dropped', progress.lessons['2'], undefined)
  equal('progress: word starred kept', progress.words.handbag.starred, true)
  equal('progress: word srs normalized', progress.words.handbag.srs.state, 2)
  equal('progress: word counters coerced', [progress.words.handbag.srs.reps, progress.words.handbag.right], [2, 4])
  equal('progress: empty word dropped', progress.words.empty, undefined)
  equal('progress: http video kept', progress.videos['1'], 'https://example.com/v')
  equal('progress: non-http video dropped', progress.videos['2'], undefined)
  equal('progress: non-numeric video dropped', progress.videos.x, undefined)
  equal('progress: translation direction kept', progress.translations['tr:t1'].direction, 'zh-en')
  equal('progress: translation trimmed', [progress.translations['tr:t1'].source, progress.translations['tr:t1'].translation], ['你好', 'hello'])
  equal('progress: translation examples capped', progress.translations['tr:t1'].examples.length, 2)
  equal('progress: invalid translation key dropped', progress.translations['bad-key'], undefined)
  equal('progress: translation without text dropped', progress.translations['tr:t2'], undefined)
  equal('progress: dismissed flags filtered', progress.translateDismissed, { t1: true })
  equal('progress: legacy plan field is dropped', progress.plan, undefined)
  equal('progress: legacy tasks field is dropped', progress.tasks, undefined)
  equal('progress: lesson status fallback', normalizeProgress({ lessons: { 1: { status: 'weird' } } }).lessons['1'].status, 'learning')
}

// ---------------------------------------------------------------------------
// 3. Lesson views, due counts, unlock rules and queue items
// ---------------------------------------------------------------------------
{
  const progress = emptyProgress()
  progress.lessons['2'] = { status: 'learning', steps: { words: true, grammar: true }, updatedAt: 10, lastVisit: 20 }
  equal('views: lessonProgressOr returns stored entry', lessonProgressOr(progress, 2), progress.lessons['2'])
  equal('views: lessonProgressOr defaults', lessonProgressOr(progress, 9), { status: 'learning', steps: Object.fromEntries(LESSON_STEPS.map((step) => [step, false])), updatedAt: 0, lastVisit: 0 })
  equal('views: wordCardOr missing card', wordCardOr(progress, 'handbag'), null)
  progress.words.handbag = { srs: { state: 2, due: '2026-01-01T00:00:00.000Z' } }
  equal('views: wordCardOr returns card', wordCardOr(progress, 'handbag').state, 2)

  equal('views: startedLessonIds defaults to lesson 1', startedLessonIds(emptyProgress()), [1])
  const started = emptyProgress()
  started.lessons = { 3: { steps: {} }, 1: { steps: {} }, 0: { steps: {} }, x: { steps: {} } }
  equal('views: startedLessonIds sorted and validated', startedLessonIds(started), [1, 3])
  equal('views: isWordUnlocked by firstLesson', isWordUnlocked({ firstLesson: 2 }, new Set([2])), true)
  equal('views: isWordUnlocked by lessons list', isWordUnlocked({ firstLesson: 9, lessons: [1, 5] }, new Set([5])), true)
  equal('views: isWordUnlocked false when locked', isWordUnlocked({ firstLesson: 9, lessons: [9] }, new Set([1, 2])), false)
  equal('views: nextUnlockLesson finds next frontier', nextUnlockLesson(BANK.words, new Set([1])), 2)
  equal('views: nextUnlockLesson skips started', nextUnlockLesson(BANK.words, new Set([1, 2])), 3)
  equal('views: nextUnlockLesson found none', nextUnlockLesson(BANK.words, new Set([1, 2, 3])), 0)
  equal('views: nextUnlockLesson ignores non-integer firstLesson', nextUnlockLesson([{ firstLesson: 'x' }, { firstLesson: 4 }], new Set([1])), 4)

  const recent = emptyProgress()
  recent.lessons = { 1: { updatedAt: 10, lastVisit: 30 }, 2: { updatedAt: 20, lastVisit: 20 }, 3: { updatedAt: 5, lastVisit: 5 } }
  equal('views: recentLessonIds by visit time', recentLessonIds(recent), [1, 2, 3])
  equal('views: recentLessonIds default', recentLessonIds(emptyProgress()), [1])

  equal('views: queueItem word shape', queueItem(BANK.words[0], null, true), {
    kind: 'word',
    key: 'handbag',
    word: 'handbag',
    phonetic: 'ˈhændbæɡ',
    pos: 'n.',
    meaning: '手提包',
    example: 'Is this your handbag?',
    lesson: 1,
    lessons: [1, 2],
    card: null,
    isNew: true,
    starred: false,
  })
  equal('views: queueItem fallbacks', queueItem({ key: 'k', word: 'w', lessons: [7] }, { state: 2 }, false), {
    kind: 'word',
    key: 'k',
    word: 'w',
    phonetic: '',
    pos: '',
    meaning: '',
    example: '',
    lesson: 7,
    lessons: [7],
    card: { state: 2 },
    isNew: false,
    starred: false,
  })
  const en2zh = translationQueueItem('tr:t1', { direction: 'en-zh', source: 'a little', translation: '一点', notes: 'n', examples: ['e'] }, null, true)
  equal('views: translationQueueItem english text', en2zh.translation.enText, 'a little')
  equal('views: translationQueueItem shape', [en2zh.kind, en2zh.word, en2zh.meaning, en2zh.lesson, en2zh.isNew], ['translation', 'a little', '一点', 0, true])
  equal('views: translationQueueItem zh-en text', translationQueueItem('tr:t2', { direction: 'zh-en', source: '你好', translation: 'Hello' }, null, false).translation.enText, 'Hello')
}

// ---------------------------------------------------------------------------
// 4. AI-teacher grading: cleaning, parsing and prompts
// ---------------------------------------------------------------------------
{
  equal('ai: max items is 30', AI_GRADE_MAX_ITEMS, 30)
  equal('ai: verdict set', [...AI_VERDICTS], ['correct', 'close', 'wrong'])

  const cleaned = cleanAiGradeItems([
    { id: ' ex:0:0 ', prompt: ' p ', answer: ' a ', group: ' g ', example: ' e ' },
    { id: 'ex:0:0', prompt: 'dup', answer: 'x' },
    { id: 'ex:0:1', prompt: '', answer: 'x' },
    { id: 'ex:0:2', prompt: 'p2', answer: '' },
    { id: 'ex:0:3', prompt: 'p3', answer: 'a3' },
  ], fail)
  equal('ai: clean keeps usable rows', cleaned.length, 2)
  equal('ai: clean trims fields', cleaned[0], { id: 'ex:0:0', prompt: 'p', answer: 'a', group: 'g', example: 'e', reference: '' })
  const longClean = cleanAiGradeItems([{ id: 'q', prompt: 'p'.repeat(900), answer: 'a'.repeat(900), group: 'g'.repeat(300), example: 'e'.repeat(500), reference: 'r'.repeat(900) }], fail)
  equal('ai: clean clips lengths', [longClean[0].prompt.length, longClean[0].answer.length, longClean[0].group.length, longClean[0].example.length, longClean[0].reference.length], [500, 500, 160, 400, 400])
  equal('ai: clean caps the batch', cleanAiGradeItems(Array.from({ length: 40 }, (_, index) => ({ id: `q${index}`, prompt: 'p', answer: 'a' })), fail).length, 30)
  check('ai: clean rejects non-array', (() => { try { cleanAiGradeItems('nope', fail); return false } catch (error) { return error.status === 400 } })())
  check('ai: clean rejects all-unusable input', (() => { try { cleanAiGradeItems([{ id: '' }], fail); return false } catch (error) { return error.status === 400 && error.message === '没有可批改的题目' } })())

  equal('ai: aiRowField first non-empty alias', aiRowField({ a: '', b: ' value ', c: 'other' }, ['a', 'b', 'c']), 'value')
  equal('ai: aiRowField skips objects', aiRowField({ a: {}, b: 'x' }, ['a', 'b']), 'x')
  equal('ai: aiRowField non-object', aiRowField(null, ['a']), '')

  const items = [{ id: 'ex:0:0' }, { id: 'Ex:0:1' }, { id: 'ex 0 2' }]
  const byId = new Map()
  for (const item of items) {
    byId.set(item.id, item.id)
    byId.set(item.id.toLowerCase(), item.id)
    byId.set(item.id.replace(/\s+/g, '').toLowerCase(), item.id)
  }
  equal('ai: resolve exact id', aiResolveItemId('ex:0:0', items, byId), 'ex:0:0')
  equal('ai: resolve case-insensitive id', aiResolveItemId('EX:0:1', items, byId), 'Ex:0:1')
  equal('ai: resolve embedded id', aiResolveItemId('题号 ex:0:0（第 1 题）', items, byId), 'ex:0:0')
  equal('ai: resolve printed number', aiResolveItemId('2)', items, byId), 'Ex:0:1')
  equal('ai: resolve unknown id', aiResolveItemId('nope', items, byId), '')
  equal('ai: resolve strips id prefix', aiResolveItemId('id=ex:0:0', items, byId), 'ex:0:0')

  equal('ai: verdict correct', aiNormalizeVerdict('Correct'), 'correct')
  equal('ai: verdict right alias', aiNormalizeVerdict('right'), 'correct')
  equal('ai: verdict close alias', aiNormalizeVerdict('partial'), 'close')
  equal('ai: verdict chinese correct', aiNormalizeVerdict('正确'), 'correct')
  equal('ai: verdict chinese wrong', aiNormalizeVerdict('不正确。'), 'wrong')
  equal('ai: verdict unknown', aiNormalizeVerdict('maybe'), '')
  equal('ai: verdict empty', aiNormalizeVerdict(''), '')

  const candidates = aiJsonCandidates('前言\n```json\n{"a":1}\n```\n后记 {"b":2} 完')
  equal('ai: json candidates count', candidates.length, 3)
  check('ai: json candidates parse fenced block', candidates.some((value) => value.a === 1))
  check('ai: json candidates find inline object', candidates.some((value) => value.b === 2))
  equal('ai: json candidates on prose', aiJsonCandidates('完全不是 JSON').length, 0)
  const truncatedRows = aiJsonCandidates('{"items":[{"id":"a","verdict":"correct"},{"id":"b","verdict":"wrong"}')
  equal('ai: json candidates keep complete inner rows of truncated output', truncatedRows.filter((value) => typeof value === 'object' && value.id !== undefined).length, 2)

  const rows = []
  aiRowsFromJson({ data: { items: [{ id: 'a' }] } }, rows)
  equal('ai: rows from nested data wrapper', rows.length, 1)
  const bareRows = []
  aiRowsFromJson([{ id: 'a' }, null, 'x'], bareRows)
  equal('ai: rows from bare array', bareRows.length, 1)
  const singleRows = []
  aiRowsFromJson({ id: 'a', verdict: 'correct' }, singleRows)
  equal('ai: rows from single row object', singleRows.length, 1)
  const notRows = []
  aiRowsFromJson({ anything: 'else' }, notRows)
  equal('ai: rows need a recognizable field', notRows.length, 0)

  const requested = [{ id: 'ex:0:0' }, { id: 'ex:0:1' }, { id: 'ex:0:2' }]
  const reply = [
    '{"id":"ex:0:0","verdict":"correct","comment":"很好","answer":"He is"}',
    '{"id":"ex:0:1","verdict":"partial","comment":"注意缩写","answer":"It is"}',
    '{"id":"ex:0:2","verdict":"incorrect","comment":"主谓不一致","answer":"She is"}',
  ].join('\n')
  const graded = parseAiGrades(reply, requested)
  equal('ai: parse line-delimited rows', graded.map((row) => row.id), ['ex:0:0', 'ex:0:1', 'ex:0:2'])
  equal('ai: parse verdict aliases', graded.map((row) => row.verdict), ['correct', 'close', 'wrong'])
  equal('ai: parse trims comment', graded[1].comment, '注意缩写')
  equal('ai: parse clips comment', parseAiGrades(`{"items":[{"id":"ex:0:0","verdict":"correct","comment":"${'c'.repeat(400)}"}]}`, requested)[0].comment.length, 160)
  equal('ai: parse clips answer', parseAiGrades(`{"items":[{"id":"ex:0:0","verdict":"correct","answer":"${'a'.repeat(600)}"}]}`, requested)[0].answer.length, 300)
  equal('ai: parse drops duplicate id', parseAiGrades('{"items":[{"id":"ex:0:0","verdict":"correct"},{"id":"ex:0:0","verdict":"wrong"}]}', requested).length, 1)
  equal('ai: parse drops unknown verdict', parseAiGrades('{"items":[{"id":"ex:0:0","verdict":"maybe"}]}', requested), null)
  equal('ai: parse garbage', parseAiGrades('完全不是 JSON', requested), null)
  equal('ai: parse empty items', parseAiGrades('{"items":[]}', requested), null)
  const numbered = parseAiGrades('1) 对\n{"id":"1","verdict":"correct"}\n{"id":"2","verdict":"wrong"}\n{"id":"3","verdict":"close"}', requested)
  equal('ai: parse numeric ids map in order', numbered.map((row) => row.id), ['ex:0:0', 'ex:0:1', 'ex:0:2'])
  const noIds = '{"verdict":"correct"}\n{"verdict":"wrong"}\n{"verdict":"close"}'
  equal('ai: parse missing ids fall back to order', parseAiGrades(noIds, requested).map((row) => row.id), ['ex:0:0', 'ex:0:1', 'ex:0:2'])
  equal('ai: parse order fallback needs full batch', parseAiGrades('{"verdict":"correct"}', requested), null)
  equal('ai: parse chinese fields', parseAiGrades('{"题号":"ex:0:0","判定":"正确","点评":"好","参考答案":"He is"}', requested)[0], { id: 'ex:0:0', verdict: 'correct', comment: '好', answer: 'He is' })

  const system = aiGradeSystemPrompt()
  check('ai: system prompt names the verdicts', AI_VERDICTS.size === 3 && [...AI_VERDICTS].every((verdict) => system.includes(verdict)))
  check('ai: system prompt asks for line JSON', system.includes('每行一个 JSON 对象') && system.includes('不要外层数组'))
  check('ai: repair prompt asks for line JSON', aiRepairSystemPrompt().includes('每题一行 JSON 对象'))
  const userPrompt = aiGradeUserPrompt({ id: 10, titleEn: 'Look at...' }, [
    { id: 'ex:0:0', prompt: 'p ___', answer: 'a', group: 'A', example: 'live ___' },
    { id: 'ex:0:1', prompt: 'p2 ___', answer: 'b', group: '', example: '' },
  ])
  check('ai: user prompt names the lesson', userPrompt.includes('第 10 课') && userPrompt.includes('Look at...'))
  check('ai: user prompt echoes ids', userPrompt.includes('id=ex:0:0') && userPrompt.includes('原样复制这个 id'))
  check('ai: user prompt counts the batch', userPrompt.includes('共 2 题'))
  check('ai: user prompt includes the book context only when present', userPrompt.split('本组上下文：').length === 2)
  check('ai: user prompt includes answers', userPrompt.includes('学生答案：a'))
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const failedChecks = checks.filter((item) => !item.ok)
if (failedChecks.length > 0) {
  console.error(`test-host-domain: ${failedChecks.length} failure(s)`)
  for (const failure of failedChecks) console.error(`  ✗ ${failure.name}`)
  process.exit(1)
}
console.log(`test-host-domain: ok — ${checks.length} checks passed`)
