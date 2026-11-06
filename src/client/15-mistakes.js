// Layer: 15 mistakes — depends on: 00-platform (hooks), 11-mistake-rows (`PaperWrongRows`) and the browser localStorage.
// Mistake notebook store: the wrong / near-miss rows collected from graded
// exercise papers (the paper UI pushes them here, the 错题本 page reads them).

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------
//
// One localStorage document for the whole book. Rows are keyed by
// `<lessonId>:<questionId>` so re-grading the same paper updates the same entry
// instead of piling up duplicates.

const MISTAKES_KEY = 'dsh-nce/mistakes/v1'
const MISTAKES_LIMIT = 600
const MISTAKES_EVENT = 'dsh-nce:mistakes'

function mistakesClip(value, length) {
  return String(value ?? '').slice(0, length)
}

/** One sanitized stored row, or null when the shape is unusable. */
function mistakesEntry(raw, key) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const lessonId = Number(raw.lessonId)
  if (!Number.isInteger(lessonId) || lessonId <= 0) return null
  const questionId = mistakesClip(raw.questionId, 120)
  if (questionId === '') return null
  const verdict = raw.verdict === 'close' ? 'close' : raw.verdict === 'wrong' ? 'wrong' : ''
  if (verdict === '') return null
  return {
    key: mistakesClip(raw.key, 160) !== '' ? mistakesClip(raw.key, 160) : key,
    lessonId,
    lessonTitle: mistakesClip(raw.lessonTitle, 160),
    questionId,
    num: mistakesClip(raw.num, 24),
    group: mistakesClip(raw.group, 120),
    source: raw.source === 'gwb' ? 'gwb' : 'ex',
    prompt: mistakesClip(raw.prompt, 800),
    answer: mistakesClip(raw.answer, 500),
    reference: Array.isArray(raw.reference) ? raw.reference.filter((line) => typeof line === 'string' && line.trim() !== '').slice(0, 6).map((line) => mistakesClip(line, 400)) : [],
    verdict,
    comment: mistakesClip(raw.comment, 300),
    explain: mistakesClip(raw.explain, 1200),
    explainedAt: Number(raw.explainedAt) || 0,
    addedAt: Number(raw.addedAt) || 0,
    updatedAt: Number(raw.updatedAt) || 0,
  }
}

/** All stored mistakes as a `key -> row` map (never throws). */
function mistakesRead() {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(MISTAKES_KEY)
    if (raw === null || raw === '') return {}
    const parsed = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const map = {}
    for (const [key, value] of Object.entries(parsed)) {
      const entry = mistakesEntry(value, key)
      if (entry !== null) map[entry.key] = entry
    }
    return map
  } catch {
    return {}
  }
}

/** Persist a map (oldest rows are dropped above the cap) and notify the UI. */
function mistakesWrite(map) {
  if (typeof window === 'undefined') return {}
  const entries = Object.values(map).sort((left, right) => right.updatedAt - left.updatedAt)
  const kept = {}
  for (const entry of entries.slice(0, MISTAKES_LIMIT)) kept[entry.key] = entry
  try {
    window.localStorage.setItem(MISTAKES_KEY, JSON.stringify(kept))
  } catch {
    // Best effort, same as the paper draft.
  }
  try {
    window.dispatchEvent(new Event(MISTAKES_EVENT))
  } catch {
    // No window event support: the page also reloads on focus.
  }
  return kept
}

/** Newest-first list for the 错题本 page. */
function mistakesList() {
  return Object.values(mistakesRead()).sort((left, right) => right.updatedAt - left.updatedAt || left.lessonId - right.lessonId || left.key.localeCompare(right.key))
}

function mistakesCount() {
  return Object.keys(mistakesRead()).length
}

/** True when nothing but the timestamp/order-relevant fields changed. */
function mistakesSameContent(left, right) {
  if (left === undefined) return false
  return left.lessonTitle === right.lessonTitle
    && left.num === right.num
    && left.group === right.group
    && left.source === right.source
    && left.prompt === right.prompt
    && left.answer === right.answer
    && left.verdict === right.verdict
    && left.comment === right.comment
    && left.reference.length === right.reference.length
    && left.reference.every((line, index) => line === right.reference[index])
}

/**
 * Reconcile one lesson's row set with the notebook: upsert the current wrong /
 * close questions, drop the ones that are no longer wrong. Called by the paper
 * UI after grading / marking / editing.
 */
