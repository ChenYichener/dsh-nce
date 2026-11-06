/**
 * Exercise-paper UI render tests ("AI 老师批改整卷" flow).
 *
 * `test-paper.mjs` covers the pure engine; this harness renders the real
 * `LessonExerciseTab` component from the client fragments with fake React hooks
 * and a fake localStorage draft. It locks the unified grading presentation:
 *
 *   - one primary button ("批改整卷" / "收起批改"), no second "AI 批改" button;
 *   - AI mode: 得分 = AI 判对 / 总题数, 「未答 / 待批」in the note, per-question
 *     AI verdicts rendered, no "无参考答案 · 自评（不计分）" badge;
 *   - partial grading: "AI 补批 N 题" only appears for answered-but-unjudged;
 *   - fallback: with no AI verdicts the deterministic score and its hint render.
 *
 * Usage: node scripts/test-paper-ui.mjs
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
// Load the fragments exactly like scripts/build-client.mjs does, but return the
// component symbols the way a test needs them.
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
// Fake browser + React (hooks are inert; one render pass is enough)
// ---------------------------------------------------------------------------
const store = new Map()
const fakeNce = {
  nav: { page: 'home', lessonId: 10, tab: 'exercise' },
  go() {}, openLesson() {}, progress: null, progressError: null,
  reloadProgress() {}, updateLesson: async () => {}, starWord() {}, gradeWord() {}, saveVideo() {},
}
const React = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  Fragment: Symbol('Fragment'),
  Component: class { constructor(props) { this.props = props } setState() {} },
  createContext: () => ({ $$context: true, _value: fakeNce, Provider: Symbol('Provider') }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect() {},
  useMemo(factory) { return factory() },
  useCallback(callback) { return callback },
  useContext: (context) => context?._value ?? null,
  useRef: (initial) => ({ current: initial ?? null }),
}
const windowStub = {
  localStorage: {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  },
  addEventListener() {}, removeEventListener() {},
  document: undefined,
  location: { href: 'http://127.0.0.1:50000/' },
}
globalThis.window = windowStub
const exported = new Function('require', 'window', 'document', 'navigator', `${fragmentCode}
  return { LessonExerciseTab, PaperBuildModel, PaperAiCandidates, PaperApplyAi, PaperQuestionAnswerKeys }
`)((name) => {
  if (name === 'react') return React
  throw new Error(`unexpected client module: ${name}`)
}, windowStub, undefined, undefined)

// ---------------------------------------------------------------------------
// Render + inspect helpers
// ---------------------------------------------------------------------------
function expand(node, depth = 0) {
  if (node === null || node === undefined || depth > 90) return node
  if (typeof node === 'string' || typeof node === 'number') return { text: String(node) }
  if (Array.isArray(node)) return node.map((child) => expand(child, depth + 1))
  if (typeof node !== 'object') return node
  if (typeof node.type === 'function') {
    return expand(node.type({ ...(node.props || {}), children: node.children }), depth + 1)
  }
  return { ...node, children: (node.children || []).map((child) => expand(child, depth + 1)) }
}
function collect(node, visit, depth = 0) {
  if (node === null || node === undefined || depth > 120) return
  if (typeof node === 'string' || typeof node === 'number') { visit({ text: String(node) }); return }
  if (Array.isArray(node)) { for (const child of node) collect(child, visit, depth + 1); return }
  if (typeof node !== 'object') return
  visit(node)
  for (const child of node.children || []) collect(child, visit, depth + 1)
}
function render(lesson, draft) {
  store.clear()
  if (draft !== undefined) store.set(`dsh-nce/paper/v1/lesson-${lesson.id}`, JSON.stringify(draft))
  const tree = expand(exported.LessonExerciseTab({ lesson }))
  const texts = []
  const classes = new Map()
  const aiRows = []
  collect(tree, (node) => {
    if (node.text !== undefined) texts.push(node.text)
    const props = node.props
    if (props === null || typeof props !== 'object') return
    if (typeof props.className === 'string') {
      for (const name of props.className.split(/\s+/)) classes.set(name, (classes.get(name) || 0) + 1)
    }
    if (props['data-paper-ai'] !== undefined) aiRows.push({ id: props['data-paper-ai'], verdict: props['data-verdict'] })
  })
  return { tree, texts, classes, aiRows }
}
const hasText = (texts, value) => texts.some((text) => text.includes(value))
const countClass = (classes, name) => classes.get(name) || 0

// ---------------------------------------------------------------------------
// Fixture: lesson 10, 18 textbook answers + 2 grammar-workbook answers
// ---------------------------------------------------------------------------
const lesson10 = JSON.parse(readFileSync(path.join(dataDir, 'lessons', 'lesson-010.json'), 'utf8'))
const model10 = exported.PaperBuildModel(lesson10)
const answers = {}
for (const group of model10.groups.filter((group) => group.source === 'ex')) {
  for (const question of group.questions) {
    for (const key of exported.PaperQuestionAnswerKeys(question)) {
      answers[key] = question.kind === 'blank' ? "He's" : "Look at the man. He's very fat."
    }
  }
}
const keyed = model10.groups
  .flatMap((group) => group.questions)
  .filter((question) => !question.isExample && question.referenceSource !== 'none')
for (const question of keyed.slice(0, 2)) {
  for (const key of exported.PaperQuestionAnswerKeys(question)) answers[key] = 'x'
}
const baseDraft = { version: 1, updatedAt: Date.now(), graded: false, answers, marks: {}, revealed: {}, ai: {} }
const candidates = exported.PaperAiCandidates(model10, baseDraft)

/** Build a draft graded by the AI teacher with the given per-id verdicts. */
function aiDraft(rows) {
  return { ...exported.PaperApplyAi(model10, baseDraft, rows), updatedAt: Date.now() }
}
function correctRows(ids) {
  return ids.map((id) => ({ id, verdict: 'correct', comment: '很好', answer: "He's" }))
}

