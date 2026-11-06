/**
 * Single-page lesson render tests.
 *
 * The lesson used to be a stage bar + tabs (预习 / 学习中 / 课后作业 / 回忆). It is
 * now one continuous page — header → sticky anchor bar → 视频 → 课文 + 单词
 * → 语法 → 练习 — and the study steps shrank from five to three. This harness
 * renders the real `LessonPage` from the client fragments with fake React hooks,
 * a fake learning store and a fake localStorage, and locks that structure:
 *
 *   - five anchored sections in order, 课文/单词 side by side, no tab chrome;
 *   - the 预习 / 回忆 / 复习 pages and their buttons are gone;
 *   - the header only reports status/steps (editing lives in the course list) and
 *     each section can tick its own step;
 *   - the video section is collapsed by default (click 展开视频 to load it) and
 *     the exercise paper + homework checklist render inline, with no page footer;
 *   - the legacy tab ids and unknown deep links map to anchors without throwing.
 *
 * Usage: node scripts/test-lesson-page.mjs
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
// Load the fragments like scripts/build-client.mjs does (99-entry excluded: the
// page does not need the slot registration).
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
// Fixtures: real lesson 1 (dialogue + vocab + text notes + classroom notes).
// ---------------------------------------------------------------------------
const lesson = JSON.parse(readFileSync(path.join(dataDir, 'lessons', 'lesson-001.json'), 'utf8'))
const indexFixture = {
  index: {
    book: { lessonCount: 144 },
    lessons: [{ id: lesson.id, titleEn: lesson.titleEn, titleZh: lesson.titleZh }],
  },
}
const notePages = (lesson.notes ?? []).filter((page) => (page.blocks ?? []).length > 0)

// ---------------------------------------------------------------------------
// Fake browser + React (hooks are inert; one render pass is enough)
// ---------------------------------------------------------------------------
const store = new Map()
let navState = { page: 'home', lessonId: lesson.id, tab: '' }
const updateCalls = []
const fakeNce = {
  get nav() { return navState },
  go() {},
  openLesson() {},
  progress: null,
  progressError: null,
  reloadProgress() {},
  updateLesson: async (id, patch) => {
    updateCalls.push({ id, patch })
    return {}
  },
  starWord() {},
  gradeWord() {},
  saveVideo() {},
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
  localStorage: {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  },
  addEventListener() {}, removeEventListener() {},
  location: { href: 'http://127.0.0.1:50000/' },
}
const exported = new Function(
  'require', 'window', 'document', 'navigator', '__LESSON__', '__INDEX__',
  `${fragmentCode}
  useLesson = () => ({ data: __LESSON__, loading: false, error: null })
  useIndex = () => ({ data: __INDEX__, loading: false, error: null })
  return {
    LessonPage, LessonAnchorOf, LESSON_STEPS, LESSON_ANCHORS, LessonSection, LessonStepToggle,
  }
`,
)((name) => {
  if (name === 'react') return React
  throw new Error(`unexpected client module: ${name}`)
}, windowStub, undefined, undefined, lesson, indexFixture)

// ---------------------------------------------------------------------------
// Render + inspect helpers
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
  if (node === null || node === undefined || depth > 150) return
  if (typeof node === 'string' || typeof node === 'number') { visit({ text: String(node) }); return }
  if (Array.isArray(node)) { for (const child of node) collect(child, visit, depth + 1); return }
  if (typeof node !== 'object') return
  visit(node)
  for (const child of node.children || []) collect(child, visit, depth + 1)
}
function nodeText(node) {
  const parts = []
  collect(node, (item) => { if (item.text !== undefined) parts.push(item.text) })
  return parts.join('')
}
function renderPage(tab) {
  navState = { page: 'home', lessonId: lesson.id, tab: tab ?? '' }
  const tree = expand(exported.LessonPage({ embedded: true }))
  const texts = []
  const classes = new Map()
  const anchors = []
  const paperLessons = []
  collect(tree, (node) => {
    if (node.text !== undefined) texts.push(node.text)
    const props = node.props
    if (props === null || typeof props !== 'object') return
    if (typeof props.className === 'string') {
      for (const name of props.className.split(/\s+/)) {
        if (name !== '') classes.set(name, (classes.get(name) || 0) + 1)
      }
    }
    if (props['data-lesson-anchor'] !== undefined) anchors.push(props['data-lesson-anchor'])
    if (props['data-paper-lesson'] !== undefined) paperLessons.push(props['data-paper-lesson'])
  })
  return { tree, texts, classes, anchors, paperLessons }
}
function findClass(tree, name) {
  let found = null
  collect(tree, (node) => {
    if (found !== null) return
    const className = node.props && typeof node.props.className === 'string' ? node.props.className : ''
    if (className.split(/\s+/).includes(name)) found = node
  })
  return found
}
function findButton(tree, label) {
  let found = null
  collect(tree, (node) => {
    if (found !== null) return
    const className = node.props && typeof node.props.className === 'string' ? node.props.className : ''
    if (!className.split(/\s+/).includes('nce-btn')) return
    if (typeof node.props.onClick !== 'function') return
    if (nodeText(node).includes(label)) found = node
  })
  return found
}
const hasText = (texts, value) => texts.some((text) => text.includes(value))
const countClass = (classes, name) => classes.get(name) || 0

// ---------------------------------------------------------------------------
// 1. Model: three steps, old tab ids become anchors
// ---------------------------------------------------------------------------
{
  equal('steps: ids are 单词/语法/练习', exported.LESSON_STEPS.map((step) => step.id).join(','), 'words,grammar,exercise')
  equal('steps: labels', exported.LESSON_STEPS.map((step) => step.label).join(','), '单词,语法,练习')
  equal('anchor: 预习 maps to 课文', exported.LessonAnchorOf('preview'), 'text')
  equal('anchor: 视频 tab maps to video', exported.LessonAnchorOf('video'), 'video')
  equal('anchor: 作业清单 maps to 练习', exported.LessonAnchorOf('homework'), 'exercise')
  equal('anchor: 练习卷 maps to 练习', exported.LessonAnchorOf('exercise'), 'exercise')
  equal('anchor: 回忆 has no anchor', exported.LessonAnchorOf('recall'), '')
  equal('anchor: 复习状态 has no anchor', exported.LessonAnchorOf('review'), '')
  equal('anchor: unknown deep link is ignored', exported.LessonAnchorOf('nope'), '')
  equal('anchor: empty value is ignored', exported.LessonAnchorOf(''), '')
}

// ---------------------------------------------------------------------------
// 2. Page structure: header, anchor bar, five sections, 课文 + 单词 columns
// ---------------------------------------------------------------------------
{
  const { tree, texts, classes, anchors, paperLessons } = renderPage('')
  equal('page: five anchored sections in reading order', anchors.join(','), 'video,text,words,grammar,exercise')
  equal('page: one sticky anchor bar', countClass(classes, 'nce-lesson-anchors'), 1)
  equal('page: five anchor buttons', countClass(classes, 'nce-lesson-anchor'), 5)
  check('page: anchor bar has a label', hasText(texts, '跳到'))
  equal('video: collapsed by default (no player mounted)', countClass(classes, 'nce-lesson-video-frame'), 0)
  equal('video: collapsed placeholder card is gone too', countClass(classes, 'nce-lesson-video'), 0)
  check('video: offers 展开视频', findButton(tree, '展开视频') !== null)
  equal('page: one two-column row', countClass(classes, 'nce-lesson-cols'), 1)
  const cols = findClass(tree, 'nce-lesson-cols')
  const colsAnchors = []
  collect(cols, (node) => {
    const props = node.props
    if (props && props['data-lesson-anchor'] !== undefined) colsAnchors.push(props['data-lesson-anchor'])
  })
  equal('page: 课文 on the left, 单词 on the right', colsAnchors.join(','), 'text,words')
  equal('page: no bottom footer block', countClass(classes, 'nce-lesson-end'), 0)
  equal('page: 上一课/下一课 are header-only icon buttons', countClass(classes, 'nce-lesson-head-turn'), 1)
  check('page: no bottom 下一课 button', findButton(tree, '下一课') === null)

  // No tab chrome / no removed stages.
  equal('removed: no stage bar', countClass(classes, 'nce-lesson-stagebar'), 0)
  equal('removed: no stage tabs', countClass(classes, 'nce-lesson-subtabs'), 0)
  equal('removed: no 复习状态 page', countClass(classes, 'nce-lesson-review'), 0)
  equal('removed: no 回忆 cards', countClass(classes, 'nce-recall-word'), 0)
  equal('removed: no old flow hero', countClass(classes, 'nce-flow-hero'), 0)
  for (const label of ['标记预习完成', '下一步：学习中', '回忆训练', '复习状态', '去回忆', '回忆错题']) {
    check(`removed: no「${label}」`, !hasText(texts, label))
  }

  // Header.
  check('header: book lesson number', hasText(texts, '第 1 课'))
  check('header: lesson title', hasText(texts, lesson.titleEn))
  check('header: chinese title', hasText(texts, lesson.titleZh))
  check('header: vocab count', hasText(texts, `${lesson.vocab.length} 个生词`))
  check('header: dialogue count', hasText(texts, `${lesson.dialogue.length} 句对话`))
  check('header: three-step progress', hasText(texts, '已完成 0/3'))
  equal('header: read-only status badge', countClass(classes, 'nce-lesson-head-status'), 1)
  check('header: no 标记学完 button (status is edited in the course list)', findButton(tree, '标记学完') === null)
  check('header: no 重新学习 button', findButton(tree, '重新学习') === null)

  // Sections carry their content.
  equal('text: one dialogue row per line', countClass(classes, 'nce-lesson-dialogue-row'), lesson.dialogue.length)
  equal('words: one row per word', countClass(classes, 'nce-lesson-vocab-row'), lesson.vocab.length)
  check('words: links to 记忆卡', findButton(tree, '去记忆卡') !== null)
  equal('grammar: every text note', countClass(classes, 'nce-lesson-textnote'), lesson.textNotes.length)
  check('grammar: text notes caption', hasText(texts, `课文注释 · ${lesson.textNotes.length} 条`))
  equal('grammar: one block per classroom page', countClass(classes, 'nce-lesson-noteblocks'), notePages.length)
  check('grammar: classroom note heading', hasText(texts, `课堂笔记 · 第 ${notePages[0].page} 页`))
  equal('exercise: homework checklist is folded in', countClass(classes, 'nce-lesson-hw'), 1)
  check('exercise: homework heading', hasText(texts, '作业清单'))
  check('exercise: paper is inline', paperLessons.join(',') === String(lesson.id))
  equal('exercise: one grading button', countClass(classes, 'nce-paper-grade'), 1)
  check('exercise: paper hero explains grading', hasText(texts, '批改整卷'))
  equal('steps: one toggle per section', countClass(classes, 'nce-lesson-step-toggle'), 3)
}

// ---------------------------------------------------------------------------
// 3. Progress: per-section ticks, and a read-only lesson status in the header
// ---------------------------------------------------------------------------
{
  fakeNce.progress = {
    lessons: { [lesson.id]: { status: 'learning', steps: { words: true }, updatedAt: 1, lastVisit: 1 } },
    words: {},
  }
  updateCalls.length = 0
  const { tree, texts } = renderPage('')
  check('progress: header counts the finished step', hasText(texts, '已完成 1/3'))
  check('progress: finished step shows 已完成', nodeText(findClass(tree, 'nce-lesson-step-toggle')).includes('已完成'))

  const stepToggle = findClass(tree, 'nce-lesson-step-toggle')
  stepToggle.props.onClick()
  await Promise.resolve()
  await Promise.resolve()
  equal('progress: clicking a finished step only toggles that step', JSON.stringify(updateCalls[0]?.patch), JSON.stringify({ steps: { words: false } }))

  fakeNce.progress = {
    lessons: { [lesson.id]: { status: 'done', steps: { words: true, grammar: true, exercise: true }, updatedAt: 1, lastVisit: 1 } },
    words: {},
  }
  updateCalls.length = 0
  const doneRender = renderPage('')
  check('progress: done lesson badge', hasText(doneRender.texts, '已学完'))
  equal('progress: done lesson header does not write status', updateCalls.length, 0)
}

// ---------------------------------------------------------------------------
// 4. Legacy deep links render the same page (anchor jump is a no-op in tests)
// ---------------------------------------------------------------------------
{
  for (const tab of ['exercise', 'preview', 'recall', 'homework', 'nonsense']) {
    navState = { page: 'home', lessonId: lesson.id, tab }
    let error = null
    let rendered = null
    try {
      rendered = renderPage(tab)
    } catch (failure) {
      error = failure
    }
    check(`deep link: ${tab} renders without throwing`, error === null, error?.stack ?? String(error))
    if (rendered !== null) {
      equal(`deep link: ${tab} keeps the five sections`, rendered.anchors.join(','), 'video,text,words,grammar,exercise')
    }
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
if (failures.length > 0) {
  console.error(`test-lesson-page: ${failures.length} failure(s)`)
  for (const failure of failures) console.error(`  ✗ ${failure}`)
  process.exit(1)
}
console.log(`test-lesson-page: ok — ${checks} checks passed`)
