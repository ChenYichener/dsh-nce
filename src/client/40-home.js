// Layer: 40 course home — depends on: 00–07 foundation, 01-domain (`LESSON_STEPS`) + 33 (`LessonPage`).

// ---------------------------------------------------------------------------
// 课程 tab, two regions: the persistent lesson list on the left and the selected
// lesson on the right. Selecting a lesson keeps the list in place, so switching
// never loses context.
// ---------------------------------------------------------------------------

const GROUP_LABELS = { a: '第 1–30 课', b: '第 31–67 课', c: '第 68–111 课', d: '第 112–144 课' }
const GROUP_ORDER = ['a', 'b', 'c', 'd']

function lessonSearchText(lesson) {
  return `${lesson.id} ${lesson.titleEn ?? ''} ${lesson.titleZh ?? ''}`.toLowerCase()
}

function ContinueTarget(progress, index) {
  const lessons = index?.lessons ?? []
  if (lessons.length === 0) return null
  let lastId = 0
  let lastVisit = 0
  if (progress?.lessons !== undefined) {
    for (const [id, entry] of Object.entries(progress.lessons)) {
      if (Number(entry?.lastVisit) > lastVisit) {
        lastVisit = Number(entry.lastVisit)
        lastId = Number(id)
      }
    }
  }
  if (lastId > 0) {
    const last = lessons.find((lesson) => lesson.id === lastId)
    if (last !== undefined && lessonStateOf(progress, lastId).status !== 'done') return last
    // The last lesson is finished: continue with the next unfinished one.
    const after = lessons.find((lesson) => lesson.id > lastId && lessonStateOf(progress, lesson.id).status !== 'done')
    if (after !== undefined) return after
    const any = lessons.find((lesson) => lessonStateOf(progress, lesson.id).status !== 'done')
    return any ?? last ?? lessons[0]
  }
  for (const lesson of lessons) {
    if (lessonStateOf(progress, lesson.id).status !== 'done') return lesson
  }
  return lessons[0]
}

/** One row of the lesson list; compact enough for the 296px column. */
function CourseRow(props) {
  const lesson = props.lesson
  const state = props.state
  const done = state.status === 'done'
  const label = state.state === 'done' ? '已学习' : state.state === 'learning' ? '学习中' : '未学习'
  return h('div', {
    className: cx('nce-course-row', props.active && 'is-active', done && 'is-done'),
    role: 'button',
    tabIndex: 0,
    title: lessonTitle(lesson),
    onClick: props.onOpen,
    onKeyDown: (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        props.onOpen()
      }
    },
  },
  h('span', { className: 'nce-course-id' }, String(lesson.id).padStart(3, '0')),
  h('span', { className: 'nce-course-main' },
    h('span', { className: 'nce-course-title' }, String(lesson.titleEn ?? '').trim() || `第 ${lesson.id} 课`),
    String(lesson.titleZh ?? '').trim() !== ''
      ? h('span', { className: 'nce-course-zh' }, String(lesson.titleZh).trim())
      : null,
    h('span', { className: 'nce-course-stages', title: '单词 → 语法 → 练习' },
      LESSON_STEPS.map((step) => {
        const finished = state.steps !== null && state.steps !== undefined && state.steps[step.id] === true
        return h('i', {
          key: step.id,
          className: cx('nce-course-stage-dot', finished && 'is-done'),
          title: `${step.label}${finished ? ' ✓' : ''}`,
        })
      }))),
  h('select', {
    className: cx('nce-course-status', `is-${state.state}`),
    value: state.state,
    title: `学习状态：${label} · 在这里直接切换（选「已学习」会把三步一起勾上）`,
    'aria-label': `切换学习状态，当前${label}`,
    onClick: (event) => event.stopPropagation(),
    onKeyDown: (event) => event.stopPropagation(),
    onChange: (event) => {
      event.stopPropagation()
      props.onStatus(event.target.value)
    },
  },
  h('option', { value: 'unseen' }, '未学习'),
  h('option', { value: 'learning' }, '学习中'),
  h('option', { value: 'done' }, '已学习')))
}

