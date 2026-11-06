// Layer: 60 review — depends on: 00–07 foundation (incl. 04-tts playback).

// ---------------------------------------------------------------------------
// Review: today's SRS queue. Progress HUD, flip card with speak, four-grade
// buttons (Again/Hard/Good/Easy), keyboard shortcuts, empty states and a
// session summary that links back to the word bank and the course list.
// ---------------------------------------------------------------------------

const R_TALLY_DEFAULT = { again: 0, hard: 0, good: 0, easy: 0 }

const R_LIMIT_OPTIONS = [5, 10, 20]

const R_EMPTY_STATES = {
  bank: {
    icon: 'cards',
    title: '词库还没有数据',
    text: '词库为空，复习队列就没东西可排。先去课程页看看课文，数据构建完成后这里会自动出现记忆卡。',
  },
  quota: {
    icon: 'spark',
    title: '每日新卡上限是 0',
    text: '今天没有待复习的卡，新卡也没被放进队列。在下面挑一个每日新卡上限，或继续学下一课来解锁更多卡片。',
  },
  allDone: {
    icon: 'check',
    title: '今天的记忆卡已经清完了',
    text: '所有记忆卡都已排进复习计划；良好、简单的卡会在之后几天回来。',
  },
  due: {
    icon: 'clock',
    title: '今天没有到期词',
    text: '先把已解锁的新卡学起来，或继续学下一课解锁更多卡片；稍后刷新队列也许会有「重来」的卡重新到期。',
  },
}

/** Which empty state to show when the host returns an empty queue. */
function R_emptyKind(meta, wordTotal, limitNew) {
  const dueCount = Number(meta?.dueCount) || 0
  const newCount = Number(meta?.newCount) || 0
  if (wordTotal === 0) return 'bank'
  if (dueCount === 0 && newCount > 0 && Number(limitNew) <= 0) return 'quota'
  if (dueCount === 0 && newCount === 0) return 'allDone'
  return 'due'
}

/** Live "graded today" count from shared progress, falling back to the queue payload. */
function R_todayCount(progress, meta) {
  const live = progress?.history?.[todayKey()]
  if (live !== undefined && live !== null && Number.isFinite(Number(live))) return Number(live)
  return Number(meta?.dayCount) || 0
}

function R_streakDays(progress, meta) {
  const streak = progress?.streak
  if (streak !== null && streak !== undefined) return Number(streak.days) || 0
  return Number(meta?.streak?.days) || 0
}

