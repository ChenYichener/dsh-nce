// Layer: 80 mistakes — depends on: 00–07 foundation, 06-store (`useNce`), 15-mistakes (store) and 07-ui.
// 错题本 page: every question the paper UI judged 判错 / 近似, grouped by lesson,
// with the student's answer, the reference answer, the AI comment and two
// actions (去重做 / 已掌握).

const MISTAKE_FILTERS = [
  { id: 'all', label: '全部' },
  { id: 'wrong', label: '错误' },
  { id: 'close', label: '近似' },
]

/** "今天 14:32" / "昨天" / "11 月 5 日" for a stored timestamp. */
function mistakeWhen(ts) {
  const at = Number(ts) || 0
  if (at <= 0) return ''
  const date = new Date(at)
  const today = new Date()
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  const hhmm = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  if (dayKey(date) === dayKey(today)) return `今天 ${hhmm}`
  if (dayKey(date) === dayKey(yesterday)) return `昨天 ${hhmm}`
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`
}

/** Group newest-first rows by lesson, keeping the row order. */
function MistakeGroups(rows) {
  const groups = []
  const byLesson = new Map()
  for (const row of rows) {
    let group = byLesson.get(row.lessonId)
    if (group === undefined) {
      group = { lessonId: row.lessonId, title: row.lessonTitle, entries: [] }
      byLesson.set(row.lessonId, group)
      groups.push(group)
    }
    if (group.title === '' && row.lessonTitle !== '') group.title = row.lessonTitle
    group.entries.push(row)
  }
  return groups
}

function MistakeEntry(props) {
  const entry = props.entry
  const onMastered = () => { mistakesRemove(entry.key) }
  return h('li', { className: cx('nce-mistakes-item', `is-${entry.verdict}`), 'data-mistake': entry.key },
    h('div', { className: 'nce-mistakes-item-head' },
      h('span', { className: 'nce-mistakes-num' }, entry.num !== '' ? entry.num : '—'),
      h('span', { className: cx('nce-mistakes-verdict', `is-${entry.verdict}`) },
        entry.verdict === 'close' ? '近似' : '错误'),
      entry.group !== '' ? h('span', { className: 'nce-mistakes-group' }, entry.group) : null,
      h('span', { className: 'nce-mistakes-when' }, mistakeWhen(entry.updatedAt)),
      h('div', { className: 'nce-mistakes-item-actions' },
        h(Btn, {
          kind: 'soft',
          size: 'sm',
          icon: 'spark',
          className: 'nce-mistakes-explain-btn',
          disabled: props.busy === true,
          title: '请 AI 英语老师讲一下这道题的正确答案和错因',
          onClick: props.onExplain,
        }, props.busy === true ? '讲解中…' : entry.explain !== '' ? '重新讲解' : 'AI 讲解'),
        h(Btn, { kind: 'quiet', size: 'sm', icon: 'pen', onClick: props.onOpen }, '去重做'),
        h(Btn, { kind: 'ghost', size: 'sm', icon: 'check', className: 'nce-mistakes-master', onClick: onMastered }, '已掌握'))),
    h('div', { className: 'nce-mistakes-prompt nce-en' }, entry.prompt),
    entry.answer !== '' || entry.reference.length > 0
      ? h('div', { className: 'nce-mistakes-answers' },
        entry.answer !== ''
          ? h('div', { className: 'nce-mistakes-block is-mine' },
            h('span', { className: 'nce-mistakes-block-label' }, '你的答案'),
            h('div', { className: 'nce-mistakes-block-text nce-en' }, entry.answer))
          : null,
        entry.reference.length > 0
          ? h('div', { className: 'nce-mistakes-block is-ref' },
            h('span', { className: 'nce-mistakes-block-label' }, '参考答案'),
            entry.reference.map((line, index) => h('div', { key: index, className: 'nce-mistakes-block-text nce-en' }, line)))
          : null)
      : null,
    entry.comment !== ''
      ? h('div', { className: 'nce-mistakes-comment' }, Icon('spark', 12), h('span', null, entry.comment))
      : null,
    props.busy === true && entry.explain === ''
      ? h('div', { className: 'nce-mistakes-explain is-loading' },
        h('span', { className: 'nce-mistakes-explain-label' }, Icon('spark', 12), 'AI 老师正在讲解这道题…'))
      : null,
    entry.explain !== ''
      ? h('div', { className: 'nce-mistakes-explain' },
        h('div', { className: 'nce-mistakes-explain-label' }, Icon('spark', 12), 'AI 老师讲解'),
        h('div', { className: 'nce-mistakes-explain-text' }, entry.explain))
      : null,
    props.error !== ''
      ? h('div', { className: 'nce-mistakes-explain-error' }, `AI 讲解失败：${props.error}`)
      : null)
}

const MISTAKE_HISTORY_FLAG = 'dsh-nce/mistakes/history-synced'

/** Lesson ids that already have a locally saved exercise-paper draft. */
function mistakeDraftLessonIds() {
  const ids = []
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index)
      if (typeof key !== 'string' || key.startsWith(PAPER_STORAGE_PREFIX) === false) continue
      const id = Number(key.slice(PAPER_STORAGE_PREFIX.length))
      if (Number.isInteger(id) && id > 0 && ids.includes(id) === false) ids.push(id)
    }
  } catch {
    // Storage unavailable: nothing to migrate.
  }
  return ids
}

function mistakeDraftHasEvidence(draft) {
  if (draft === null || typeof draft !== 'object') return false
  const ai = draft.ai !== null && typeof draft.ai === 'object' ? draft.ai : {}
  const marks = draft.marks !== null && typeof draft.marks === 'object' ? draft.marks : {}
  return draft.graded === true || Object.keys(ai).length > 0 || Object.keys(marks).length > 0
}

/**
 * One-time backfill: a paper only syncs while its lesson page is mounted, so
 * papers graded before the notebook existed would otherwise stay invisible
 * until the lesson is opened again. Scans the local drafts once per profile;
 * the page's「同步历史练习」button re-runs it with `force`.
 */
async function mistakesBackfillFromDrafts(force) {
  let synced = 0
  let flag = ''
  try {
    flag = window.localStorage.getItem(MISTAKE_HISTORY_FLAG) ?? ''
  } catch {
    flag = ''
  }
  if (force !== true && flag === '1') return 0
  for (const id of mistakeDraftLessonIds()) {
    try {
      const raw = window.localStorage.getItem(`${PAPER_STORAGE_PREFIX}${id}`)
      const draft = raw === null || raw === '' ? null : JSON.parse(raw)
      if (mistakeDraftHasEvidence(draft) === false) continue
      const result = await api('lesson', { id })
      const lesson = result.lesson
      const model = PaperBuildModel(lesson)
      mistakesSyncPaper(id, model.titleEn !== '' ? model.titleEn : String(lesson.titleEn ?? ''), model, draft)
      synced += 1
    } catch {
      // A missing/broken lesson must not break the notebook.
    }
  }
  try {
    window.localStorage.setItem(MISTAKE_HISTORY_FLAG, '1')
  } catch {
    // Best effort.
  }
  return synced
}

function MistakesPage() {
  const { openLesson, go } = useNce()
  const [version, setVersion] = useState(0)
  const [filter, setFilter] = useState('all')
  const [historyBusy, setHistoryBusy] = useState(false)
  const [historyNote, setHistoryNote] = useState('')
  const [explainBusy, setExplainBusy] = useState('')
  const [explainError, setExplainError] = useState(null)

  useEffect(() => {
    const load = () => setVersion((value) => value + 1)
    window.addEventListener(MISTAKES_EVENT, load)
    window.addEventListener('focus', load)
    return () => {
      window.removeEventListener(MISTAKES_EVENT, load)
      window.removeEventListener('focus', load)
    }
  }, [])

  // Collect mistakes from papers graded before the notebook existed (once).
  useEffect(() => {
    let alive = true
    mistakesBackfillFromDrafts(false).then((synced) => {
      if (alive === false || synced === 0) return
      setHistoryNote(`已从 ${synced} 份历史练习卷同步错题`)
      setVersion((value) => value + 1)
    }).catch(() => {})
    return () => { alive = false }
  }, [])

  /** Ask the AI teacher to explain one mistake; the answer is stored in the book. */
  const requestExplain = (entry) => {
    if (explainBusy !== '') return
    setExplainBusy(entry.key)
    setExplainError(null)
    api('paper/explain', {
      lessonTitle: entry.lessonTitle,
      group: entry.group,
      prompt: entry.prompt,
      answer: entry.answer,
      reference: entry.reference.join('\n'),
      verdict: entry.verdict,
      comment: entry.comment,
    })
      .then((result) => {
        const text = String(result?.text ?? '').trim()
        if (text === '') throw new Error('AI 没有返回讲解内容，请重试')
        mistakesSetExplain(entry.key, text)
        setVersion((value) => value + 1)
      })
      .catch((error) => setExplainError({ key: entry.key, message: errorMessage(error, 'AI 讲解失败，请稍后重试') }))
      .finally(() => setExplainBusy(''))
  }

  const rescanHistory = () => {
    if (historyBusy) return
    setHistoryBusy(true)
    mistakesBackfillFromDrafts(true)
      .then((synced) => {
        setHistoryNote(synced > 0 ? `已从 ${synced} 份历史练习卷同步错题` : '没有发现可同步的历史批改记录')
        setVersion((value) => value + 1)
      })
      .catch(() => setHistoryNote('同步失败，请稍后再试'))
      .finally(() => setHistoryBusy(false))
  }

  const entries = useMemo(() => mistakesList(), [version])
  const wrong = entries.filter((entry) => entry.verdict === 'wrong')
  const close = entries.filter((entry) => entry.verdict === 'close')
  const shown = filter === 'wrong' ? wrong : filter === 'close' ? close : entries
  const groups = MistakeGroups(shown)
  const lessons = new Set(entries.map((entry) => entry.lessonId)).size
  const filterCount = (id) => (id === 'wrong' ? wrong.length : id === 'close' ? close.length : entries.length)

  return h('div', { className: 'nce-wrap nce-mistakes-page' },
    h('div', { className: 'nce-page-head' },
      h('div', null,
        h('h1', { className: 'nce-page-title' }, '错题本'),
        h('p', { className: 'nce-page-sub' },
          '练习卷里判错 / 近似的题会自动收进来；重做时点「去重做」，掌握后点「已掌握」移出。')),
      h('div', { className: 'nce-page-head-actions' },
        h(Btn, {
          kind: 'quiet',
          icon: 'refresh',
          disabled: historyBusy,
          title: '扫描本机已保存的练习卷草稿，把以前批改过的错题也收进错题本',
          onClick: rescanHistory,
        }, historyBusy ? '同步中…' : '同步历史练习'),
        h(Btn, { kind: 'soft', icon: 'book', onClick: () => go('home') }, '去课程页'))),

    h('div', { className: 'nce-mistakes-meta' },
      entries.length > 0
        ? `共 ${entries.length} 题 · 覆盖 ${lessons} 课 · 错误 ${wrong.length} / 近似 ${close.length}`
        : '还没有错题：练习卷批改后，判错和近似的题会自动出现在这里。'),

    historyNote !== ''
      ? h('div', { className: 'nce-mistakes-history' }, Icon('check', 12), h('span', null, historyNote))
      : null,

    entries.length > 0
      ? h('div', { className: 'nce-mistakes-filters' }, MISTAKE_FILTERS.map((item) => h(Chip, {
        key: item.id,
        active: filter === item.id,
        count: filterCount(item.id),
        onClick: () => setFilter(item.id),
      }, item.label)))
      : null,

    shown.length === 0
      ? h(Empty, {
        icon: 'notebook',
        title: entries.length === 0 ? '错题本是空的' : '这个筛选下没有错题',
        text: entries.length === 0
          ? '去课程页打开一课，做完练习卷点「批改整卷」；AI 老师（或系统判分/手动判错）判错、近似的题会自己进来，并保留当时的答案与参考答案。'
          : '换个筛选看看，或者去练习卷继续做几题。',
        action: h(Btn, { kind: 'primary', icon: 'book', onClick: () => go('home') }, '去课程页'),
      })
      : h('div', { className: 'nce-mistakes' }, groups.map((group) => h('section', {
        key: group.lessonId,
        className: 'nce-mistakes-lesson nce-card',
      },
      h('div', { className: 'nce-mistakes-lesson-head' },
        h('div', { className: 'nce-mistakes-lesson-title' },
          h('span', { className: 'nce-mistakes-lesson-id' }, `L${group.lessonId}`),
          h('span', null, group.title !== '' ? group.title : `第 ${group.lessonId} 课`)),
        h('div', { className: 'nce-mistakes-lesson-side' },
          h('span', { className: 'nce-mistakes-lesson-count' }, `${group.entries.length} 题`),
          h(Btn, {
            kind: 'quiet',
            size: 'sm',
            icon: 'pen',
            onClick: () => openLesson(group.lessonId, 'exercise'),
          }, '去重做'))),
      h('ul', { className: 'nce-mistakes-list' }, group.entries.map((entry) => h(MistakeEntry, {
        key: entry.key,
        entry,
        busy: explainBusy === entry.key,
        error: explainError !== null && explainError.key === entry.key ? explainError.message : '',
        onExplain: () => requestExplain(entry),
        onOpen: () => openLesson(entry.lessonId, 'exercise'),
      }))))))
  )
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

addCss(`
  .nce-mistakes-meta { margin: 2px 0 12px; font-size: 12px; color: var(--dsw-alias-label-secondary, #8a8f98); }
  .nce-mistakes-filters { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 14px; }
  .nce-mistakes-history {
    display: inline-flex; align-items: center; gap: 5px; margin: -4px 0 12px;
    font-size: 11px; color: var(--dsw-alias-state-success-primary, #2f9e44);
  }
  .nce-mistakes { display: flex; flex-direction: column; gap: 16px; }

  .nce-mistakes-lesson { padding: 16px 20px 6px; border-radius: 14px; }
  .nce-mistakes-lesson-head {
    display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px 16px;
    padding-bottom: 12px; border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.16));
  }
  .nce-mistakes-lesson-title { display: flex; align-items: baseline; gap: 9px; min-width: 0; font-size: 14.5px; font-weight: 680; }
  .nce-mistakes-lesson-id {
    flex: none; height: 21px; padding: 0 8px; border-radius: 6px;
    display: inline-flex; align-items: center;
    font-size: 10.5px; font-weight: 700; letter-spacing: .04em;
    color: var(--dsw-alias-brand-primary, #4c8dff);
    background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4c8dff) 10%, transparent);
  }
  .nce-mistakes-lesson-side { display: flex; align-items: center; gap: 8px; }
  .nce-mistakes-lesson-count { font-size: 11px; color: var(--dsw-alias-label-secondary, #8a8f98); font-variant-numeric: tabular-nums; }

  .nce-mistakes-list { list-style: none; margin: 0; padding: 0; }
  .nce-mistakes-item { padding: 14px 0; border-bottom: 1px dashed var(--dsw-alias-border-l1, rgba(127,127,127,.18)); }
  .nce-mistakes-item:last-child { border-bottom: 0; }
  .nce-mistakes-item-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 9px; }
  .nce-mistakes-num {
    flex: none; min-width: 30px; height: 22px; padding: 0 7px; border-radius: 7px;
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 11px; font-weight: 650; font-variant-numeric: tabular-nums;
    color: var(--dsw-alias-label-secondary, #8a8f98);
    background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.12));
  }
  .nce-mistakes-verdict {
    flex: none; height: 20px; padding: 0 8px; border-radius: 999px;
    display: inline-flex; align-items: center; font-size: 10px; font-weight: 680;
  }
  .nce-mistakes-verdict.is-wrong {
    color: var(--dsw-alias-state-error-primary, #d6393f);
    background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #d6393f) 11%, transparent);
  }
  .nce-mistakes-verdict.is-close {
    color: var(--dsw-alias-state-warn-primary, #d97706);
    background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #d97706) 12%, transparent);
  }
  .nce-mistakes-group { font-size: 10.5px; color: var(--dsw-alias-label-secondary, #8a8f98); }
  .nce-mistakes-when { margin-left: auto; font-size: 10.5px; color: var(--dsw-alias-label-secondary, #8a8f98); font-variant-numeric: tabular-nums; }
  .nce-mistakes-item-actions { display: flex; align-items: center; gap: 4px; }
  .nce-mistakes-prompt {
    margin-top: 8px; font-size: 14px; line-height: 1.75;
    color: var(--dsw-alias-label-primary, #1f2328); white-space: pre-wrap; word-break: break-word;
  }
  .nce-mistakes-answers { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 10px; }
  .nce-mistakes-block { padding: 9px 12px; border-radius: 9px; background: var(--dsw-alias-bg-layer-1, rgba(127,127,127,.04)); }
  .nce-mistakes-block.is-mine {
    border-left: 3px solid color-mix(in srgb, var(--dsw-alias-state-error-primary, #d6393f) 55%, transparent);
    background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #d6393f) 5%, transparent);
  }
  .nce-mistakes-block.is-ref {
    border-left: 3px solid color-mix(in srgb, var(--dsw-alias-state-success-primary, #2f9e44) 55%, transparent);
    background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #2f9e44) 5%, transparent);
  }
  .nce-mistakes-block-label {
    display: block; margin-bottom: 3px;
    font-size: 9.5px; font-weight: 650; letter-spacing: .1em;
    color: var(--dsw-alias-label-secondary, #8a8f98);
  }
  .nce-mistakes-block-text { font-size: 13px; line-height: 1.7; white-space: pre-wrap; word-break: break-word; }
  .nce-mistakes-comment {
    display: flex; align-items: flex-start; gap: 5px; margin-top: 9px;
    font-size: 12px; line-height: 1.65; color: var(--dsw-alias-label-secondary, #8a8f98);
  }
  .nce-mistakes-comment .nce-icon { margin-top: 3px; flex: none; color: var(--dsw-alias-brand-primary, #4c8dff); }
  .nce-mistakes-explain {
    margin-top: 10px; padding: 11px 14px; border-radius: 10px;
    border-left: 3px solid color-mix(in srgb, var(--dsw-alias-brand-primary, #4c8dff) 55%, transparent);
    background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4c8dff) 5%, transparent);
  }
  .nce-mistakes-explain.is-loading { border-left-color: transparent; background: var(--dsw-alias-bg-layer-1, rgba(127,127,127,.04)); }
  .nce-mistakes-explain-label {
    display: inline-flex; align-items: center; gap: 5px;
    font-size: 10px; font-weight: 680; letter-spacing: .06em;
    color: var(--dsw-alias-brand-primary, #4c8dff);
  }
  .nce-mistakes-explain.is-loading .nce-mistakes-explain-label { color: var(--dsw-alias-label-secondary, #8a8f98); font-weight: 600; letter-spacing: 0; }
  .nce-mistakes-explain-text {
    margin-top: 6px; font-size: 13px; line-height: 1.8; white-space: pre-wrap; word-break: break-word;
    color: var(--dsw-alias-label-primary, #1f2328);
  }
  .nce-mistakes-explain-error { margin-top: 8px; font-size: 11.5px; line-height: 1.6; color: var(--dsw-alias-state-error-primary, #d6393f); }

  @container (max-width: 640px) {
    .nce-mistakes-lesson { padding: 14px 14px 4px; }
    .nce-mistakes-answers { grid-template-columns: minmax(0, 1fr); }
    .nce-mistakes-when { order: 9; width: 100%; margin-left: 0; }
  }
`)