/** Right pane shown for the first moments before a lesson is auto-selected. */
function CourseWelcome() {
  const { progress, go } = useNce()
  const done = doneLessonCount(progress)
  return h('div', { className: 'nce-split-welcome' },
    h('div', { className: 'nce-split-welcome-eyebrow' }, 'NEW CONCEPT ENGLISH · BOOK 1'),
    h('h1', { className: 'nce-split-welcome-title' }, '新概念英语 第一册'),
    h('p', { className: 'nce-split-welcome-text' }, `共 144 课，已学 ${done} 课。在左侧选一课开始，学完顺手把记忆卡复习一下。`),
    h('div', { className: 'nce-split-welcome-actions' },
      h(Btn, { kind: 'primary', icon: 'refresh', onClick: () => go('review') }, '今日复习')))
}

function HomePage() {
  const { nav, progress, openLesson, updateLesson } = useNce()
  const indexState = useIndex()
  const index = indexState.data?.index ?? null
  const [query, setQuery] = useState('')
  const [showDetail, setShowDetail] = useState(false)
  const mainRef = useRef(null)
  const listRef = useRef(null)

  const lessons = index?.lessons ?? []
  const groups = useMemo(() => {
    const source = Array.isArray(index?.groups) && index.groups.length > 0
      ? index.groups
      : GROUP_ORDER.map((id, position) => ({ id, from: [1, 31, 68, 112][position], to: [30, 67, 111, 144][position] }))
    return source.map((item) => ({
      id: item.id,
      label: item.title ?? GROUP_LABELS[item.id] ?? item.id,
    }))
  }, [index])

  const selectedId = Math.max(0, Number(nav.lessonId) || 0)
  const done = doneLessonCount(progress)
  const total = lessons.length || 144

  /** Lesson status is edited in the course list: 未学习 / 学习中 / 已学习. */
  const setLessonStatus = (lessonId, next) => {
    let patch
    if (next === 'unseen') {
      patch = { status: 'unseen' }
    } else if (next === 'done') {
      const steps = {}
      for (const step of LESSON_STEPS) steps[step.id] = true
      patch = { status: 'done', steps }
    } else {
      patch = { status: 'learning' }
    }
    updateLesson(lessonId, patch).catch(() => {})
  }

  // First open: land on the lesson the learner should continue with.
  useEffect(() => {
    if (selectedId > 0 || index === null) return
    const target = ContinueTarget(progress, index)
    if (target !== null) openLesson(target.id)
  }, [selectedId, index, progress, openLesson])

  // Restore where the learner was: the detail pane per lesson and the course
  // list across panel unmounts (switching DSH sessions must not reset it).
  useScrollMemory(mainRef, `lesson:${selectedId}`, selectedId > 0)
  useScrollMemory(listRef, 'course-list')

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (keyword === '') return lessons
    return lessons.filter((lesson) => lessonSearchText(lesson).includes(keyword))
  }, [lessons, query])

  if (indexState.loading && index === null) {
    return h('div', { className: 'nce-course' }, h(Loading, { text: '正在读取课程数据…' }))
  }
  if (indexState.error !== null && index === null) {
    return h('div', { className: 'nce-course' }, h(ErrorBox, { error: indexState.error, onRetry: indexState.reload }))
  }

  return h('div', { className: 'nce-course' },
    h('div', { className: cx('nce-split', showDetail && 'is-detail') },
      h('aside', { className: 'nce-split-list' },
        h('div', { className: 'nce-split-head' },
          h('div', { className: 'nce-split-progress' },
            h('div', { className: 'nce-split-progress-line' },
              h('span', null, '已学'),
              h('span', { className: 'nce-split-progress-num' }, `${done} / ${total}`)),
            h(Bar, { value: done, total })),
          h('label', { className: 'nce-search nce-search-block' },
            Icon('search', 14),
            h('input', {
              className: 'nce-search-input',
              value: query,
              placeholder: '搜课程号 / 标题',
              onChange: (event) => setQuery(event.target.value),
            }))),
        h('div', { className: 'nce-split-scroll', ref: listRef },
          filtered.length === 0
            ? h(Empty, { title: '没有匹配的课程', text: '换个关键词试试。', icon: 'search' })
            : groups.map((meta) => {
              const rows = filtered.filter((lesson) => lesson.group === meta.id)
              if (rows.length === 0) return null
              return h('div', { key: meta.id, className: 'nce-split-group' },
                h('div', { className: 'nce-split-group-head' },
                  h('span', null, meta.label),
                  h('span', { className: 'nce-split-group-count' }, `${rows.length} 课`)),
                rows.map((lesson) => h(CourseRow, {
                  key: lesson.id,
                  lesson,
                  state: lessonStateOf(progress, lesson.id),
                  active: lesson.id === selectedId,
                  onOpen: () => {
                    openLesson(lesson.id)
                    setShowDetail(true)
                  },
                  onStatus: (next) => setLessonStatus(lesson.id, next),
                })))
            }))),
      h('main', { className: 'nce-split-main', ref: mainRef },
        h('div', { className: 'nce-split-backbar' },
          h(Btn, { kind: 'quiet', size: 'sm', icon: 'arrowLeft', onClick: () => setShowDetail(false) }, '课程列表'),
          h('span', { className: 'nce-split-backbar-title' },
            lessonTitle(lessons.find((lesson) => lesson.id === selectedId) ?? null))),
        selectedId > 0 ? h(LessonPage, { embedded: true }) : h(CourseWelcome))))
}