function ReviewPage() {
  const { progress, go, gradeWord } = useNce()
  const bankState = useWordbank()
  const bank = bankState.data?.wordbank ?? null
  const wordTotal = bank === null
    ? null
    : Number(bank.total) || (Array.isArray(bank.words) ? bank.words.length : 0)

  const [round, setRound] = useState(0)
  const [queue, setQueue] = useState([])
  const [meta, setMeta] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [busy, setBusy] = useState(false)
  const [gradeError, setGradeError] = useState(null)
  const [tally, setTally] = useState(() => ({ ...R_TALLY_DEFAULT }))
  const [limitNew, setLimitNew] = useState(() => readPrefs().newPerDay)
  const [autoSpeak, setAutoSpeak] = useState(() => readPrefs().autoSpeak)
  const gradingRef = useRef(false)

  useEffect(() => {
    const controller = new AbortController()
    let alive = true
    const prefs = readPrefs()
    const limit = prefs.newPerDay
    setLoading(true)
    setError(null)
    setLimitNew(limit)
    api('review/queue', {
      limitNew: limit,
      limitTranslationNew: prefs.translationNewPerDay,
      syncTranslate: prefs.translateAutoSync,
    }, { signal: controller.signal })
      .then((result) => {
        if (!alive) return
        setQueue(Array.isArray(result.queue) ? result.queue : [])
        setMeta(result)
        setIndex(0)
        setFlipped(false)
        setTally({ ...R_TALLY_DEFAULT })
        setGradeError(null)
        setLoading(false)
      })
      .catch((err) => {
        if (!alive || isAbortError(err)) return
        setError(err)
        setLoading(false)
      })
    return () => {
      alive = false
      controller.abort()
    }
  }, [round])

  const finished = queue.length > 0 && index >= queue.length
  const current = finished || index >= queue.length ? null : queue[index]
  const remaining = Math.max(0, queue.length - index)
  const todayCount = R_todayCount(progress, meta)
  const streak = R_streakDays(progress, meta)
  const emptyKind = R_emptyKind(meta, wordTotal, limitNew)

  // Lazily speak the front of the next card when the preference is on.
  useEffect(() => {
    if (!autoSpeak || current === null) return
    playText(current.word)
  }, [autoSpeak, current])

  const toggleAutoSpeak = useCallback(() => {
    const next = !readPrefs().autoSpeak
    writePrefs({ autoSpeak: next })
    setAutoSpeak(next)
  }, [])

  const reload = useCallback(() => setRound((value) => value + 1), [])

  const chooseLimit = useCallback((limit) => {
    writePrefs({ newPerDay: limit })
    setLimitNew(limit)
    setRound((value) => value + 1)
  }, [])

  const grade = useCallback(async (gradeId) => {
    if (current === null || flipped !== true || finished || gradingRef.current) return
    gradingRef.current = true
    setBusy(true)
    setGradeError(null)
    try {
      await gradeWord(current.key, gradeId)
      setTally((previous) => ({ ...previous, [gradeId]: (Number(previous[gradeId]) || 0) + 1 }))
      setFlipped(false)
      setIndex((previous) => previous + 1)
    } catch (err) {
      setGradeError(err)
    } finally {
      gradingRef.current = false
      setBusy(false)
    }
  }, [current, flipped, finished, gradeWord])

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target
      const tag = target !== null && target !== undefined ? String(target.tagName ?? '') : ''
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable === true) return
      if (loading || error !== null || finished || current === null) return
      if (event.key === ' ' || event.code === 'Space' || event.key === 'Spacebar') {
        event.preventDefault()
        setFlipped((value) => !value)
        return
      }
      if (flipped !== true) return
      const position = Number(event.key)
      if (!Number.isInteger(position) || position < 1 || position > GRADES.length) return
      event.preventDefault()
      grade(GRADES[position - 1].id)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [loading, error, finished, current, flipped, grade])

  if (loading) {
    return h('div', { className: 'nce-wrap' }, h(Loading, { text: '正在取今日复习队列…' }))
  }
  if (error !== null) {
    return h('div', { className: 'nce-wrap' }, h(ErrorBox, { error, onRetry: reload }))
  }

  if (finished) {
    return h('div', { className: 'nce-wrap' },
      h('div', { className: 'nce-page-head' },
        h('div', null,
          h('h1', { className: 'nce-page-title' }, '复习结算'),
          h('p', { className: 'nce-page-sub' }, '这一轮队列已经走完，评分已写进学习进度。'))),
      h(ReviewSummary, {
        total: queue.length,
        tally,
        todayCount,
        streak,
        onAgain: reload,
        onWords: () => go('words'),
        onHome: () => go('home'),
      }))
  }

  if (queue.length === 0) {
    if (bankState.loading && bank === null) {
      return h('div', { className: 'nce-wrap' }, h(Loading, { text: '正在读取词库…' }))
    }
    return h('div', { className: 'nce-wrap' },
      h('div', { className: 'nce-page-head' },
        h(Btn, { kind: 'quiet', size: 'sm', icon: 'arrowLeft', className: 'nce-review-back', onClick: () => go('words') }, '记忆卡'),
        h('div', null,
          h('h1', { className: 'nce-page-title' }, '记忆卡复习'),
          h('p', { className: 'nce-page-sub' }, 'Anki 式间隔重复：待复习卡按 SRS 自动排进队列，新卡受每日上限控制。'))),
      h(ReviewEmpty, {
        kind: emptyKind,
        limitNew,
        todayCount,
        streak,
        onWords: () => go('words'),
        onHome: () => go('home'),
        onRetry: reload,
        onLimit: chooseLimit,
      }))
  }

  return h('div', { className: 'nce-wrap' },
    h('div', { className: 'nce-page-head' },
      h(Btn, { kind: 'quiet', size: 'sm', icon: 'arrowLeft', className: 'nce-review-back', onClick: () => go('words') }, '记忆卡'),
      h('div', null,
        h('h1', { className: 'nce-page-title' }, '记忆卡复习'),
        h('p', { className: 'nce-page-sub' },
          `待复习 ${Number(meta?.counts?.due ?? meta?.dueCount) || 0} 张 · 学习中 ${Number(meta?.counts?.learning) || 0} 张` +
          ` · 新卡 ${Number(meta?.counts?.new ?? meta?.newCount) || 0} 张 · 每日新卡上限 ${limitNew}`),
        meta?.unlocked !== undefined && Number(meta?.unlocked?.lockedNew) > 0
          ? h('p', { className: 'nce-page-sub nce-review-unlockhint' },
            Icon('lock', 12),
            `新卡按学习进度解锁：已解锁第 ${(meta.unlocked.lessons ?? []).join('、')} 课，学完第 ${meta.unlocked.nextLesson} 课解锁下一批（还有 ${Number(meta.unlocked.lockedNew) || 0} 张未解锁）`)
          : h('p', { className: 'nce-page-sub nce-review-unlockhint' },
            Icon('check', 12), '所有记忆卡均已解锁，按 SRS 节奏复习即可')),
      h('div', { className: 'nce-page-head-actions' },
        h(Chip, {
          active: autoSpeak,
          onClick: toggleAutoSpeak,
          title: '进入每张卡时自动朗读单词',
        }, autoSpeak ? '自动朗读 · 开' : '自动朗读 · 关'),
        h(Btn, { kind: 'ghost', icon: 'cards', onClick: () => go('words') }, '记忆卡'))),

    h('div', { className: 'nce-review-hud nce-card' },
      h('div', { className: 'nce-review-hud-main' },
        h('div', { className: 'nce-review-hud-head' },
          h('span', { className: 'nce-review-hud-label' }, '本轮进度'),
          h('span', { className: 'nce-review-hud-count' }, `${index} / ${queue.length}`)),
        h(Bar, { value: index, total: queue.length }),
        h('div', { className: 'nce-review-hud-hint' }, `剩余 ${remaining} 张 · 空格翻面，翻面后按 1–4 评分`)),
      h('div', { className: 'nce-review-hud-stats' },
        h(Stat, { value: remaining, unit: '张', label: '本轮剩余' }),
        h(Stat, { value: todayCount, unit: '张', label: '今日已复习' }),
        h(Stat, { value: streak, unit: '天', label: '连续复习' }))),

    h(ReviewCard, { item: current, flipped, onFlip: () => setFlipped((value) => !value) }),

    gradeError !== null
      ? h(ErrorBox, { title: '评分失败', error: gradeError, text: '再点一次评分按钮即可重试' })
      : null,

    flipped
      ? h('div', { className: 'nce-review-grades' },
        GRADES.map((gradeItem, position) => h(Btn, {
          key: gradeItem.id,
          kind: 'soft',
          size: 'lg',
          className: cx('nce-review-grade', `nce-review-grade-${gradeItem.tone}`),
          disabled: busy,
          onClick: () => grade(gradeItem.id),
        },
        h('span', { className: 'nce-review-grade-key' }, String(position + 1)),
        h('span', { className: 'nce-review-grade-body' },
          h('span', { className: 'nce-review-grade-label' }, gradeItem.label),
          h('span', { className: 'nce-review-grade-hint' }, gradeItem.hint)))))
      : h('div', { className: 'nce-review-flipbar' },
        h(Btn, { kind: 'primary', size: 'lg', icon: 'flip', onClick: () => setFlipped(true), disabled: busy }, '显示释义'),
        h('span', { className: 'nce-review-kbd' }, '或按 空格')))
}