// ---------------------------------------------------------------------------
// 1. Before grading: one button, whole-sheet hint, no AI verdicts
// ---------------------------------------------------------------------------
{
  const { texts, classes, aiRows } = render(lesson10, baseDraft)
  check('pre: primary button says 批改整卷', texts.includes('批改整卷'))
  check('pre: hint covers every answered question', hasText(texts, `全部 ${candidates.length} 道已答题`), texts.find((text) => text.includes('批改整卷')))
  equal('pre: no AI panels before grading', aiRows.length, 0)
  equal('pre: no score card before grading', countClass(classes, 'nce-paper-score'), 0)
  equal('pre: one primary grading button', countClass(classes, 'nce-paper-grade'), 1)
  equal('pre: no 补批 button before grading', countClass(classes, 'nce-paper-ai-grade'), 0)
}

// ---------------------------------------------------------------------------
// 2. AI mode, partially graded: unified score + pending batches + 补批 button
// ---------------------------------------------------------------------------
{
  const ids = candidates.map((item) => item.id)
  const rows = correctRows(ids.slice(0, 17))
  rows.push({ id: ids[17], verdict: 'close', comment: '差一点', answer: 'He is' })
  const draft = aiDraft(rows)
  const { tree, texts, classes, aiRows } = render(lesson10, draft)
  equal('partial: 18 AI panels', aiRows.length, 18)
  equal('partial: one score card', countClass(classes, 'nce-paper-score'), 1)
  equal('partial: unified score is AI correct / all questions', texts.find((text) => /^\d+ \/ \d+$/.test(text)), '17 / 38')
  const noteNodes = []
  collect(tree, (node) => {
    if (node.props && typeof node.props.className === 'string' && node.props.className.split(/\s+/).includes('nce-paper-score-note')) noteNodes.push(node)
  })
  const noteText = []
  if (noteNodes.length > 0) collect(noteNodes[0], (node) => { if (node.text !== undefined) noteText.push(node.text) })
  check('partial: note names 未答 and 待批', noteText.join('').includes('未答 18') && noteText.join('').includes('待批 2'), noteText.join(''))
  check('partial: collapse button appears when graded', texts.includes('收起批改'))
  check('partial: 补批 button counts the pending questions', texts.includes('AI 补批 2 题'))
  check('partial: group meta reports AI grading', hasText(texts, 'AI 批改 6') && hasText(texts, 'AI 批改 12'))
  check('partial: no self-assess badge in AI mode', !hasText(texts, '无参考答案 · 自评（不计分）'))
}

