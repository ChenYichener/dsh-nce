// Layer: 31 flow-ui — depends on: 00-platform, 01-domain (`LessonArray`), 04-tts, 07-ui (Icon/Speaker).
// The 练习 blocks below the paper: the homework checklist parsed out of the classroom
// notes (ticked in localStorage) and the 课堂跟读 practice blocks. Both are folded
// into collapsible cards so the single-page lesson stays scannable.

// ---------------------------------------------------------------------------
// 作业清单：老师留的作业解析 + 本机勾选状态
//
// The lesson page is one long page now, so the homework checklist is no longer a
// separate tab: it is a collapsible card at the top of the 练习 section. Ticks are
// stored per lesson in localStorage, exactly like the exercise-paper draft.
// ---------------------------------------------------------------------------

const HOMEWORK_STORE_PREFIX = 'dsh-nce/homework/v1/lesson-'

function LessonHomeworkBlocks(lesson) {
  const result = { homework: [], practice: [] }
  for (const page of LessonArray(lesson?.notes)) {
    for (const block of LessonArray(page?.blocks)) {
      const type = String(block?.type ?? '')
      if (type !== 'homework' && type !== 'practice') continue
      const entry = {
        page: Number(page?.page) || 0,
        title: String(block?.title ?? '').trim(),
        lines: LessonArray(block?.lines).map((line) => String(line ?? '').trim()).filter((line) => line !== ''),
      }
      if (type === 'homework') result.homework.push(entry)
      else result.practice.push(entry)
    }
  }
  return result
}

/** Actionable homework first, generic "explain the lesson to yourself" last. */
function LessonHomeworkWeight(text) {
  if (/绿皮书|写作练习|跟读|熟读|背诵|造句/.test(text)) return 0
  if (/讲解|回忆|Learning Pyramid|学习金字塔/i.test(text)) return 2
  return 1
}

function LessonHomeworkTasks(lesson) {
  const blocks = LessonHomeworkBlocks(lesson)
  const tasks = []
  const seen = new Set()
  for (const block of blocks.homework) {
    for (const line of block.lines) {
      // Some source rows pack several tasks into one line with "；"/";".
      for (const part of line.split(/[;；]/)) {
        const text = part.trim()
        // The same homework list can repeat on several notes pages.
        const key = text.toLowerCase().replace(/\s+/g, '')
        if (text === '' || seen.has(key)) continue
        seen.add(key)
        tasks.push({ title: block.title, text, page: block.page, weight: LessonHomeworkWeight(text) })
      }
    }
  }
  tasks.sort((left, right) => left.weight - right.weight)
  return {
    blocks,
    tasks: tasks.map((task, index) => ({ ...task, index })),
  }
}

function readHomeworkDone(lessonId) {
  try {
    const raw = window.localStorage.getItem(`${HOMEWORK_STORE_PREFIX}${lessonId}`)
    if (raw === null || raw === '') return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value >= 0)
  } catch {
    return []
  }
}

function writeHomeworkDone(lessonId, list) {
  try {
    window.localStorage.setItem(`${HOMEWORK_STORE_PREFIX}${lessonId}`, JSON.stringify(list))
  } catch {
    // Best effort, same as the paper draft.
  }
}

/** Collapsible 作业清单 card; renders nothing when the notes carry no homework. */
function LessonHomeworkChecklist(props) {
  const lessonId = Number(props.id) || 0
  const { tasks } = useMemo(() => LessonHomeworkTasks(props.lesson), [props.lesson])
  const [done, setDone] = useState(() => readHomeworkDone(lessonId))
  if (tasks.length === 0) return null
  const doneSet = new Set(done)
  const doneCount = tasks.filter((task) => doneSet.has(task.index)).length

  const toggleTask = (index) => {
    setDone((previous) => {
      const next = previous.includes(index)
        ? previous.filter((value) => value !== index)
        : previous.concat(index).sort((a, b) => a - b)
      writeHomeworkDone(lessonId, next)
      return next
    })
  }

  return h('details', { className: 'nce-lesson-hw nce-card' },
    h('summary', { className: 'nce-lesson-hw-summary' },
      Icon('list', 14),
      h('span', { className: 'nce-lesson-hw-title' }, '作业清单'),
      h('span', { className: 'nce-lesson-hw-count' }, `${doneCount}/${tasks.length} 已完成 · 勾选存在本机`),
      Icon('chevronDown', 13)),
    h('ul', { className: 'nce-lesson-hw-tasks' }, tasks.map((task) => {
      const checked = doneSet.has(task.index)
      return h('li', { key: task.index, className: cx('nce-lesson-hw-task', checked && 'is-done') },
        h('button', {
          type: 'button',
          className: 'nce-lesson-hw-check',
          role: 'checkbox',
          'aria-checked': checked,
          'aria-label': task.text,
          onClick: () => toggleTask(task.index),
        }, checked ? Icon('check', 12) : null),
        h('div', { className: 'nce-lesson-hw-task-body' },
          h('span', { className: 'nce-lesson-hw-task-text' }, task.text),
          task.title !== '' ? h('span', { className: 'nce-lesson-hw-task-title' }, task.title) : null))
    })))
}

