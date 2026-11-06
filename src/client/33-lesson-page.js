// Layer: 33 lesson-page — depends on: 00-platform, 01-domain, 05-data (`useIndex`/`useLesson`),
// 06-store (`useNce`), 07-ui and the 30/31/32 fragments (paper, homework/practice blocks, sections).
// The lesson detail page shell: one continuous page (header → anchor bar → 视频 → 课文 + 单词
// → 语法 → 练习 → 结束), replacing the old stage bar + tabs.

// ---------------------------------------------------------------------------
// Page chrome: anchor bar, section wrapper and the per-step tick
// ---------------------------------------------------------------------------

/** The five jump targets of the single-page lesson, top to bottom. */
const LESSON_ANCHORS = [
  { id: 'video', label: '视频', icon: 'video' },
  { id: 'text', label: '课文', icon: 'book' },
  { id: 'words', label: '单词', icon: 'cards' },
  { id: 'grammar', label: '语法', icon: 'pen' },
  { id: 'exercise', label: '练习', icon: 'list' },
]

function LessonAnchorBar(props) {
  return h('nav', { className: 'nce-lesson-anchors', 'aria-label': '本课内容跳转' },
    h('span', { className: 'nce-lesson-anchors-label' }, '跳到'),
    LESSON_ANCHORS.map((item) => h('button', {
      key: item.id,
      type: 'button',
      className: 'nce-lesson-anchor',
      title: `滚动到「${item.label}」`,
      onClick: () => props.onJump(item.id),
    },
    Icon(item.icon, 13),
    h('span', null, item.label))))
}

/** One anchored block of the page; the anchor bar scrolls to its `data-lesson-anchor`. */
function LessonSection(props) {
  return h('div', {
    className: cx('nce-lesson-section', props.className),
    'data-lesson-anchor': props.id,
  }, h(Section, {
    title: props.title,
    hint: props.hint,
    extra: props.extra,
  }, props.children))
}