// ---------------------------------------------------------------------------
// 3. AI mode, fully graded: no 补批 button, manual override moves the score
// ---------------------------------------------------------------------------
{
  const ids = candidates.map((item) => item.id)
  const rows = correctRows(ids.slice(0, 18))
  rows.push({ id: ids[18], verdict: 'wrong', comment: '主谓不一致', answer: 'She is' })
  rows.push({ id: ids[19], verdict: 'close', comment: '差一点', answer: 'It is' })
  const full = aiDraft(rows)
  const graded = render(lesson10, full)
  equal('full: 20 AI panels', graded.aiRows.length, 20)
  check('full: no 补批 button', !hasText(graded.texts, 'AI 补批'))
  check('full: note counts the teacher verdicts', graded.texts.includes('AI 老师：') && hasText(graded.texts, '错误 1'))
  equal('full: score value', graded.texts.find((text) => /^\d+ \/ \d+$/.test(text)), '18 / 38')

  const overridden = { ...full, marks: { [ids[18]]: 'right' } }
  const overrideRender = render(lesson10, overridden)
  equal('override: manual 判对 moves the unified score', overrideRender.texts.find((text) => /^\d+ \/ \d+$/.test(text)), '19 / 38')
}

// ---------------------------------------------------------------------------
// 4. Fallback: no AI verdicts → deterministic score + self-assess explanation
// ---------------------------------------------------------------------------
{
  const fallbackDraft = { ...baseDraft, graded: true }
  const { texts, classes } = render(lesson10, fallbackDraft)
  equal('fallback: deterministic score card', countClass(classes, 'nce-paper-score'), 1)
  check('fallback: deterministic score value', texts.includes('0 / 20'), texts.filter((text) => /^\d+ \/ \d+$/.test(text)).join(','))
  check('fallback: explains self-assessed questions', hasText(texts, '只能自评、不计入得分'))
  check('fallback: self-assess badge returns', hasText(texts, '无参考答案 · 自评（不计分）'))
  check('fallback: no AI note', !hasText(texts, 'AI 老师：正确'))
  check('fallback: offers an AI grade for the answered questions', texts.includes(`AI 批改 ${candidates.length} 题`))
}

// ---------------------------------------------------------------------------
// 5. Stacked questions: one prompt row + one answer line per question
//    (lesson 10 workbook I.2 "Is that pencil long? / Is it short?")
// ---------------------------------------------------------------------------
{
  const group = model10.groups.find((candidate) => candidate.source === 'gwb' && candidate.label === 'I.')
  const question = group.questions.find((candidate) => candidate.num === 2)
  const keys = exported.PaperQuestionAnswerKeys(question)
  equal('stacked: item 2 asks two questions', question.lines.length, 2)
  equal('stacked: item 2 has two answer keys', keys.length, 2)

  const stackedAnswers = { ...baseDraft.answers, [keys[0]]: "No, it isn't.", [keys[1]]: 'Yes, it is.' }
  const draft = { ...baseDraft, answers: stackedAnswers }
  const rendered = render(lesson10, draft)
  const inputs = []
  collect(rendered.tree, (node) => {
    if (node?.props && typeof node.props === 'object' && node.props['data-paper-input'] !== undefined) {
      inputs.push(node.props['data-paper-input'])
    }
  })
  check('stacked: both answer inputs render', inputs.includes(keys[0]) && inputs.includes(keys[1]))
  check('stacked: question rows stay separate', hasText(rendered.texts, 'Is that pencil long?') && hasText(rendered.texts, 'Is it short?'))
  check('stacked: two answer-line rows render', countClass(rendered.classes, 'nce-paper-line-row') >= 2)
  check('stacked: inline answer inputs render', countClass(rendered.classes, 'nce-paper-line-answer') >= 2)

  const example = group.questions.find((candidate) => candidate.num === 1)
  check('example: two printed answer rows', countClass(rendered.classes, 'nce-paper-example-row') >= 2)
  check('example: printed example answers visible', hasText(rendered.texts, "No, I'm not.") && hasText(rendered.texts, 'Yes, I am.'))
  check('example: no input for example item', !inputs.includes(`${example.id}#a`))

  const gradedDraft = { ...draft, graded: true }
  const graded = render(lesson10, gradedDraft)
  check('stacked: per-line marks after grading', countClass(graded.classes, 'nce-paper-line-mark') >= 2)
  check('stacked: reference answers shown after grading', hasText(graded.texts, "No, it isn't."))
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
if (failures.length > 0) {
  console.error(`test-paper-ui: ${failures.length} failure(s)`)
  for (const failure of failures) console.error(`  ✗ ${failure}`)
  process.exit(1)
}
console.log(`test-paper-ui: ok — ${checks} checks passed`)