/** 课堂跟读 / 听说练习 blocks from the classroom notes (one collapsible each). */
function LessonPracticeBlocks(props) {
  const { practice } = useMemo(() => LessonHomeworkBlocks(props.lesson), [props.lesson])
  if (practice.length === 0) return null
  return h('div', { className: 'nce-lesson-practice' }, practice.map((block, index) => {
    const title = block.title !== '' ? block.title : `练习 ${index + 1}`
    const lines = block.lines.map((line, lineIndex) => h('div', { key: lineIndex, className: 'nce-lesson-practice-line' },
      h('span', null, line),
      /[A-Za-z]/.test(line) ? h(Speaker, { text: line.replace(/^[0-9]+\s*/, '') }) : null))
    return h('details', { key: index, className: 'nce-lesson-practice-block nce-card' },
      h('summary', { className: 'nce-lesson-practice-summary' },
        Icon('headphones', 13),
        h('span', { className: 'nce-lesson-practice-title' }, title),
        h('span', { className: 'nce-lesson-practice-count' }, `${block.lines.length} 句`),
        Icon('chevronDown', 13)),
      h('div', { className: 'nce-lesson-practice-lines' }, lines))
  }))
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

addCss(`
  .nce-lesson-hw { padding: 0; overflow: hidden; }
  .nce-lesson-hw-summary,
  .nce-lesson-practice-summary {
    display: flex; align-items: center; gap: 8px;
    padding: 13px 16px; cursor: pointer; list-style: none;
    font-size: 12.5px; transition: background .14s ease;
  }
  .nce-lesson-hw-summary:hover,
  .nce-lesson-practice-summary:hover { background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.07)); }
  .nce-lesson-hw-summary::-webkit-details-marker,
  .nce-lesson-practice-summary::-webkit-details-marker { display: none; }
  .nce-lesson-hw-summary .nce-icon:last-child,
  .nce-lesson-practice-summary .nce-icon:last-child {
    margin-left: auto; color: var(--dsw-alias-label-secondary, #8a8f98);
    transition: transform .15s ease;
  }
  .nce-lesson-hw[open] .nce-lesson-hw-summary .nce-icon:last-child,
  .nce-lesson-practice-block[open] .nce-lesson-practice-summary .nce-icon:last-child { transform: rotate(180deg); }
  .nce-lesson-hw-title { font-weight: 680; font-size: 13px; }
  .nce-lesson-hw-count { margin-left: 2px; font-size: 11px; color: var(--dsw-alias-label-secondary, #8a8f98); }
  .nce-lesson-hw-tasks { list-style: none; margin: 0; padding: 0 14px 12px; display: flex; flex-direction: column; gap: 6px; }
  .nce-lesson-hw-task { display: flex; align-items: flex-start; gap: 10px; }
  .nce-lesson-hw-task.is-done { opacity: .62; }
  .nce-lesson-hw-check {
    flex: none; width: 20px; height: 20px; margin-top: 0; border-radius: 6px; cursor: pointer;
    border: 1.5px solid var(--dsw-alias-border-l2, rgba(127,127,127,.4));
    background: transparent; color: var(--dsw-alias-bg-base, #fff);
    display: inline-flex; align-items: center; justify-content: center; padding: 0;
  }
  .nce-lesson-hw-task.is-done .nce-lesson-hw-check {
    background: var(--dsw-alias-state-success-primary, #2f9e44); border-color: transparent;
  }
  .nce-lesson-hw-task-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .nce-lesson-hw-task-text { font-size: 12.5px; line-height: 1.65; }
  .nce-lesson-hw-task.is-done .nce-lesson-hw-task-text { text-decoration: line-through; }
  .nce-lesson-hw-task-title { font-size: 10.5px; color: var(--dsw-alias-label-secondary, #8a8f98); }

  .nce-lesson-practice { display: flex; flex-direction: column; gap: 8px; }
  .nce-lesson-practice-block { padding: 0; overflow: hidden; }
  .nce-lesson-practice-summary { padding: 12px 16px; }
  .nce-lesson-practice-title { font-weight: 600; }
  .nce-lesson-practice-count { font-size: 10.5px; color: var(--dsw-alias-label-secondary, #8a8f98); }
  .nce-lesson-practice-lines { padding: 0 14px 12px; display: flex; flex-direction: column; gap: 3px; }
  .nce-lesson-practice-line {
    display: flex; align-items: center; gap: 4px;
    font-size: 12px; line-height: 1.65; color: var(--dsw-alias-label-secondary, #8a8f98);
  }
  .nce-lesson-practice-line > span:first-child { flex: 1; min-width: 0; }

  @media print {
    .nce-lesson-hw, .nce-lesson-practice { display: none !important; }
  }
`)