function mistakesSyncLesson(lessonId, lessonTitle, rows) {
  const id = Number(lessonId)
  if (!Number.isInteger(id) || id <= 0) return { changed: false,total: 0 }
  const map = mistakesRead()
  const now = Date.now()
  const keep = new Set()
  let changed = false
  for (const row of Array.isArray(rows) ? rows : []) {
    const questionId = mistakesClip(row?.questionId, 120)
    if (questionId === '') continue
    const key = `${id}:${questionId}`
    keep.add(key)
    const candidate = {
      key,
      lessonId: id,
      lessonTitle: mistakesClip(lessonTitle, 160),
      questionId,
      num: mistakesClip(row.num, 24),
      group: mistakesClip(row.group, 120),
      source: row.source === 'gwb' ? 'gwb' : 'ex',
      prompt: mistakesClip(row.prompt, 800),
      answer: mistakesClip(row.answer, 500),
      reference: Array.isArray(row.reference) ? row.reference.filter((line) => typeof line === 'string' && line.trim() !== '').slice(0, 6).map((line) => mistakesClip(line, 400)) : [],
      verdict: row.verdict === 'close' ? 'close' : 'wrong',
      comment: mistakesClip(row.comment, 300),
      explain: '',
      explainedAt: 0,
      addedAt: 0,
      updatedAt: now,
    }
    const previous = map[key]
    if (mistakesSameContent(previous, candidate)) {
      candidate.addedAt = previous.addedAt
      candidate.updatedAt = previous.updatedAt
      candidate.explain = previous.explain
      candidate.explainedAt = previous.explainedAt
      map[key] = candidate
      continue
    }
    candidate.addedAt = previous !== undefined && previous.addedAt > 0 ? previous.addedAt : now
    map[key] = candidate
    changed = true
  }
  for (const [key, entry] of Object.entries(map)) {
    if (entry.lessonId === id && keep.has(key) === false) {
      delete map[key]
      changed = true
    }
  }
  const total = changed ? Object.keys(mistakesWrite(map)).length : Object.keys(map).length
  return { changed, total }
}

/**
 * Reconcile one paper with the notebook. `has grading evidence` = the sheet was
 * graded, or has manual marks / AI verdicts; otherwise (never graded, or a
 * deterministic sheet whose grading is collapsed) the book is left untouched.
 */
function mistakesSyncPaper(lessonId, lessonTitle, model, paper) {
  const marks = paper !== null && typeof paper === 'object' && paper.marks !== null && typeof paper.marks === 'object' ? paper.marks : {}
  const hasAi = Object.keys(PaperAiRows(paper)).length > 0
  if (paper.graded !== true && Object.keys(marks).length === 0 && !hasAi) return { changed: false, total: mistakesCount() }
  return mistakesSyncLesson(lessonId, lessonTitle, PaperWrongRows(model, paper))
}

/** Store an AI teacher explanation for one stored row (keeps ordering intact). */
function mistakesSetExplain(key, text) {
  const name = mistakesClip(key, 160)
  const value = mistakesClip(String(text ?? '').trim(), 1200)
  if (name === '' || value === '') return false
  const map = mistakesRead()
  const entry = map[name]
  if (entry === undefined) return false
  entry.explain = value
  entry.explainedAt = Date.now()
  mistakesWrite(map)
  return true
}

function mistakesRemove(key) {
  const name = mistakesClip(key, 160)
  if (name === '') return false
  const map = mistakesRead()
  if (map[name] === undefined) return false
  delete map[name]
  mistakesWrite(map)
  return true
}

function mistakesClearLesson(lessonId) {
  const id = Number(lessonId)
  if (!Number.isInteger(id) || id <= 0) return false
  const map = mistakesRead()
  let changed = false
  for (const [key, entry] of Object.entries(map)) {
    if (entry.lessonId === id) {
      delete map[key]
      changed = true
    }
  }
  if (changed) mistakesWrite(map)
  return changed
}

/** Live count for the nav tab; refreshes when the paper UI writes the store. */
function useMistakeCount() {
  const [count, setCount] = useState(() => mistakesCount())
  useEffect(() => {
    const load = () => setCount(mistakesCount())
    window.addEventListener(MISTAKES_EVENT, load)
    window.addEventListener('focus', load)
    return () => {
      window.removeEventListener(MISTAKES_EVENT, load)
      window.removeEventListener('focus', load)
    }
  }, [])
  return count
}