function ReviewCard(props) {
  const item = props.item
  if (item?.kind === 'translation') {
    return h(ReviewTranslationCard, { item, flipped: props.flipped, onFlip: props.onFlip })
  }
  const lesson = Number(item?.lesson) || 0
  const tag = item?.isNew === true ? '新卡' : dueLabel(item?.card)
  return h('div', {
    className: cx('nce-review-card', 'nce-card', props.flipped && 'is-flipped'),
    role: 'button',
    tabIndex: 0,
    'aria-label': props.flipped ? '回到单词正面' : '显示释义',
    onClick: props.onFlip,
  },
  props.flipped
    ? h('div', { className: 'nce-review-face nce-review-face-back' },
      h('div', { className: 'nce-review-back-word nce-en' }, item?.word ?? ''),
      h('div', { className: 'nce-review-back-line' },
        item?.pos !== undefined && item?.pos !== '' ? h('span', { className: 'nce-review-pos' }, item.pos) : null,
        h('span', { className: 'nce-review-back-meaning' }, item?.meaning !== undefined && item?.meaning !== '' ? item.meaning : '—')),
      item?.example !== undefined && item?.example !== ''
        ? h('div', { className: 'nce-review-example' },
          h('span', { className: 'nce-en' }, item.example),
          h(Speaker, { text: item.example, size: 'sm' }))
        : null,
      h('div', { className: 'nce-review-origin' }, lesson > 0 ? `出处 · 第 ${lesson} 课` : '出处 · 未知'),
      h('div', { className: 'nce-review-card-hint' }, '点击卡片或按 空格 回到正面'))
    : h('div', { className: 'nce-review-face nce-review-face-front' },
      h('span', { className: cx('nce-review-tag', item?.isNew === true && 'is-new') }, tag),
      h('div', { className: 'nce-review-word nce-en' }, item?.word ?? ''),
      item?.phonetic !== undefined && item?.phonetic !== ''
        ? h('div', { className: 'nce-review-phonetic nce-mono' }, item.phonetic)
        : null,
      h('div', { className: 'nce-review-speaker' }, h(Speaker, { text: item?.word ?? '', size: 'md' })),
      h('div', { className: 'nce-review-card-hint' }, '点击卡片或按 空格 显示释义')))
}