addCss(`
  .nce-course { display: flex; flex-direction: column; height: 100%; min-height: 0; }

  .nce-split {
    flex: 1; min-height: 0;
    display: grid; grid-template-columns: 296px minmax(0, 1fr);
  }
  .nce-split-list {
    display: flex; flex-direction: column; min-height: 0;
    border-right: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.18));
    background: var(--dsw-alias-bg-layer-1, rgba(127,127,127,.03));
  }
  .nce-split-head {
    flex: none; display: flex; flex-direction: column; gap: 9px;
    padding: 12px 14px 10px;
    border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.16));
  }
  .nce-split-progress { display: flex; flex-direction: column; gap: 6px; }
  .nce-split-progress-line {
    display: flex; align-items: baseline; justify-content: space-between;
    font-size: 11.5px; color: var(--dsw-alias-label-secondary, #8a8f98);
  }
  .nce-split-progress-num { font-weight: 600; color: var(--dsw-alias-label-primary, #1f2328); font-variant-numeric: tabular-nums; }
  .nce-search {
    display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 9px;
    border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.26)); border-radius: 8px;
    color: var(--dsw-alias-label-secondary, #8a8f98); background: var(--dsw-alias-bg-base, #fff);
  }
  .nce-search-input {
    border: 0; outline: 0; background: transparent; color: var(--dsw-alias-label-primary, #1f2328);
    font: inherit; font-size: 12px;
  }
  .nce-search-input::placeholder { color: var(--dsw-alias-label-secondary, #8a8f98); opacity: .75; }
  .nce-search-block { width: 100%; }
  .nce-search-block .nce-search-input { width: 100%; }
  .nce-split-scroll { flex: 1; min-height: 0; overflow: auto; padding: 8px 8px 24px; }
  .nce-split-group { margin-bottom: 8px; }
  .nce-split-group-head {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    padding: 8px 8px 4px; font-size: 10.5px; font-weight: 600;
    letter-spacing: .04em; color: var(--dsw-alias-label-secondary, #8a8f98);
  }
  .nce-split-group-count { font-weight: 500; opacity: .75; }
  .nce-course-row {
    display: flex; align-items: center; gap: 8px; width: 100%;
    padding: 6px 8px; border: 0; border-radius: 7px;
    background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer;
  }
  .nce-course-row:hover { background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.08)); }
  .nce-course-row.is-active {
    background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4c8dff) 10%, transparent);
    box-shadow: inset 2px 0 0 var(--dsw-alias-brand-primary, #4c8dff);
  }
  .nce-course-id {
    flex: none; width: 28px; font-size: 10.5px; font-weight: 600;
    color: var(--dsw-alias-label-secondary, #8a8f98); font-variant-numeric: tabular-nums;
  }
  .nce-course-row.is-done .nce-course-id { color: var(--dsw-alias-state-success-primary, #2e9e5b); }
  .nce-course-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .nce-course-title {
    font-size: 12px; font-weight: 500; line-height: 1.35;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .nce-course-zh {
    font-size: 10.5px; line-height: 1.35; color: var(--dsw-alias-label-secondary, #8a8f98);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .nce-course-stages { display: flex; align-items: center; gap: 3px; margin-top: 4px; }
  .nce-course-stage-dot {
    width: 12px; height: 4px; border-radius: 2px;
    background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.18));
  }
  .nce-course-stage-dot.is-done { background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4c8dff) 65%, transparent); }
  /* Status dropdown: the only place a lesson's 未学习 / 学习中 / 已学习 is edited. */
  .nce-course-status {
    flex: none; height: 22px; max-width: 82px; padding: 0 2px 0 7px;
    border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.28));
    border-radius: 7px;
    background: transparent; color: var(--dsw-alias-label-secondary, #8a8f98);
    font: inherit; font-size: 10.5px; cursor: pointer;
    transition: border-color .14s ease, color .14s ease, background .14s ease;
  }
  .nce-course-status:hover { border-color: var(--dsw-alias-border-l2, rgba(127,127,127,.5)); }
  .nce-course-status:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #4c8dff); outline-offset: 1px; }
  .nce-course-status.is-learning {
    color: var(--dsw-alias-brand-primary, #4c8dff);
    border-color: color-mix(in srgb, var(--dsw-alias-brand-primary, #4c8dff) 42%, transparent);
    background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4c8dff) 8%, transparent);
  }
  .nce-course-status.is-done {
    color: var(--dsw-alias-state-success-primary, #2e9e5b);
    border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary, #2e9e5b) 42%, transparent);
    background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #2e9e5b) 8%, transparent);
  }
  .nce-split-main { min-width: 0; min-height: 0; overflow: auto; }
  .nce-split-backbar { display: none; }
  .nce-split-backbar-title {
    min-width: 0; font-size: 12px; color: var(--dsw-alias-label-secondary, #8a8f98);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .nce-split-welcome { padding: 64px 32px; max-width: 560px; }
  .nce-split-welcome-eyebrow { font-size: 10.5px; letter-spacing: .16em; color: var(--dsw-alias-brand-primary, #4c8dff); font-weight: 600; }
  .nce-split-welcome-title { margin: 6px 0 0; font-size: 24px; font-weight: 680; }
  .nce-split-welcome-text { margin: 8px 0 0; font-size: 12.5px; line-height: 1.75; color: var(--dsw-alias-label-secondary, #8a8f98); }
  .nce-split-welcome-actions { margin-top: 16px; }

  @container (max-width: 820px) {
    .nce-split { grid-template-columns: minmax(0, 1fr); }
    .nce-split-main { display: none; }
    .nce-split.is-detail .nce-split-list { display: none; }
    .nce-split.is-detail .nce-split-main { display: block; }
    .nce-split.is-detail .nce-split-backbar {
      display: flex; align-items: center; gap: 8px;
      padding: 7px 10px; position: sticky; top: 0; z-index: 5;
      border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.16));
      background: var(--dsw-alias-bg-base, #fff);
    }
  }
`)