/** Compact 已完成 / 标记完成 toggle shown next to a section title. */
function LessonStepToggle(props) {
  const done = props.done === true
  const label = String(props.step?.label ?? '')
  return h(Btn, {
    kind: done ? 'soft' : 'quiet',
    size: 'sm',
    icon: done ? 'check' : 'plus',
    className: 'nce-lesson-step-toggle',
    title: done ? `取消「${label}」完成标记` : `标记「${label}」完成`,
    disabled: props.pending === true,
    onClick: props.onClick,
  }, done ? '已完成' : '标记完成')
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function LessonPage(props) {
  const embedded = props !== null && typeof props === 'object' && props.embedded === true
  const { nav, openLesson, progress, updateLesson, go, clearLessonTab } = useNce()
  const lessonId = Number(nav.lessonId) || 0
  const lessonState = useLesson(lessonId)
  const indexState = useIndex()
  const [pending, setPending] = useState(false)
  const [actionError, setActionError] = useState(null)
  // The video is the biggest block of the page and is often watched later, so it
  // starts collapsed; 展开视频 / 锚点条「视频」 expand it. The choice is remembered
  // per lesson (panel unmounts must not collapse it again).
  const [videoOpen, setVideoOpen] = useState(() => readUiFlag(`video-open:${lessonId}`))
  const rootRef = useRef(null)
  const anchor = LessonAnchorOf(nav.tab)

  const rawLesson = lessonState.data
  const lesson = rawLesson !== null && rawLesson !== undefined && Number(rawLesson.id) === lessonId ? rawLesson : null
  const state = lessonStateOf(progress, lessonId)
  const lessonTotalRaw = Number(indexState.data?.index?.book?.lessonCount)
  const lessonTotal = Number.isFinite(lessonTotalRaw) && lessonTotalRaw > 0 ? lessonTotalRaw : LESSON_COUNT_FALLBACK

  const runAction = (task) => {
    setPending(true)
    setActionError(null)
    Promise.resolve()
      .then(task)
      .catch((failure) => setActionError(failure))
      .finally(() => setPending(false))
  }

  const toggleStep = (stepId) => runAction(() => updateLesson(lessonId, {
    steps: { [stepId]: state.steps[stepId] !== true },
  }))

  useEffect(() => {
    setVideoOpen(readUiFlag(`video-open:${lessonId}`))
  }, [lessonId])

  const toggleVideo = (next) => {
    const value = typeof next === 'boolean' ? next : !videoOpen
    writeUiFlag(`video-open:${lessonId}`, value)
    setVideoOpen(value)
  }

  const jumpToAnchor = (anchorId) => {
    if (anchorId === 'video') toggleVideo(true)
    const node = rootRef.current
    if (node === null || node === undefined) return
    const target = node.querySelector(`[data-lesson-anchor="${anchorId}"]`)
    if (target !== null && target !== undefined && typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  // A deep link may carry an anchor (`nav.tab`): jump there once the lesson
  // rendered, then consume it so later panel remounts restore the saved scroll
  // position instead of jumping again.
  useEffect(() => {
    if (anchor === '') return undefined
    const timer = setTimeout(() => {
      if (readScrollOffset(`lesson:${lessonId}`) <= 0) jumpToAnchor(anchor)
      clearLessonTab()
    }, 0)
    return () => clearTimeout(timer)
  }, [lesson, anchor])

  const wrapClass = embedded ? 'nce-wrap nce-lesson-page nce-lesson-embedded' : 'nce-wrap nce-lesson-page'
  const wrap = (children) => h('div', { className: wrapClass, ref: rootRef }, children)

  if (lessonId <= 0) {
    return wrap(h(Empty, {
      icon: 'book',
      title: '还没有选择课程',
      text: '在左侧课程列表里选一课：视频、课文、单词、语法和练习都在同一页，上下滚动就能看完整课。',
    }))
  }

  if (lesson === null && lessonState.error !== null) {
    const message = errorMessage(lessonState.error, '')
    const notFound = message.includes('不存在') || message.includes('不合法') || lessonId > lessonTotal
    return wrap(notFound
      ? h(Empty, {
        icon: 'search',
        title: `没有第 ${lessonId} 课`,
        text: '课程编号超出本书范围，或者这一课的数据还没有生成。',
      })
      : h(ErrorBox, { error: lessonState.error, title: '课程加载失败', onRetry: lessonState.reload }))
  }

  if (lesson === null) {
    return wrap(h(Loading, { text: `正在打开第 ${lessonId} 课…` }))
  }

  const vocabCount = LessonArray(lesson.vocab).length
  const dialogueCount = LessonArray(lesson.dialogue).length
  const textNoteCount = LessonArray(lesson.textNotes).length
  const notePageCount = LessonArray(lesson.notes).filter((note) => LessonArray(note?.blocks).length > 0).length
  const grammarHint = [
    textNoteCount > 0 ? `课文注释 ${textNoteCount} 条` : '',
    notePageCount > 0 ? `课堂笔记 ${notePageCount} 页` : '',
  ].filter((part) => part !== '').join(' · ') || '课文注释 + 课堂笔记'
  const pageLabel = LessonPageLabel(lesson)
  const titleEn = String(lesson.titleEn ?? '').trim()
  const titleZh = String(lesson.titleZh ?? '').trim()
  const done = state.status === 'done'
  const stepOf = (stepId) => LESSON_STEPS.find((item) => item.id === stepId) ?? { id: stepId, label: stepId }
  const stepToggle = (stepId) => h(LessonStepToggle, {
    step: stepOf(stepId),
    done: state.steps[stepId] === true,
    pending,
    onClick: () => toggleStep(stepId),
  })

  return wrap(h('div', null,
    h('header', { className: 'nce-lesson-head nce-card' },
      h('div', { className: 'nce-lesson-head-top' },
        h('div', { className: 'nce-lesson-head-turn' },
          h(Btn, {
            kind: 'ghost',
            size: 'sm',
            icon: 'chevronLeft',
            title: '上一课',
            disabled: lessonId <= 1,
            onClick: () => openLesson(lessonId - 1),
          }),
          h('span', { className: 'nce-lesson-head-turn-label' }, `${lessonId} / ${lessonTotal}`),
          h(Btn, {
            kind: 'ghost',
            size: 'sm',
            icon: 'chevronRight',
            title: '下一课',
            disabled: lessonId >= lessonTotal,
            onClick: () => openLesson(lessonId + 1),
          }))),
      h('div', { className: 'nce-lesson-head-columns' },
        h('div', { className: 'nce-lesson-head-main' },
          h('div', { className: 'nce-lesson-head-eyebrow' }, `第 ${lessonId} 课`),
          h('h1', { className: 'nce-lesson-head-en nce-en' }, titleEn !== '' ? titleEn : `第 ${lessonId} 课`),
          titleZh !== '' ? h('div', { className: 'nce-lesson-head-zh' }, titleZh) : null,
          h('div', { className: 'nce-lesson-head-meta' },
            h('span', null, `${vocabCount} 个生词`),
            h('span', null, `${dialogueCount} 句对话`),
            pageLabel !== '' ? h('span', null, pageLabel) : null)),
        h('div', { className: 'nce-lesson-head-side' },
          h('div', {
            className: 'nce-lesson-head-status',
            title: '学习状态在左侧课程列表的下拉框里切换',
          },
          done
            ? h(Badge, { tone: 'success' }, '已学完')
            : h(Badge, { tone: 'brand' }, `已完成 ${state.doneSteps}/${LESSON_STEPS.length}`))))),
    h(LessonAnchorBar, { onJump: jumpToAnchor }),
    actionError !== null ? h(ErrorBox, { error: actionError, title: '操作没有保存成功' }) : null,
    h(LessonSection, {
      id: 'video',
      title: '视频',
      hint: videoOpen ? 'B 站合集 · 可在本页直接播放' : '默认收起 · 需要看时再展开播放',
      extra: h(Btn, {
        kind: 'quiet',
        size: 'sm',
        icon: videoOpen ? 'chevronDown' : 'play',
        className: 'nce-lesson-video-toggle',
        title: videoOpen ? '收起视频' : '展开视频',
        onClick: () => toggleVideo(),
      }, videoOpen ? '收起视频' : '展开视频'),
    }, videoOpen ? h(LessonVideoSection, { id: lessonId, lesson }) : null),
    h('div', { className: 'nce-lesson-cols' },
      h(LessonSection, {
        id: 'text',
        title: '课文',
        hint: dialogueCount > 0 ? `${dialogueCount} 句 · 点整句或喇叭朗读` : '本课课文',
      }, h(LessonTextSection, { lesson })),
      h(LessonSection, {
        id: 'words',
        title: '单词',
        hint: vocabCount > 0 ? `${vocabCount} 词 · 喇叭朗读 · ★ 加入记忆卡` : '本课生词',
        extra: [
          h(Fragment, { key: 'step' }, stepToggle('words')),
          h(Btn, { key: 'go', kind: 'ghost', size: 'sm', icon: 'cards', onClick: () => go('review') }, '去记忆卡'),
        ],
      }, h(LessonWordsSection, { lesson }))),
    h(LessonSection, {
      id: 'grammar',
      title: '语法',
      hint: grammarHint,
      extra: stepToggle('grammar'),
    }, h(LessonGrammarSection, { lesson })),
    h(LessonSection, {
      id: 'exercise',
      title: '练习',
      hint: '先写练习卷，写完点「批改整卷」让 AI 老师批改',
      extra: stepToggle('exercise'),
    }, h('div', { className: 'nce-lesson-exercise' },
      h(LessonHomeworkChecklist, { id: lessonId, lesson }),
      h(LessonPracticeBlocks, { lesson }),
      h(LessonExerciseTab, { key: `paper-${lessonId}`, lesson })))))
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

addCss(`
  /* Embedded in the two-column 课程 layout: the outer pane owns the box. */
  .nce-lesson-embedded { max-width: none; padding: 18px 22px 48px; }
  /* The panel is often narrower than the window (course list on the left), so
     the two-column 课文/单词 layout reacts to its own width, not the viewport. */
  .nce-lesson-page { container-type: inline-size; }
  /* 课文 / 单词 / 标题都改用高可读性的 UI sans，小字号下比衬线更清楚。
     练习卷仍保留卷面衬线（PDF 导出与页面一致）。 */
  .nce-lesson-head .nce-en,
  .nce-lesson-section:not([data-lesson-anchor="exercise"]) .nce-en {
    font-family: var(--nce-font-reading);
    letter-spacing: .004em;
  }

  .nce-lesson-head {
    padding: 20px 22px 18px;
    border-radius: 14px;
    background:
      radial-gradient(120% 160% at 100% 0%, color-mix(in srgb, var(--dsw-alias-brand-primary, #4c8dff) 8%, transparent) 0%, transparent 58%),
      var(--dsw-alias-bg-layer-1, rgba(127,127,127,.04));
  }
  .nce-lesson-head-top { display: flex; align-items: center; gap: 8px; }
  .nce-lesson-head-turn { margin-left: auto; display: flex; align-items: center; gap: 4px; }
  .nce-lesson-head-turn-label {
    padding: 0 2px; font-size: 11.5px; color: var(--dsw-alias-label-secondary, #8a8f98);
    font-variant-numeric: tabular-nums;
  }
  .nce-lesson-head-columns { display: flex; align-items: flex-start; gap: 18px; margin-top: 6px; }
  .nce-lesson-head-main { flex: 1; min-width: 0; }
  .nce-lesson-head-eyebrow {
    font-size: 10.5px; font-weight: 650; letter-spacing: .16em;
    color: var(--dsw-alias-brand-primary, #4c8dff);
  }
  .nce-lesson-head-en { margin: 6px 0 0; font-size: 28px; font-weight: 680; line-height: 1.18; letter-spacing: -.012em; }
  .nce-lesson-head-zh { margin-top: 6px; font-size: 14px; color: var(--dsw-alias-label-secondary, #8a8f98); }
  .nce-lesson-head-meta {
    display: flex; flex-wrap: wrap; gap: 6px 16px; margin-top: 11px;
    font-size: 12px; color: var(--dsw-alias-label-secondary, #8a8f98);
  }
  .nce-lesson-head-side { flex: none; display: flex; flex-direction: column; align-items: flex-end; gap: 10px; padding-top: 2px; }
  .nce-lesson-head-status { display: flex; align-items: center; gap: 6px; }

  /* Sticky anchor bar: jump to video / text / words / grammar / exercise. */
  .nce-lesson-anchors {
    position: sticky; top: 0; z-index: 7;
    display: flex; align-items: center; flex-wrap: wrap; gap: 2px;
    margin: 14px 0 2px; padding: 6px 8px;
    border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.2));
    border-radius: 12px;
    background: color-mix(in srgb, var(--dsw-alias-bg-base, #fff) 93%, transparent);
    backdrop-filter: blur(8px);
    box-shadow: 0 4px 14px rgba(0, 0, 0, .04);
  }
  .nce-lesson-anchors-label {
    padding: 0 7px; font-size: 10px; letter-spacing: .06em;
    color: var(--dsw-alias-label-secondary, #8a8f98);
  }
  .nce-lesson-anchor {
    display: inline-flex; align-items: center; gap: 6px;
    height: 28px; padding: 0 11px; border-radius: 999px;
    border: 1px solid transparent; background: transparent;
    color: var(--dsw-alias-label-secondary, #8a8f98);
    font: inherit; font-size: 12.5px; cursor: pointer;
    transition: color .14s ease, background .14s ease;
  }
  .nce-lesson-anchor:hover {
    color: var(--dsw-alias-label-primary, #1f2328);
    background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.1));
  }

  /* One continuous page: each block can be jumped to, with room for the sticky bar.
     Section is always its wrapper's first child (margin-top:0), so the wrapper
     owns the vertical rhythm between blocks. */
  .nce-lesson-section { margin-top: 26px; scroll-margin-top: 58px; }
  .nce-lesson-anchors + .nce-lesson-section { margin-top: 18px; }
  .nce-lesson-cols {
    display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr);
    gap: 0 18px; align-items: start;
  }
  .nce-lesson-page .nce-section-title {
    display: flex; align-items: center; gap: 8px;
    font-size: 15.5px; font-weight: 680; letter-spacing: .01em;
  }
  .nce-lesson-page .nce-section-title::before {
    content: ''; display: inline-block; flex: none;
    width: 3px; height: 15px; border-radius: 2px;
    background: var(--dsw-alias-brand-primary, #4c8dff);
  }
  .nce-lesson-text { display: flex; flex-direction: column; gap: 12px; }
  .nce-lesson-text-actions { display: flex; justify-content: flex-end; margin: 0 2px 8px; }
  .nce-lesson-exercise { display: flex; flex-direction: column; gap: 14px; }

  .nce-lesson-eyebrow {
    font-size: 10.5px; font-weight: 600; letter-spacing: .16em; text-transform: uppercase;
    color: var(--dsw-alias-label-secondary, #8a8f98);
  }
  .nce-lesson-question {
    padding: 16px 20px; border-left: 3px solid color-mix(in srgb, var(--dsw-alias-brand-primary, #4c8dff) 55%, transparent);
  }
  .nce-lesson-question-head { display: flex; align-items: center; gap: 8px; }
  .nce-lesson-question-en { margin: 9px 0 0; font-size: 18px; line-height: 1.55; }
  .nce-lesson-question-zh { margin: 5px 0 0; font-size: 13px; line-height: 1.6; color: var(--dsw-alias-label-secondary, #8a8f98); }

  .nce-lesson-dialogue { margin-top: 0; overflow: hidden; }
  .nce-lesson-dialogue-row {
    display: flex; align-items: flex-start; gap: 12px; padding: 11px 16px;
    border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.14));
    transition: background .14s ease;
  }
  .nce-lesson-dialogue-row:last-child { border-bottom: 0; }
  .nce-lesson-line-no {
    flex: none; width: 24px; padding-top: 3px; font-size: 10.5px;
    color: var(--dsw-alias-label-secondary, #8a8f98); opacity: .55; font-variant-numeric: tabular-nums;
  }
  .nce-lesson-line-speaker {
    flex: none; max-width: 92px; margin-top: 1px; padding: 1px 7px 2px; border-radius: 5px;
    font-size: 10px; font-weight: 650; letter-spacing: .06em; line-height: 1.5;
    color: var(--dsw-alias-label-secondary, #8a8f98);
    background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.12));
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .nce-lesson-dialogue-main { flex: 1; min-width: 0; }
  .nce-lesson-dialogue-en { font-size: 15px; line-height: 1.62; }
  .nce-lesson-dialogue-zh { margin-top: 4px; font-size: 13px; line-height: 1.55; color: var(--dsw-alias-label-secondary, #8a8f98); }
  .nce-lesson-dialogue-sound { flex: none; margin-top: -1px; opacity: .5; transition: opacity .14s ease; }
  .nce-lesson-dialogue-row:hover .nce-lesson-dialogue-sound { opacity: 1; }

  .nce-lesson-trans { margin-top: 0; padding: 8px 0 10px; }
  .nce-lesson-trans-title {
    padding: 10px 16px 6px; font-size: 11px; font-weight: 650; letter-spacing: .08em;
    color: var(--dsw-alias-label-secondary, #8a8f98);
  }
  .nce-lesson-trans-row { display: flex; align-items: flex-start; gap: 12px; padding: 6px 16px; }
  .nce-lesson-trans-zh { flex: 1; min-width: 0; font-size: 13px; line-height: 1.6; }

  .nce-lesson-vocab-list { overflow: hidden; }
  .nce-lesson-vocab-row {
    display: flex; align-items: flex-start; gap: 12px; padding: 10px 14px;
    border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.14));
  }
  .nce-lesson-vocab-row:last-child { border-bottom: 0; }
  .nce-lesson-vocab-row:hover { background: color-mix(in srgb, var(--dsw-alias-bg-layer-2, rgba(127,127,127,.1)) 55%, transparent); }
  .nce-lesson-vocab-main { flex: 1; min-width: 0; }
  .nce-lesson-vocab-top { display: flex; align-items: baseline; flex-wrap: wrap; gap: 7px; }
  .nce-lesson-vocab-word { font-size: 15px; font-weight: 650; letter-spacing: .002em; }
  .nce-lesson-vocab-phonetic { font-size: 12px; color: var(--dsw-alias-label-secondary, #8a8f98); }
  .nce-lesson-vocab-pos { font-size: 10.5px; font-style: italic; color: var(--dsw-alias-label-secondary, #8a8f98); }
  .nce-lesson-vocab-meaning { margin-top: 3px; font-size: 13px; line-height: 1.55; }
  .nce-lesson-vocab-example { margin-top: 3px; font-size: 11.5px; line-height: 1.5; color: var(--dsw-alias-label-secondary, #8a8f98); }
  .nce-lesson-vocab-actions { flex: none; display: flex; align-items: center; gap: 2px; margin-top: -1px; }

  .nce-lesson-textnotes { list-style: none; margin: 0; padding: 0; overflow: hidden; }
  .nce-lesson-textnote {
    display: flex; align-items: flex-start; gap: 12px; padding: 12px 16px;
    border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.14));
  }
  .nce-lesson-textnote:last-child { border-bottom: 0; }
  .nce-lesson-textnote-num {
    flex: none; min-width: 22px; height: 22px; padding: 0 6px; border-radius: 7px;
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 10.5px; font-weight: 650;
    color: var(--dsw-alias-brand-primary, #4c8dff);
    background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4c8dff) 10%, transparent);
  }
  .nce-lesson-textnote-body { flex: 1; min-width: 0; }
  .nce-lesson-textnote-en { display: flex; align-items: center; gap: 4px; font-size: 14px; line-height: 1.55; }
  .nce-lesson-textnote-zh { margin: 5px 0 0; font-size: 12.5px; line-height: 1.8; color: var(--dsw-alias-label-secondary, #8a8f98); }

  .nce-lesson-grammar { display: flex; flex-direction: column; gap: 12px; }
  .nce-lesson-notepage { margin-top: 0; }
  .nce-lesson-notepage-head {
    display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px;
    margin: 0 2px 8px; font-size: 11.5px; font-weight: 650; letter-spacing: .05em;
    color: var(--dsw-alias-label-secondary, #8a8f98);
  }
  .nce-lesson-notepage-tags { font-weight: 500; letter-spacing: 0; opacity: .8; }
  .nce-lesson-noteblocks {
    overflow: hidden;
    columns: 2; column-gap: 30px;
    column-rule: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.14));
  }
  .nce-lesson-noteblock { padding: 13px 18px; break-inside: avoid; }
  .nce-lesson-noteblock + .nce-lesson-noteblock { border-top: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.14)); }
  .nce-lesson-notecollapse { break-inside: avoid; }
  @container (max-width: 980px) {
    .nce-lesson-noteblocks { columns: 1; column-rule: 0; }
  }
  .nce-lesson-notecollapse { padding: 13px 18px; }
  .nce-lesson-notecollapse:last-child { border-bottom: 0; }
  .nce-lesson-notecollapse > summary {
    display: flex; align-items: center; gap: 8px; cursor: pointer;
    list-style: none; font-size: 12px;
  }
  .nce-lesson-notecollapse > summary::-webkit-details-marker { display: none; }
  .nce-lesson-notecollapse > summary .nce-icon { margin-left: auto; color: var(--dsw-alias-label-secondary, #8a8f98); transition: transform .15s ease; }
  .nce-lesson-notecollapse[open] > summary .nce-icon { transform: rotate(180deg); }
  .nce-lesson-noteblock-head { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
  .nce-lesson-noteblock-type {
    flex: none; height: 18px; padding: 0 7px; border-radius: 999px;
    display: inline-flex; align-items: center; font-size: 10px; font-weight: 650; letter-spacing: .02em;
    color: var(--dsw-alias-label-secondary, #8a8f98);
    background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.14));
  }
  .nce-lesson-noteblock.is-grammar .nce-lesson-noteblock-type {
    color: var(--dsw-alias-brand-primary, #4c8dff);
    background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4c8dff) 11%, transparent);
  }
  .nce-lesson-noteblock.is-vocab .nce-lesson-noteblock-type {
    color: var(--dsw-alias-state-success-primary, #2f9e44);
    background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #2f9e44) 11%, transparent);
  }
  .nce-lesson-noteblock-title { font-size: 13px; font-weight: 650; }
  .nce-lesson-noteblock-phonetic { font-size: 11px; color: var(--dsw-alias-label-secondary, #8a8f98); }
  .nce-lesson-noteblock-hint { font-size: 11px; color: var(--dsw-alias-label-secondary, #8a8f98); }
  .nce-lesson-noteblock-lines { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
  .nce-lesson-noteblock-lines > li { font-size: 12.5px; line-height: 1.75; color: var(--dsw-alias-label-secondary, #8a8f98); word-break: break-word; }
  .nce-lesson-noteblock.is-grammar .nce-lesson-noteblock-lines > li { color: var(--dsw-alias-label-primary, #1f2328); opacity: .9; }
  .nce-lesson-notecollapse .nce-lesson-noteblock-lines { margin-top: 8px; }

  .nce-lesson-dialogue-row.is-clickable { cursor: pointer; }
  .nce-lesson-dialogue-row.is-clickable:hover { background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.06)); }
  .nce-lesson-video-frame-wrap {
    position: relative; width: 100%; max-width: 900px; aspect-ratio: 16 / 9;
    border-radius: 13px; overflow: hidden;
    border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.18));
    background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.1));
  }
  .nce-lesson-video-frame { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; display: block; }
  .nce-lesson-video-stage-foot {
    display: flex; align-items: center; gap: 10px; margin-top: 9px;
    font-size: 11.5px; color: var(--dsw-alias-label-secondary, #8a8f98);
  }
  .nce-lesson-video-open-link { display: inline-flex; align-items: center; gap: 4px; color: var(--dsw-alias-label-secondary, #8a8f98); }
  .nce-lesson-video-open-link:hover { color: var(--dsw-alias-brand-primary, #4c8dff); }
  .nce-lesson-video { padding: 14px 16px 16px; display: flex; flex-direction: column; gap: 12px; }
  .nce-lesson-video-parts { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
  .nce-lesson-video-part {
    display: inline-flex; align-items: center; gap: 5px;
    padding: 3px 9px; border-radius: 999px; cursor: pointer;
    border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.24));
    background: transparent; color: var(--dsw-alias-label-secondary, #8a8f98);
    font: inherit; font-size: 11px;
  }
  .nce-lesson-video-part.is-active {
    color: var(--dsw-alias-brand-primary, #4c8dff);
    border-color: color-mix(in srgb, var(--dsw-alias-brand-primary, #4c8dff) 45%, transparent);
    background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4c8dff) 10%, transparent);
  }
  .nce-lesson-video-part-dur { font-size: 10px; opacity: .72; font-variant-numeric: tabular-nums; }
  .nce-lesson-video-custom-toggle {
    align-self: flex-start; margin-top: 8px; display: inline-flex; align-items: center; gap: 4px;
    padding: 0; border: 0; background: transparent; cursor: pointer;
    font: inherit; font-size: 11px; color: var(--dsw-alias-label-secondary, #8a8f98);
  }
  .nce-lesson-video-custom-toggle:hover { color: var(--dsw-alias-brand-primary, #4c8dff); }
  .nce-lesson-video-open { margin-top: 12px; display: flex; align-items: center; flex-wrap: wrap; gap: 16px; padding: 16px 18px; }
  .nce-lesson-video-open-main { flex: 1; min-width: 220px; }
  .nce-lesson-video-open-title { font-size: 13px; font-weight: 600; }
  .nce-lesson-video-open-url { margin-top: 4px; font-size: 11.5px; color: var(--dsw-alias-label-secondary, #8a8f98); word-break: break-all; }
  .nce-lesson-video-form {
    display: flex; flex-direction: column; gap: 10px; margin-top: 16px; padding: 14px 16px;
    border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.18));
    border-radius: 12px;
    background: var(--dsw-alias-bg-layer-1, rgba(127,127,127,.04));
  }
  .nce-lesson-field { display: flex; flex-direction: column; gap: 6px; }
  .nce-lesson-field-label { font-size: 11.5px; font-weight: 600; color: var(--dsw-alias-label-secondary, #8a8f98); }
  .nce-lesson-input {
    height: 32px; padding: 0 10px; border-radius: 8px;
    border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.26));
    background: var(--dsw-alias-bg-base, #fff); color: var(--dsw-alias-label-primary, #1f2328);
    font: inherit; font-size: 12px; outline: none;
  }
  .nce-lesson-input:focus {
    border-color: var(--dsw-alias-brand-primary, #4c8dff);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary, #4c8dff) 18%, transparent);
  }
  .nce-lesson-input::placeholder { color: var(--dsw-alias-label-secondary, #8a8f98); opacity: .75; }
  .nce-lesson-video-actions { display: flex; align-items: center; gap: 8px; }
  .nce-lesson-video-links { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  .nce-lesson-link { text-decoration: none; }
  .nce-lesson-hint { margin: 0; font-size: 11.5px; line-height: 1.7; color: var(--dsw-alias-label-secondary, #8a8f98); }

  @container (max-width: 640px) {
    .nce-lesson-cols { grid-template-columns: minmax(0, 1fr); }
  }
  /* Narrow layout: the course page shows its sticky 课程列表 back bar at the top,
     so the anchor strip scrolls normally instead of overlapping it. */
  @container (max-width: 800px) {
    .nce-lesson-anchors { position: static; }
  }

  /* The panel is usually narrower than the window: the lesson page reacts to its
     own width, not the viewport. */
  @container (max-width: 720px) {
    .nce-lesson-head { padding: 16px; }
    .nce-lesson-head-columns { flex-direction: column; gap: 10px; }
    .nce-lesson-head-side { flex-direction: row; align-items: center; }
    .nce-lesson-head-en { font-size: 22px; }
    .nce-lesson-dialogue-row { flex-wrap: wrap; gap: 8px; padding: 10px 13px; }
    .nce-lesson-line-speaker { max-width: 72px; }
    .nce-lesson-vocab-row { padding: 9px 12px; }
    .nce-lesson-anchors-label { display: none; }
  }
  @media (max-width: 720px) {
    .nce-lesson-embedded { padding: 12px; }
  }

  /* Printing the exercise paper must not print the whole lesson around it. */
  @media print {
    .nce-lesson-page { container-type: normal; }
    .nce-lesson-head, .nce-lesson-anchors,
    .nce-lesson-section:not([data-lesson-anchor="exercise"]) { display: none !important; }
  }
`)