/** Front/back card for a sentence promoted from the translation plugin. */
function ReviewTranslationCard(props) {
  const item = props.item
  const translation = item?.translation ?? {}
  const isZhEn = translation.direction === 'zh-en'
  const dirLabel = isZhEn ? '中→英' : '英→中'
  const front = translation.source ?? item?.word ?? ''
  const back = translation.translation ?? item?.meaning ?? ''
  const enText = translation.enText ?? (isZhEn ? back : front)
  const tag = item?.isNew === true ? '新卡' : dueLabel(item?.card)
  return h('div', {
    className: cx('nce-review-card', 'nce-card', 'nce-review-card-translation', props.flipped && 'is-flipped'),
    role: 'button',
    tabIndex: 0,
    'aria-label': props.flipped ? '回到原文' : '显示译文',
    onClick: props.onFlip,
  },
  props.flipped
    ? h('div', { className: 'nce-review-face nce-review-face-back' },
      h('div', { className: 'nce-review-back-word nce-review-translation-back' }, back),
      h('div', { className: 'nce-review-translation-source' }, front),
      translation.notes !== undefined && translation.notes !== ''
        ? h('div', { className: 'nce-review-translation-notes' }, translation.notes)
        : null,
      Array.isArray(translation.examples) && translation.examples.length > 0
        ? h('div', { className: 'nce-review-example nce-en' }, translation.examples[0])
        : null,
      h('div', { className: 'nce-review-origin' }, `出处 · 我的翻译（${dirLabel}）`),
      h('div', { className: 'nce-review-card-hint' }, '点击卡片或按 空格 回到原文'))
    : h('div', { className: 'nce-review-face nce-review-face-front' },
      h('span', { className: cx('nce-review-tag', item?.isNew === true && 'is-new') }, tag),
      h('span', { className: 'nce-review-tag nce-review-tag-muted' }, `我的翻译 · ${dirLabel}`),
      h('div', { className: 'nce-review-word nce-review-translation-front' }, front),
      h('div', { className: 'nce-review-speaker' }, h(Speaker, { text: enText, size: 'md' })),
      h('div', { className: 'nce-review-card-hint' }, '点击卡片或按 空格 显示译文')))
}

