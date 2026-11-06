/**
 * 错题本 (mistake notebook) tests.
 *
 * Covers the whole client-side pipeline without a browser:
 *   - `PaperWrongRows` turns 判错 / 近似 questions into rows with prompt,
 *     the student's answer and the reference answer;
 *   - `mistakesSyncLesson` upserts those rows, keeps timestamps stable on
 *     re-grading, drops questions that became correct, and the notebook store
 *     survives double syncs without duplicates;
 *   - `mistakesSyncPaper` is skipped when the sheet has no grading evidence;
 *   - the `MistakesPage` renders the empty state / grouped rows / answers and
 *     its 「已掌握」 button removes an entry.
 *
 * Usage: node scripts/test-mistakes.mjs
 */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const clientDir = path.join(root, 'src/client')
const generatedDir = path.join(clientDir, 'generated')
const dataDir = path.join(root, 'data')

const failures = []
let checks = 0
function check(name, condition, detail) {
  checks += 1
  if (!condition) failures.push(`${name}${detail === undefined ? '' : ` — ${detail}`}`)
}
function equal(name, actual, expected) {
  check(name, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

// ---------------------------------------------------------------------------
// Fragments (99-entry is the slot registration and is not needed here)
// ---------------------------------------------------------------------------
const fragmentFiles = [
  ...readdirSync(clientDir)
    .filter((name) => /^\d{2}-[\w.-]+\.js$/.test(name) && name !== '99-entry.js')
    .map((name) => path.join(clientDir, name)),
  ...readdirSync(generatedDir)
    .filter((name) => /^\d{2}-[\w.-]+\.js$/.test(name))
    .map((name) => path.join(generatedDir, name)),
].sort((left, right) => path.basename(left).localeCompare(path.basename(right)))
const fragmentCode = fragmentFiles.map((file) => readFileSync(file, 'utf8')).join('\n')

// ---------------------------------------------------------------------------
// Fake browser + React
// ---------------------------------------------------------------------------
const store = new Map()
const localStorageStub = {
  get length() { return store.size },
  key: (index) => [...store.keys()][index] ?? null,
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
}
const fakeNce = {
  nav: { page: 'mistakes', lessonId: 0, tab: '' },
  go() {}, openLesson() {}, clearLessonTab() {},
  progress: null, progressError: null, reloadProgress() {}, updateLesson: async () => {},
  starWord() {}, gradeWord() {}, saveVideo() {},
}
const React = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  Fragment: Symbol('Fragment'),
  Component: class { constructor(props) { this.props = props } setState() {} },
  createContext: () => ({ $$context: true, _value: fakeNce, Provider: Symbol('Provider') }),
  useContext: (context) => context?._value ?? null,
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect() {},
  useMemo(factory) { return factory() },
  useCallback(callback) { return callback },
  useRef: (initial) => ({ current: initial ?? null }),
}
const windowStub = {
  localStorage: localStorageStub,
  addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
  location: { href: 'http://127.0.0.1:50000/' },
}
globalThis.window = windowStub
const exported = new Function('require', 'window', 'document', 'navigator', `${fragmentCode}
  return {
    PaperBuildModel, PaperEvaluate, PaperAiRows, PaperWrongRows, PaperQuestionAnswerKeys,
    PaperApplyAi,
    mistakesList, mistakesCount, mistakesSyncLesson, mistakesSyncPaper,
    mistakesRemove, mistakesSetExplain, mistakesClearLesson, mistakesBackfillFromDrafts, MistakesPage,
  }
`)((name) => {
  if (name === 'react') return React
  throw new Error(`unexpected client module: ${name}`)
}, windowStub, undefined, undefined)

const lesson = JSON.parse(readFileSync(path.join(dataDir, 'lessons', 'lesson-010.json'), 'utf8'))
const model = exported.PaperBuildModel(lesson)

// ---------------------------------------------------------------------------
// Helpers: build one graded paper by hand
// ---------------------------------------------------------------------------
function answerKeysOf(question) {
  return exported.PaperQuestionAnswerKeys(question)
}
const flatQuestions = model.groups
  .flatMap((group) => group.questions)
  .filter((question) => !question.isExample)

function paperWithVerdicts(verdicts) {
  const answers = {}
  const ai = {}
  flatQuestions.slice(0, verdicts.length).forEach((question, index) => {
    const verdict = verdicts[index]
    for (const key of answerKeysOf(question)) answers[key] = 'x'
    ai[question.id] = { verdict, comment: `点评 ${index + 1}`, answer: `AI 答案 ${index + 1}` }
  })
  return { version: 1, updatedAt: Date.now(), graded: true, answers, marks: {}, revealed: {}, ai }
}

// ---------------------------------------------------------------------------
// 1. PaperWrongRows: only answered 判错 / 近似 rows carry the useful context
// ---------------------------------------------------------------------------
{
  const paper = paperWithVerdicts(['wrong', 'close', 'correct'])
  const rows = exported.PaperWrongRows(model, paper)
  equal('rows: wrong + close only', rows.length, 2)
  equal('rows: first verdict', rows[0].verdict, 'wrong')
  equal('rows: second verdict', rows[1].verdict, 'close')
  check('rows: prompt filled', rows[0].prompt.length > 0, rows[0].prompt)
  equal('rows: student answer kept', rows[0].answer, 'x')
  equal('rows: reference falls back to the AI answer', rows[0].reference.join(''), 'AI 答案 1')
  equal('rows: comment kept', rows[0].comment, '点评 1')
  check('rows: question id present', typeof rows[0].questionId === 'string' && rows[0].questionId !== '')
  const blankPaper = { version: 1, graded: true, answers: {}, marks: {}, revealed: {}, ai: {} }
  equal('rows: ungraded/blank sheet has none', exported.PaperWrongRows(model, blankPaper).length, 0)
}

// ---------------------------------------------------------------------------
// 2. Store sync: upsert, idempotency, answer changes and removals
// ---------------------------------------------------------------------------
{
  store.clear()
  const paper = paperWithVerdicts(['wrong', 'close'])
  const rows = exported.PaperWrongRows(model, paper)
  exported.mistakesSyncLesson(10, 'Look at...', rows)
  equal('sync: two rows stored', exported.mistakesCount(), 2)
  const list = exported.mistakesList()
  equal('sync: lesson title stored', list[0].lessonTitle, 'Look at...')
  equal('sync: lesson id stored', list[0].lessonId, 10)
  const firstAddedAt = list[0].addedAt
  const firstKey = list[0].key
  check('sync: key is lesson:question', firstKey.startsWith('10:'), firstKey)

  exported.mistakesSyncLesson(10, 'Look at...', rows)
  equal('sync: re-sync keeps two rows', exported.mistakesCount(), 2)
  const again = exported.mistakesList().find((entry) => entry.key === firstKey)
  equal('sync: re-sync does not reset addedAt', again.addedAt, firstAddedAt)

  equal('explain: stored on the row', exported.mistakesSetExplain(firstKey, '主语是单数，所以用 is。'), true)
  equal('explain: row carries the text', exported.mistakesList().find((entry) => entry.key === firstKey).explain, '主语是单数，所以用 is。')
  exported.mistakesSyncLesson(10, 'Look at...', rows)
  equal('explain: survives an identical re-sync', exported.mistakesList().find((entry) => entry.key === firstKey).explain, '主语是单数，所以用 is。')
  equal('explain: empty text is rejected', exported.mistakesSetExplain(firstKey, '   '), false)

  const changedRows = rows.map((row) => row.questionId === rows[0].questionId ? { ...row, answer: 'a new answer' } : row)
  exported.mistakesSyncLesson(10, 'Look at...', changedRows)
  const changed = exported.mistakesList().find((entry) => entry.key === firstKey)
  equal('sync: edited answer is stored', changed.answer, 'a new answer')
  check('sync: edited entry keeps addedAt', changed.addedAt === firstAddedAt)
  equal('explain: a changed row drops the stale explanation', changed.explain, '')

  exported.mistakesSyncLesson(10, 'Look at...', changedRows.slice(0, 1))
  equal('sync: questions no longer wrong are dropped', exported.mistakesCount(), 1)

  equal('remove: existing key', exported.mistakesRemove(firstKey), true)
  equal('remove: missing key', exported.mistakesRemove(firstKey), false)
  equal('remove: count back to zero', exported.mistakesCount(), 0)

  exported.mistakesSyncLesson(10, 'Look at...', rows)
  equal('clear: lesson rows removed', exported.mistakesClearLesson(10) && exported.mistakesCount() === 0, true)
}

// ---------------------------------------------------------------------------
// 3. mistakesSyncPaper: no grading evidence must not touch the notebook
// ---------------------------------------------------------------------------
{
  store.clear()
  const ungraded = { version: 1, updatedAt: 1, graded: false, answers: {}, marks: {}, revealed: {}, ai: {} }
  exported.mistakesSyncPaper(10, 'Look at...', model, ungraded)
  equal('paper: ungraded sheet writes nothing', exported.mistakesCount(), 0)

  const paper = paperWithVerdicts(['wrong', 'close'])
  exported.mistakesSyncPaper(10, 'Look at...', model, paper)
  equal('paper: graded sheet collects rows', exported.mistakesCount(), 2)

  const collapsed = { ...paper, graded: false }
  exported.mistakesSyncPaper(10, 'Look at...', model, collapsed)
  equal('paper: 收起批改 with AI verdicts keeps rows', exported.mistakesCount(), 2)

  const cleared = { version: 1, updatedAt: 2, graded: false, answers: {}, marks: {}, revealed: {}, ai: {} }
  exported.mistakesSyncPaper(10, 'Look at...', model, cleared)
  equal('paper: empty sheet leaves rows alone', exported.mistakesCount(), 2)
}

// ---------------------------------------------------------------------------
// 4. One-time backfill: papers graded before the notebook existed
// ---------------------------------------------------------------------------
{
  store.clear()
  const paper = paperWithVerdicts(['wrong', 'close'])
  store.set('dsh-nce/paper/v1/lesson-10', JSON.stringify(paper))
  store.set('dsh-nce/paper/v1/lesson-11', JSON.stringify({ version: 1, graded: false, answers: {}, marks: {}, revealed: {}, ai: {} }))
  store.set('dsh-nce/paper/v1/lesson-12', JSON.stringify({ version: 1, graded: true, answers: {}, marks: { 'x:1': 'wrong' }, revealed: {}, ai: {} }))
  const realFetch = globalThis.fetch
  const lessonById = { 10: lesson, 11: lesson, 12: JSON.parse(readFileSync(path.join(dataDir, 'lessons', 'lesson-001.json'), 'utf8')) }
  globalThis.fetch = async (url, options) => {
    const body = options !== undefined && typeof options.body === 'string' ? JSON.parse(options.body) : {}
    const id = Number(body.id)
    return { ok: true, status: 200, json: async () => ({ ok: true, lesson: lessonById[id] }) }
  }
  const first = await exported.mistakesBackfillFromDrafts(false)
  equal('backfill: syncs drafts with grading evidence', first, 2)
  equal('backfill: rows collected from both drafts', exported.mistakesCount() > 0, true)
  const second = await exported.mistakesBackfillFromDrafts(false)
  equal('backfill: runs once per profile', second, 0)
  const forced = await exported.mistakesBackfillFromDrafts(true)
  equal('backfill: manual re-scan works', forced, 2)
  globalThis.fetch = realFetch
  store.clear()
}

// ---------------------------------------------------------------------------
// 4. MistakesPage render: empty state, grouped rows and 已掌握
// ---------------------------------------------------------------------------
function expand(node, depth = 0) {
  if (node === null || node === undefined || depth > 120) return node
  if (typeof node === 'string' || typeof node === 'number') return { text: String(node) }
  if (Array.isArray(node)) return node.map((child) => expand(child, depth + 1))
  if (typeof node !== 'object') return node
  if (typeof node.type === 'function') {
    return expand(node.type({ ...(node.props || {}), children: node.children }), depth + 1)
  }
  return { ...node, children: (node.children || []).map((child) => expand(child, depth + 1)) }
}
function collect(node, visit, depth = 0) {
  if (node === null || node === undefined || depth > 140) return
  if (typeof node === 'string' || typeof node === 'number') { visit({ text: String(node) }); return }
  if (Array.isArray(node)) { for (const child of node) collect(child, visit, depth + 1); return }
  if (typeof node !== 'object') return
  visit(node)
  for (const child of node.children || []) collect(child, visit, depth + 1)
}
function renderPage() {
  const tree = expand(exported.MistakesPage({}))
  const texts = []
  const classes = new Map()
  collect(tree, (node) => {
    if (node.text !== undefined) texts.push(node.text)
    const className = node.props && typeof node.props.className === 'string' ? node.props.className : ''
    for (const name of className.split(/\s+/)) {
      if (name !== '') classes.set(name, (classes.get(name) || 0) + 1)
    }
  })
  return { tree, texts, classes }
}
const hasText = (texts, value) => texts.some((text) => text.includes(value))
const countClass = (classes, name) => classes.get(name) || 0

{
  store.clear()
  const empty = renderPage()
  check('page: title', hasText(empty.texts, '错题本'))
  check('page: empty explanation', hasText(empty.texts, '错题本是空的') && hasText(empty.texts, '批改整卷'))
  equal('page: no lesson cards in the empty state', countClass(empty.classes, 'nce-mistakes-lesson'), 0)

  const paperA = paperWithVerdicts(['wrong', 'close'])
  exported.mistakesSyncLesson(10, 'Look at...', exported.PaperWrongRows(model, paperA))
  const lessonFixture = JSON.parse(readFileSync(path.join(dataDir, 'lessons', 'lesson-001.json'), 'utf8'))
  const modelB = exported.PaperBuildModel(lessonFixture)
  const paperB = { version: 1, updatedAt: Date.now(), graded: true, answers: {}, marks: {}, revealed: {}, ai: {} }
  const questionB = modelB.groups.flatMap((group) => group.questions).find((question) => question.isExample === false)
  for (const key of answerKeysOf(questionB)) paperB.answers[key] = 'wrong answer'
  paperB.ai[questionB.id] = { verdict: 'wrong', comment: '主谓不一致', answer: 'She is a teacher.' }
  exported.mistakesSyncLesson(1, 'Excuse me!', exported.PaperWrongRows(modelB, paperB))
  equal('page: two lessons seeded', exported.mistakesCount(), 3)

  const populated = renderPage()
  check('page: lesson cards', countClass(populated.classes, 'nce-mistakes-lesson') === 2, String(countClass(populated.classes, 'nce-mistakes-lesson')))
  equal('page: one row per mistake', countClass(populated.classes, 'nce-mistakes-item'), 3)
  check('page: lesson titles', hasText(populated.texts, 'Look at...') && hasText(populated.texts, 'Excuse me!'))
  check('page: verdict badges', hasText(populated.texts, '错误') && hasText(populated.texts, '近似'))
  check('page: student answer block', hasText(populated.texts, '你的答案'))
  check('page: reference block', hasText(populated.texts, '参考答案'))
  check('page: AI comment', hasText(populated.texts, '主谓不一致'))
  check('page: meta summary', hasText(populated.texts, '共 3 题') && hasText(populated.texts, '覆盖 2 课'))
  check('page: AI 讲解 button per row', countClass(populated.classes, 'nce-mistakes-explain-btn') === 3, String(countClass(populated.classes, 'nce-mistakes-explain-btn')))
  check('page: no explanation block before clicking', countClass(populated.classes, 'nce-mistakes-explain') === 0)

  // A stored explanation renders under the row.
  const explainedKey = exported.mistakesList()[0].key
  exported.mistakesSetExplain(explainedKey, 'AI 老师讲解：your son 是单数，所以用 How is your son?')
  const explainedPage = renderPage()
  check('page: explanation label', hasText(explainedPage.texts, 'AI 老师讲解'))
  check('page: explanation text', hasText(explainedPage.texts, 'How is your son?'))
  equal('page: explanation block rendered', countClass(explainedPage.classes, 'nce-mistakes-explain'), 1)
  check('page: explained row offers 重新讲解', hasText(explainedPage.texts, '重新讲解'))

  // Clicking every 「AI 讲解」 button asks the host and stores the answer.
  const fetchCalls = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url, options) => {
    fetchCalls.push({ url: String(url), body: JSON.parse(options.body) })
    return { ok: true, status: 200, json: async () => ({ ok: true, source: 'ai', model: 'fake-model', text: 'AI 老师讲解：主语是单数，用 is。' }) }
  }
  const explainButtons = []
  collect(explainedPage.tree, (node) => {
    const className = node.props && typeof node.props.className === 'string' ? node.props.className : ''
    if (className.split(/\s+/).includes('nce-mistakes-explain-btn') && typeof node.props.onClick === 'function') explainButtons.push(node)
  })
  check('page: explain buttons wired', explainButtons.length === 3, String(explainButtons.length))
  for (const button of explainButtons) button.props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
  equal('explain: every click called the host', fetchCalls.length, explainButtons.length)
  check('explain: host payload carries the question', String(fetchCalls[0]?.body?.prompt ?? '').length > 0)
  check('explain: host payload carries both answers', String(fetchCalls[0]?.body?.answer ?? '').length > 0)
  equal('explain: every row now carries an explanation', exported.mistakesList().filter((entry) => entry.explain !== '').length, 3)
  globalThis.fetch = realFetch

  // 已掌握 on the first row removes that stored entry.
  let mastered = null
  collect(populated.tree, (node) => {
    if (mastered !== null) return
    const className = node.props && typeof node.props.className === 'string' ? node.props.className : ''
    if (className.split(/\s+/).includes('nce-mistakes-master') && typeof node.props.onClick === 'function') mastered = node
  })
  check('page: 已掌握 button exists', mastered !== null)
  const beforeRemove = exported.mistakesCount()
  if (mastered !== null) mastered.props.onClick()
  equal('page: 已掌握 removes one row', exported.mistakesCount(), beforeRemove - 1)
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
if (failures.length > 0) {
  console.error(`test-mistakes: ${failures.length} failure(s)`)
  for (const failure of failures) console.error(`  ✗ ${failure}`)
  process.exit(1)
}
console.log(`test-mistakes: ok — ${checks} checks passed`)