function ReviewSummary(props) {
  const tally = props.tally ?? R_TALLY_DEFAULT
  return h('div', { className: 'nce-review-summary nce-card' },
    h('div', { className: 'nce-review-summary-head' },
      h('div', { className: 'nce-review-summary-icon' }, Icon('check', 24)),
      h('div', null,
        h('h2', { className: 'nce-review-summary-title' }, '这一轮过完了'),
        h('p', { className: 'nce-review-summary-text' },
          `本轮评分 ${Number(props.total) || 0} 张。「重来」的卡约 1 分钟后重新到期，「良好」的卡明天见。`))),
    h('div', { className: 'nce-review-summary-stats' },
      h(Stat, { value: Number(props.total) || 0, unit: '张', label: '本轮完成' }),
      h(Stat, { value: Number(props.todayCount) || 0, unit: '张', label: '今日累计' }),
      h(Stat, { value: tally.again, unit: '张', label: '重来' }),
      h(Stat, { value: tally.good, unit: '张', label: '良好' })),
    h('div', { className: 'nce-review-summary-meta' },
      h('span', { className: 'nce-review-summary-streak' }, Icon('flame', 14), `连续复习 ${Number(props.streak) || 0} 天`),
      h('span', null, `困难 ${tally.hard} 张 · 简单 ${tally.easy} 张`)),
    h('div', { className: 'nce-review-summary-actions' },
      h(Btn, { kind: 'primary', size: 'lg', icon: 'refresh', onClick: props.onAgain }, '再来一轮'),
      h(Btn, { kind: 'soft', size: 'lg', icon: 'cards', onClick: props.onWords }, '去记忆卡'),
      h(Btn, { kind: 'soft', size: 'lg', icon: 'home', onClick: props.onHome }, '回课程')))
}

function ReviewEmpty(props) {
  const info = R_EMPTY_STATES[props.kind] ?? R_EMPTY_STATES.due
  return h('div', { className: 'nce-review-empty nce-card' },
    h(Empty, {
      icon: info.icon,
      title: info.title,
      text: info.text,
      action: props.kind === 'bank'
        ? h('div', { className: 'nce-review-empty-actions' },
          h(Btn, { kind: 'primary', icon: 'home', onClick: props.onHome }, '回课程'),
          h(Btn, { kind: 'soft', icon: 'cards', onClick: props.onWords }, '去记忆卡'))
        : h('div', { className: 'nce-review-empty-actions' },
          h(Btn, { kind: 'primary', icon: 'cards', onClick: props.onWords }, '去记忆卡'),
          h(Btn, { kind: 'soft', icon: 'refresh', onClick: props.onRetry }, '刷新队列'),
          h(Btn, { kind: 'soft', icon: 'home', onClick: props.onHome }, '回课程')),
    }),
    props.kind === 'quota'
      ? h('div', { className: 'nce-review-empty-limit' },
        h('span', { className: 'nce-review-empty-limit-label' }, '每日新卡上限'),
        R_LIMIT_OPTIONS.map((limit) => h(Chip, {
          key: limit,
          active: Number(props.limitNew) === limit,
          onClick: () => props.onLimit(limit),
        }, `${limit} 张 / 天`)))
      : null,
    h('p', { className: 'nce-review-empty-hint' },
      `今日已复习 ${Number(props.todayCount) || 0} 张 · 连续 ${Number(props.streak) || 0} 天`))
}

addCss(`
  .nce-review-back { margin-top: 2px; }
  .nce-review-card-translation .nce-review-translation-front,
  .nce-review-card-translation .nce-review-translation-back {
    font-family: inherit; font-size: clamp(18px, 2.4vw, 26px); line-height: 1.35;
    max-width: 90%; text-align: center;
  }
  .nce-review-card-translation .nce-review-translation-back { font-weight: 600; }
  .nce-review-translation-source {
    max-width: 90%; font-size: 12px; line-height: 1.5; text-align: center;
    color: var(--dsw-alias-label-secondary, #8a8f98);
  }
  .nce-review-translation-notes {
    max-width: 88%; max-height: 120px; overflow: auto;
    padding: 8px 10px; border-radius: 8px;
    font-size: 11.5px; line-height: 1.65; white-space: pre-wrap;
    color: var(--dsw-alias-label-secondary, #8a8f98);
    background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.06));
  }
  .nce-review-tag-muted { opacity: .72; }
  .nce-review-unlockhint { display: flex; align-items: center; gap: 5px; margin-top: 3px; }
  .nce-review-hud {
    display: flex; align-items: center; gap: 22px; flex-wrap: wrap;
    padding: 14px 18px; margin-bottom: 16px;
  }
  .nce-review-hud-main { flex: 1 1 260px; min-width: 0; }
  .nce-review-hud-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 7px; }
  .nce-review-hud-label { font-size: 12px; color: var(--dsw-alias-label-secondary, #8a8f98); }
  .nce-review-hud-count {
    font-size: 12px; font-weight: 650; letter-spacing: .01em;
    font-variant-numeric: tabular-nums;
  }
  .nce-review-hud-hint { margin-top: 7px; font-size: 11px; color: var(--dsw-alias-label-secondary, #8a8f98); }
  .nce-review-hud-stats { display: flex; gap: 20px; flex: none; }
  .nce-review-hud-stats .nce-stat + .nce-stat {
    border-left: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.16)); padding-left: 20px;
  }

  .nce-review-card {
    min-height: 260px; padding: 28px 24px; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    background:
      radial-gradient(110% 150% at 50% 0%, color-mix(in srgb, var(--dsw-alias-brand-primary, #4c8dff) 7%, transparent) 0%, transparent 62%),
      var(--dsw-alias-bg-layer-1, rgba(127,127,127,.04));
    transition: border-color .16s ease;
  }
  .nce-review-card:hover { border-color: var(--dsw-alias-border-l2, rgba(127,127,127,.42)); }
  .nce-review-card.is-flipped { border-color: color-mix(in srgb, var(--dsw-alias-brand-primary, #4c8dff) 34%, transparent); }
  .nce-review-face {
    display: flex; flex-direction: column; align-items: center; gap: 9px;
    width: 100%; text-align: center;
  }
  .nce-review-tag {
    display: inline-flex; align-items: center; height: 19px; padding: 0 8px; border-radius: 999px;
    font-size: 10.5px; color: var(--dsw-alias-label-secondary, #8a8f98);
    background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.14));
  }
  .nce-review-tag.is-new {
    color: var(--dsw-alias-brand-primary, #4c8dff);
    background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4c8dff) 11%, transparent);
  }
  .nce-review-word { font-size: 46px; font-weight: 680; line-height: 1.1; letter-spacing: .005em; }
  .nce-review-phonetic { font-size: 17px; color: var(--dsw-alias-label-secondary, #8a8f98); }
  .nce-review-speaker { margin-top: 2px; }
  .nce-review-back-word { font-size: 18px; font-weight: 600; color: var(--dsw-alias-label-secondary, #8a8f98); }
  .nce-review-back-line {
    display: flex; align-items: baseline; justify-content: center; gap: 9px; flex-wrap: wrap;
    max-width: 620px;
  }
  .nce-review-pos {
    flex: none; padding: 1px 7px; border-radius: 999px; font-size: 11px;
    color: var(--dsw-alias-brand-primary, #4c8dff);
    background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4c8dff) 11%, transparent);
  }
  .nce-review-back-meaning { font-size: 22px; font-weight: 620; line-height: 1.45; }
  .nce-review-example {
    display: flex; align-items: center; justify-content: center; gap: 6px; flex-wrap: wrap;
    max-width: 580px; margin-top: 2px; padding: 9px 14px; border-radius: 9px;
    font-size: 13px; line-height: 1.7; color: var(--dsw-alias-label-secondary, #8a8f98);
    background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.08));
  }
  .nce-review-origin { font-size: 11.5px; color: var(--dsw-alias-label-secondary, #8a8f98); }
  .nce-review-card-hint { margin-top: 6px; font-size: 11px; color: var(--dsw-alias-label-secondary, #8a8f98); opacity: .85; }

  .nce-review-flipbar {
    display: flex; align-items: center; justify-content: center; gap: 10px; margin-top: 14px;
  }
  .nce-review-kbd { font-size: 11px; color: var(--dsw-alias-label-secondary, #8a8f98); }

  .nce-review-grades {
    display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin-top: 12px;
  }
  .nce-review-grade {
    height: auto; min-height: 52px; padding: 7px 10px;
    justify-content: flex-start; gap: 8px;
  }
  .nce-review-grade-key {
    flex: none; width: 18px; height: 18px; border-radius: 5px;
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 10.5px; font-weight: 600;
    color: var(--dsw-alias-label-secondary, #8a8f98);
    background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.14));
  }
  .nce-review-grade-body { display: flex; flex-direction: column; align-items: flex-start; gap: 0; line-height: 1.35; }
  .nce-review-grade-label { font-size: 13px; font-weight: 600; }
  .nce-review-grade-hint { font-size: 10.5px; color: var(--dsw-alias-label-secondary, #8a8f98); }
  .nce-review-grade-again { border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, #d9534f) 30%, transparent); }
  .nce-review-grade-again .nce-review-grade-label { color: var(--dsw-alias-state-error-primary, #d9534f); }
  .nce-review-grade-hard { border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #d9a13b) 32%, transparent); }
  .nce-review-grade-hard .nce-review-grade-label { color: var(--dsw-alias-state-warn-primary, #d9a13b); }
  .nce-review-grade-good { border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary, #2e9e5b) 32%, transparent); }
  .nce-review-grade-good .nce-review-grade-label { color: var(--dsw-alias-state-success-primary, #2e9e5b); }
  .nce-review-grade-easy { border-color: color-mix(in srgb, var(--dsw-alias-brand-primary, #4c8dff) 32%, transparent); }
  .nce-review-grade-easy .nce-review-grade-label { color: var(--dsw-alias-brand-primary, #4c8dff); }

  .nce-review-summary { display: flex; flex-direction: column; gap: 18px; padding: 26px 24px; }
  .nce-review-summary-head { display: flex; align-items: flex-start; gap: 14px; }
  .nce-review-summary-icon {
    flex: none; width: 44px; height: 44px; border-radius: 12px;
    display: flex; align-items: center; justify-content: center;
    color: var(--dsw-alias-state-success-primary, #2e9e5b);
    background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #2e9e5b) 12%, transparent);
  }
  .nce-review-summary-title { margin: 0; font-size: 18px; font-weight: 680; }
  .nce-review-summary-text { margin: 4px 0 0; font-size: 12px; line-height: 1.7; color: var(--dsw-alias-label-secondary, #8a8f98); }
  .nce-review-summary-stats {
    display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 18px;
    padding: 14px 0;
    border-top: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.16));
    border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.16));
  }
  .nce-review-summary-stats .nce-stat + .nce-stat {
    border-left: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.16)); padding-left: 18px;
  }
  .nce-review-summary-meta {
    display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
    font-size: 12px; color: var(--dsw-alias-label-secondary, #8a8f98);
  }
  .nce-review-summary-streak { display: inline-flex; align-items: center; gap: 5px; }
  .nce-review-summary-streak .nce-icon { color: var(--dsw-alias-state-warn-primary, #d9a13b); }
  .nce-review-summary-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

  .nce-review-empty { padding: 6px 0 18px; }
  .nce-review-empty-actions { display: flex; align-items: center; justify-content: center; gap: 8px; flex-wrap: wrap; }
  .nce-review-empty-limit {
    display: flex; align-items: center; justify-content: center; gap: 8px; flex-wrap: wrap;
    padding: 0 18px 10px;
  }
  .nce-review-empty-limit-label { font-size: 11.5px; color: var(--dsw-alias-label-secondary, #8a8f98); }
  .nce-review-empty-hint {
    margin: 14px 0 0; text-align: center; font-size: 11px;
    color: var(--dsw-alias-label-secondary, #8a8f98); opacity: .85;
  }

  @media (max-width: 720px) {
    .nce-review-hud { gap: 14px; }
    .nce-review-hud-stats { gap: 14px; }
    .nce-review-hud-stats .nce-stat + .nce-stat { padding-left: 14px; }
    .nce-review-word { font-size: 34px; }
    .nce-review-back-meaning { font-size: 18px; }
    .nce-review-grades { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .nce-review-summary-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); row-gap: 14px; }
    .nce-review-summary-stats .nce-stat:nth-child(3) { border-left: 0; padding-left: 0; }
  }
`)
