// Layer: 50 memory cards — depends on: 00–07 foundation.

// ---------------------------------------------------------------------------
// Words: the whole-book word bank. Search + source-lesson / SRS-state filters,
// an A–Z grouped row list and a single-card study mode (flip, speak, star,
// jump to the review queue).
// ---------------------------------------------------------------------------

const W_FILTERS = [
  { id: 'all', label: '全部' },
  { id: 'unlocked', label: '已解锁' },
  { id: 'new', label: '新卡' },
  { id: 'learning', label: '学习中' },
  { id: 'due', label: '待复习' },
  { id: 'starred', label: '收藏' },
]

const W_LETTER_ORDER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').concat(['#'])

/** Stable identity for one wordbank entry. */
function W_keyOf(word) {
  const key = String(word?.key ?? '').trim()
  return key !== '' ? key : normWord(word?.word)
}

/** First letter bucket: A–Z, everything else under '#'. */
function W_letterOf(word) {
  const first = String(word?.word ?? '').trim().charAt(0).toUpperCase()
  return first >= 'A' && first <= 'Z' ? first : '#'
}

/** The source lesson a wordbank entry should link back to. */
function W_lessonOf(word) {
  const first = Number(word?.firstLesson)
  if (Number.isFinite(first) && first > 0) return first
  const lessons = Array.isArray(word?.lessons) ? word.lessons : []
  const fallback = Number(lessons[0])
  return Number.isFinite(fallback) && fallback > 0 ? fallback : 0
}

function W_cardOf(progress, key) {
  const words = progress?.words
  if (words === null || words === undefined) return null
  return words[key]?.srs ?? null
}

function W_isStarred(progress, key) {
  return progress?.words?.[key]?.starred === true
}

function W_isDue(card) {
  if (card === null || card === undefined || card.state === 0) return false
  const at = Date.parse(card.due)
  return Number.isFinite(at) && at <= Date.now()
}

/** Anki learning steps (state 1 or 3). */
function W_isLearning(card) {
  return card !== null && card !== undefined && (card.state === 1 || card.state === 3)
}

/** Row label: new card / learning / due-soon. */
function W_stateLabel(card) {
  if (W_isLearning(card)) return '学习中'
  return dueLabel(card)
}

function W_searchText(word) {
  return `${word?.word ?? ''} ${word?.meaning ?? ''}`.toLowerCase()
}

function WordsPage() {
  const { progress, go, starWord } = useNce()
  const bankState = useWordbank()
  const bank = bankState.data?.wordbank ?? null
  const words = Array.isArray(bank?.words) ? bank.words : []

  const [query, setQuery] = useState('')
  const [lesson, setLesson] = useState('all')
  const [filter, setFilter] = useState('all')
  const [notice, setNotice] = useState(null)
  const [study, setStudy] = useState(null)

  const total = Number(bank?.total) || words.length
  const due = dueWordCount(progress, bank)
  const unlockedSet = useMemo(() => new Set(startedLessonIds(progress)), [progress])
  const unlockedTotal = useMemo(() => words.filter((word) => isWordUnlocked(word, unlockedSet)).length, [words, unlockedSet])
  const unlockNext = useMemo(() => nextUnlockLessonId(words, unlockedSet), [words, unlockedSet])

  const lessonOptions = useMemo(() => {
    const counts = new Map()
    for (const word of words) {
      const id = W_lessonOf(word)
      if (id <= 0) continue
      counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    return [...counts.entries()].sort((left, right) => left[0] - right[0])
  }, [words])

  const counts = useMemo(() => {
    let fresh = 0
    let learning = 0
    let starred = 0
    let freshUnlocked = 0
    for (const word of words) {
      const key = W_keyOf(word)
      const card = W_cardOf(progress, key)
      if (card === null) {
        fresh += 1
        if (isWordUnlocked(word, unlockedSet)) freshUnlocked += 1
      }
      if (W_isLearning(card)) learning += 1
      if (W_isStarred(progress, key)) starred += 1
    }
    return { fresh, learning, starred, freshUnlocked }
  }, [words, progress])

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    const lessonId = lesson === 'all' ? 0 : Number(lesson)
    return words.filter((word) => {
      if (keyword !== '' && !W_searchText(word).includes(keyword)) return false
      if (lessonId > 0 && W_lessonOf(word) !== lessonId) return false
      const key = W_keyOf(word)
      if (filter === 'unlocked') return isWordUnlocked(word, unlockedSet)
      if (filter === 'new') return W_cardOf(progress, key) === null
      if (filter === 'learning') return W_isLearning(W_cardOf(progress, key))
      if (filter === 'starred') return W_isStarred(progress, key)
      if (filter === 'due') return W_isDue(W_cardOf(progress, key))
      return true
    })
  }, [words, query, lesson, filter, progress])

  const groups = useMemo(() => {
    const buckets = new Map()
    filtered.forEach((word, position) => {
      const letter = W_letterOf(word)
      const rows = buckets.get(letter)
      if (rows === undefined) buckets.set(letter, [{ word, position }])
      else rows.push({ word, position })
    })
    for (const rows of buckets.values()) {
      rows.sort((left, right) => String(left.word?.word ?? '').localeCompare(String(right.word?.word ?? '')))
    }
    return W_LETTER_ORDER.filter((letter) => buckets.has(letter)).map((letter) => ({ letter, rows: buckets.get(letter) }))
  }, [filtered])

  useEffect(() => {
    if (notice === null) return undefined
    const timer = setTimeout(() => setNotice(null), 4200)
    return () => clearTimeout(timer)
  }, [notice])

  const toggleStar = useCallback((word) => {
    const key = W_keyOf(word)
    const starred = W_isStarred(progress, key)
    starWord(key, !starred).catch((error) => {
      setNotice(`「${word?.word ?? key}」收藏失败：${errorMessage(error)}`)
    })
  }, [progress, starWord])

  const resetFilters = useCallback(() => {
    setQuery('')
    setLesson('all')
    setFilter('all')
  }, [])

  const openStudy = useCallback((list, position) => {
    if (list.length === 0) return
    setStudy({ list, index: clamp(position, 0, list.length - 1) })
  }, [])

  const moveStudy = useCallback((delta) => {
    setStudy((previous) => {
      if (previous === null) return previous
      return { ...previous, index: clamp(previous.index + delta, 0, previous.list.length - 1) }
    })
  }, [])

  const closeStudy = useCallback(() => setStudy(null), [])

  if (study !== null) {
    return h('div', { className: 'nce-wrap' },
      h(WordsCardMode, {
        key: study.index,
        list: study.list,
        index: study.index,
        progress,
        due,
        onStar: toggleStar,
        onGo: go,
        onMove: moveStudy,
        onClose: closeStudy,
      }))
  }

  if (bankState.loading && bank === null) {
    return h('div', { className: 'nce-wrap' }, h(Loading, { text: '正在读取词库…' }))
  }
  if (bankState.error !== null && bank === null) {
    return h('div', { className: 'nce-wrap' },
      h(ErrorBox, { error: bankState.error, onRetry: bankState.reload }))
  }

  const activeFilters = query.trim() !== '' || lesson !== 'all' || filter !== 'all'
  const lockedCount = Math.max(0, total - unlockedTotal)
  const chipCounts = { all: words.length, unlocked: unlockedTotal, new: counts.fresh, learning: counts.learning, starred: counts.starred, due }

  return h('div', { className: 'nce-wrap' },
    h('div', { className: 'nce-page-head' },
      h('div', null,
        h('h1', { className: 'nce-page-title' }, '记忆卡'),
        h('p', { className: 'nce-page-sub' },
          `Anki 式间隔重复 · 共 ${total} 张卡片，新卡随课程进度解锁；点卡片进入翻卡学习。`)),
      h('div', { className: 'nce-page-head-actions' },
        h(Btn, { kind: 'primary', icon: 'refresh', onClick: () => go('review') },
          due > 0 ? `去复习 · ${due} 张` : '去复习'))),

    h('div', { className: 'nce-words-meta nce-muted' },
      `已解锁 ${unlockedTotal}/${total} 张 · 新卡 ${counts.fresh}（可学 ${counts.freshUnlocked}） · 学习中 ${counts.learning} · 待复习 ${due} · 收藏 ${counts.starred}`),

    lockedCount > 0
      ? h('div', { className: 'nce-words-unlockhint nce-muted' },
        Icon('lock', 13),
        `新卡跟随学习进度解锁：学完第 ${unlockNext} 课会解锁下一批（还有 ${lockedCount} 张未解锁）`)
      : h('div', { className: 'nce-words-unlockhint nce-muted' },
        Icon('check', 13), '所有卡片都已解锁，接下来按 SRS 节奏复习即可'),

    due > 0
      ? h('div', { className: 'nce-words-reviewbar' },
        h('span', { className: 'nce-words-reviewbar-text' },
          Icon('target', 15), `今天有 ${due} 张记忆卡待复习`),
        h(Btn, { kind: 'primary', size: 'sm', icon: 'play', onClick: () => go('review') }, '开始复习'))
      : h('p', { className: 'nce-words-reviewhint nce-muted' }, '今天没有待复习的记忆卡，学完新词记得回来看看'),

    notice !== null
      ? h('div', { className: 'nce-words-notice' }, Icon('info', 14), h('span', null, notice))
      : null,

    h(TranslateSection, null),

    h('div', { className: 'nce-words-toolbar nce-card' },
      h('label', { className: 'nce-words-search' },
        Icon('search', 14),
        h('input', {
          className: 'nce-words-search-input',
          value: query,
          placeholder: '搜单词 / 释义',
          'aria-label': '搜索记忆卡',
          onChange: (event) => setQuery(event.target.value),
        })),
      h('label', { className: 'nce-words-select-wrap', title: '按首次出现的课筛选' },
        Icon('book', 14),
        h('select', {
          className: 'nce-words-select',
          value: lesson,
          'aria-label': '按来源课筛选',
          onChange: (event) => setLesson(event.target.value),
        },
        h('option', { value: 'all' }, `全部来源课（${words.length} 词）`),
        lessonOptions.map(([id, count]) => h('option', { key: id, value: String(id) }, `第 ${id} 课 · ${count} 词`)))),
      h('span', { className: 'nce-words-result' }, `显示 ${filtered.length} / ${words.length} 张`),
      activeFilters
        ? h(Btn, { kind: 'quiet', size: 'sm', icon: 'close', onClick: resetFilters }, '清空筛选')
        : null),

    h('div', { className: 'nce-words-chips' },
      W_FILTERS.map((item) => h(Chip, {
        key: item.id,
        active: filter === item.id,
        count: chipCounts[item.id],
        onClick: () => setFilter(item.id),
      }, item.label))),

    filtered.length === 0
      ? h(Empty, {
        icon: words.length === 0 ? 'cards' : 'search',
        title: words.length === 0 ? '记忆卡数据还没生成' : '没有匹配的记忆卡',
        text: words.length === 0
          ? '卡片来自内置词库，数据构建完成后这里会自动出现；也可以先去课程页学课文。'
          : '换个关键词或清空筛选条件再试试。',
        action: words.length === 0
          ? h(Btn, { kind: 'primary', icon: 'home', onClick: () => go('home') }, '回课程')
          : activeFilters
            ? h(Btn, { kind: 'soft', icon: 'refresh', onClick: resetFilters }, '清空筛选')
            : null,
      })
      : groups.map((group) => h('div', { key: group.letter, className: 'nce-words-group' },
        h('div', { className: 'nce-words-group-head' },
          h('span', { className: 'nce-words-group-letter' }, group.letter === '#' ? '其他' : group.letter),
          h('span', { className: 'nce-words-group-count' }, `${group.rows.length} 张`)),
        h('div', { className: 'nce-words-list' },
          group.rows.map(({ word, position }) => h(WordsRow, {
            key: W_keyOf(word),
            word,
            card: W_cardOf(progress, W_keyOf(word)),
            starred: W_isStarred(progress, W_keyOf(word)),
            locked: !isWordUnlocked(word, unlockedSet),
            onOpen: () => openStudy(filtered, position),
            onStar: () => toggleStar(word),
          }))))))
}

/** Translation plugin history: auto-synced into sentence cards (opt-out in place). */
function TranslateSection() {
  const { reloadProgress } = useNce()
  const [prefs, setPrefs] = useState(readPrefs)
  const [state, setState] = useState({ loading: true, error: null, data: null })
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)

  const load = useCallback((sync) => {
    setState((previous) => ({ ...previous, loading: true }))
    return api('translate/list', { syncTranslate: sync !== false })
      .then((data) => {
        setState({ loading: false, error: null, data })
        if (sync !== false) reloadProgress()
        return data
      })
      .catch((error) => {
        setState({ loading: false, error, data: null })
        return null
      })
  }, [reloadProgress])

  useEffect(() => {
    load(readPrefs().translateAutoSync)
  }, [load])

  useEffect(() => {
    if (notice === null) return undefined
    const timer = setTimeout(() => setNotice(null), 4200)
    return () => clearTimeout(timer)
  }, [notice])

  const applyPrefs = useCallback((patch) => {
    const next = writePrefs(patch)
    setPrefs(next)
    return next
  }, [])

  const toggleSync = useCallback(() => {
    const next = applyPrefs({ translateAutoSync: !readPrefs().translateAutoSync })
    load(next.translateAutoSync)
    setNotice(next.translateAutoSync ? '已开启自动同步：新翻译会自动加入记忆卡' : '已关闭自动同步：新翻译不再自动加入')
  }, [applyPrefs, load])

  const changeLimit = useCallback((value) => {
    const limit = clamp(Math.round(Number(value) || 0), 0, 20)
    applyPrefs({ translationNewPerDay: limit })
    setNotice(`每天最多学 ${limit} 张翻译新卡`)
  }, [applyPrefs])

  const act = useCallback((payload, message) => {
    if (busy) return
    setBusy(true)
    api('translate/add', payload)
      .then((result) => {
        setNotice(`${message}（${result.added.length} 张）`)
        return reloadProgress()
      })
      .then(() => load(false))
      .catch((error) => setNotice(`操作失败：${errorMessage(error)}`))
      .finally(() => setBusy(false))
  }, [busy, load, reloadProgress])

  const remove = useCallback((id) => {
    if (busy) return
    setBusy(true)
    api('translate/remove', { id })
      .then(() => {
        setNotice('已从记忆卡移除，之后不会再自动加入')
        return reloadProgress()
      })
      .then(() => load(false))
      .catch((error) => setNotice(`操作失败：${errorMessage(error)}`))
      .finally(() => setBusy(false))
  }, [busy, load, reloadProgress])

  const data = state.data
  const records = data !== null && Array.isArray(data.records) ? data.records.slice(0, 6) : []
  const pending = data !== null ? Math.max(0, Number(data.total) - Number(data.addedCount)) : 0
  const autoSync = prefs.translateAutoSync === true
  const listOpen = prefs.translateListOpen === true
  const perDay = prefs.translationNewPerDay

  if (state.loading && data === null) {
    return h('div', { className: 'nce-translate nce-card' },
      h('div', { className: 'nce-translate-head' },
        h('span', { className: 'nce-translate-title' }, Icon('translate', 14), '我的翻译')),
      h('div', { className: 'nce-translate-empty nce-muted' }, '正在读取翻译插件的历史…'))
  }

  return h('div', { className: 'nce-translate nce-card' },
    h('div', { className: 'nce-translate-head' },
      h('span', { className: 'nce-translate-title' }, Icon('translate', 14), '我的翻译'),
      data !== null && data.available
        ? h('span', { className: 'nce-translate-meta nce-muted' },
          `翻译历史 ${Number(data.total) || 0} 条 · 已加入 ${Number(data.addedCount) || 0} 张`)
        : h('span', { className: 'nce-translate-meta nce-muted' }, '未读取到翻译插件历史'),
      h('span', { className: 'nce-translate-controls' },
        h(Chip, {
          active: autoSync,
          onClick: toggleSync,
          title: '自动把新翻译加入记忆卡',
        }, autoSync ? '自动同步 · 开' : '自动同步 · 关'),
        h('label', { className: 'nce-translate-limit', title: '每天最多学几张翻译新卡' },
          '每日新卡',
          h('select', {
            className: 'nce-translate-select',
            value: String(perDay),
            onChange: (event) => changeLimit(event.target.value),
            'aria-label': '每日翻译新卡上限',
          }, [0, 3, 5, 10].map((value) => h('option', { key: value, value: String(value) }, `${value} 张`)))),
        h(Btn, {
          kind: 'quiet',
          size: 'sm',
          icon: listOpen ? 'chevronDown' : 'chevronRight',
          onClick: () => applyPrefs({ translateListOpen: !listOpen }),
        }, listOpen ? '收起' : '展开'))),

    listOpen && data !== null && data.available && data.total > 0
      ? h('div', { className: 'nce-translate-hint nce-muted' },
        autoSync
          ? `新翻译会自动加入记忆卡；每天最多学 ${perDay} 张翻译新卡，到期卡照常优先复习。`
          : '自动同步已关闭：新翻译不会自动加入，可在下面手动加入。')
      : null,

    listOpen
      ? (state.error !== null
        ? h('div', { className: 'nce-translate-empty nce-muted' }, `读取失败：${errorMessage(state.error)}`)
        : data === null || data.available === false
        ? h('div', { className: 'nce-translate-empty nce-muted' },
          '安装并使用「翻译」插件后，这里会自动同步你的翻译记录并把它们加入记忆卡。')
        : data.total === 0
          ? h('div', { className: 'nce-translate-empty nce-muted' }, '翻译历史还是空的，先去翻译几句吧。')
          : h('div', { className: 'nce-translate-list' },
            records.map((record) => h('div', { key: record.id, className: 'nce-translate-row' },
              h('span', { className: 'nce-translate-dir' }, record.direction === 'zh-en' ? '中→英' : '英→中'),
              h('span', { className: 'nce-translate-text' },
                h('span', { className: 'nce-translate-source' }, record.source),
                h('span', { className: 'nce-translate-sep' }, '→'),
                h('span', { className: 'nce-translate-target' }, record.translation)),
              record.added === true
                ? h(Btn, { kind: 'quiet', size: 'sm', disabled: busy, onClick: () => remove(record.id) }, '移除')
                : h(Btn, { kind: 'soft', size: 'sm', disabled: busy, onClick: () => act({ id: record.id }, '已加入记忆卡') }, '加入'))),
            !autoSync && pending > 0
              ? h('div', { className: 'nce-translate-bulk' },
                h(Btn, { kind: 'soft', size: 'sm', icon: 'plus', disabled: busy, onClick: () => act({ recent: Math.min(5, pending) }, '已加入最近翻译') }, '加入最近 5 条'))
              : null))
      : null,

    notice !== null
      ? h('div', { className: 'nce-translate-notice' }, Icon('info', 13), h('span', null, notice))
      : null)
}

function WordsRow(props) {
  const word = props.word
  const key = W_keyOf(word)
  const lessonId = W_lessonOf(word)
  const lessons = Array.isArray(word?.lessons) ? word.lessons : []
  const originTitle = lessons.length > 1 ? `出现在第 ${lessons.join('、')} 课` : (lessonId > 0 ? `第 ${lessonId} 课` : '出处未知')
  return h('div', { className: 'nce-words-item' },
    h('button', { type: 'button', className: 'nce-words-item-main', onClick: props.onOpen },
      h('span', { className: 'nce-words-item-line' },
        h('span', { className: 'nce-words-item-word nce-en' }, word?.word ?? key),
        word?.phonetic !== undefined && word?.phonetic !== '' ? h('span', { className: 'nce-words-item-phonetic nce-mono' }, word.phonetic) : null,
        word?.pos !== undefined && word?.pos !== '' ? h('span', { className: 'nce-words-item-pos' }, word.pos) : null),
      h('span', { className: 'nce-words-item-meaning' }, word?.meaning !== undefined && word?.meaning !== '' ? word.meaning : '—')),
    props.locked
      ? h('span', { className: 'nce-words-item-state is-locked', title: `${lessonId > 0 ? `第 ${lessonId} 课` : '该课'}学完解锁` }, '未解锁')
      : h('span', { className: 'nce-words-item-state' }, W_stateLabel(props.card)),
    h('span', { className: 'nce-words-item-origin', title: originTitle },
      lessonId > 0 ? `第 ${lessonId} 课` : '—',
      lessons.length > 1 ? h('span', { className: 'nce-words-item-origin-more' }, `+${lessons.length - 1}`) : null),
    h(Btn, {
      kind: 'quiet',
      size: 'sm',
      icon: 'star',
      active: props.starred,
      title: props.starred ? '取消收藏' : '收藏',
      onClick: props.onStar,
    }),
    h(Speaker, { text: word?.word ?? '', size: 'sm' }),
    h(Btn, { kind: 'soft', size: 'sm', onClick: props.onOpen }, '学习'))
}

function WordsCardMode(props) {
  const list = props.list
  const word = list[props.index]
  const key = W_keyOf(word)
  const [flipped, setFlipped] = useState(false)
  const starred = W_isStarred(props.progress, key)
  const atStart = props.index <= 0
  const atEnd = props.index >= list.length - 1

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target
      const tag = target !== null && target !== undefined ? String(target.tagName ?? '') : ''
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable === true) return
      if (event.key === 'Escape') {
        props.onClose()
        return
      }
      if (event.key === ' ' || event.code === 'Space' || event.key === 'Spacebar') {
        event.preventDefault()
        setFlipped((value) => !value)
        return
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        props.onMove(-1)
        return
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        props.onMove(1)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [props.onClose, props.onMove])

  return h('div', { className: 'nce-words-study' },
    h('div', { className: 'nce-words-study-head' },
      h(Btn, { kind: 'quiet', size: 'sm', icon: 'arrowLeft', onClick: props.onClose }, '返回词库'),
      h('span', { className: 'nce-words-study-title' }, '单卡学习'),
      h('span', { className: 'nce-words-study-count' }, `${props.index + 1} / ${list.length}`)),

    h('div', { className: 'nce-words-cardwrap' },
      h('div', {
        className: cx('nce-words-card', 'nce-card', flipped && 'is-flipped'),
        role: 'button',
        tabIndex: 0,
        'aria-label': flipped ? '显示单词正面' : '显示释义',
        onClick: () => setFlipped((value) => !value),
      },
      flipped
        ? h('div', { className: 'nce-words-card-face nce-words-card-back' },
          h('div', { className: 'nce-words-card-word-sm nce-en' }, word?.word ?? key),
          h('div', { className: 'nce-words-card-line' },
            word?.pos !== undefined && word?.pos !== '' ? h('span', { className: 'nce-words-card-pos' }, word.pos) : null,
            h('span', { className: 'nce-words-card-meaning' }, word?.meaning !== undefined && word?.meaning !== '' ? word.meaning : '—')),
          word?.example !== undefined && word?.example !== '' ? h('div', { className: 'nce-words-card-example' },
            h('span', { className: 'nce-en' }, word.example),
            h(Speaker, { text: word.example, size: 'sm' })) : null,
          h('div', { className: 'nce-words-card-origin' }, W_lessonText(word)),
          h('div', { className: 'nce-words-card-hint' }, '点击卡片或按 空格 回到正面'))
        : h('div', { className: 'nce-words-card-face nce-words-card-front' },
          h('div', { className: 'nce-words-card-word nce-en' }, word?.word ?? key),
          word?.phonetic !== undefined && word?.phonetic !== '' ? h('div', { className: 'nce-words-card-phonetic nce-mono' }, word.phonetic) : null,
          h('div', { className: 'nce-words-card-speak' }, h(Speaker, { text: word?.word ?? '', size: 'md' })),
          h('div', { className: 'nce-words-card-hint' }, '点击卡片或按 空格 显示释义'))),

      h('div', { className: 'nce-words-cardbar' },
        h(Btn, { kind: 'ghost', icon: 'chevronLeft', onClick: () => props.onMove(-1), disabled: atStart }, '上一张'),
        h(Btn, { kind: 'primary', icon: 'flip', size: 'md', onClick: () => setFlipped((value) => !value) },
          flipped ? '回到正面' : '显示释义'),
        h(Btn, { kind: 'ghost', onClick: () => props.onMove(1), disabled: atEnd }, '下一张')),

      h('div', { className: 'nce-words-cardactions' },
        h(Btn, { kind: 'soft', icon: 'star', active: starred, onClick: () => props.onStar(word) },
          starred ? '已收藏' : '收藏'),
        h(Btn, { kind: 'soft', icon: 'refresh', onClick: () => props.onGo('review') },
          props.due > 0 ? `去复习 · ${props.due} 张` : '去复习'),
        h('span', { className: 'nce-words-cardkbd' }, '空格 翻面 · ← → 切换 · Esc 返回'))))
}

/** "出处 · 第 1 课"（多课出现时补一句提示）。 */
function W_lessonText(word) {
  const lessonId = W_lessonOf(word)
  const lessons = Array.isArray(word?.lessons) ? word.lessons : []
  if (lessonId <= 0) return '出处 · 未知'
  if (lessons.length > 1) return `出处 · 第 ${lessonId} 课（共 ${lessons.length} 课出现）`
  return `出处 · 第 ${lessonId} 课`
}

addCss(`
  .nce-words-meta { margin: 2px 0 10px; font-size: 11.5px; line-height: 1.6; }
  .nce-words-reviewbar {
    display: flex; align-items: center; gap: 10px; margin: 0 0 12px; padding: 8px 12px;
    border-radius: 10px;
    border: 1px solid color-mix(in srgb, var(--dsw-alias-brand-primary, #4c8dff) 26%, transparent);
    background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4c8dff) 7%, transparent);
  }
  .nce-words-reviewbar-text {
    display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0;
    font-size: 12.5px; font-weight: 550;
  }
  .nce-words-reviewbar-text .nce-icon { color: var(--dsw-alias-brand-primary, #4c8dff); }
  .nce-words-reviewhint { margin: 0 0 12px; font-size: 11.5px; }
  .nce-words-notice {
    display: flex; align-items: center; gap: 7px; margin: 0 0 12px; padding: 8px 12px;
    border-radius: 8px; font-size: 12px;
    color: var(--dsw-alias-state-error-primary, #d9534f);
    background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #d9534f) 8%, transparent);
  }
  .nce-words-toolbar {
    display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 10px 14px;
  }
  .nce-words-search {
    display: inline-flex; align-items: center; gap: 6px; flex: 1 1 170px; max-width: 280px;
    height: 30px; padding: 0 10px; border-radius: 8px;
    border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.26));
    color: var(--dsw-alias-label-secondary, #8a8f98);
    background: var(--dsw-alias-bg-base, #fff);
  }
  .nce-words-search-input {
    flex: 1; min-width: 0; border: 0; outline: 0; background: transparent;
    color: var(--dsw-alias-label-primary, #1f2328); font: inherit; font-size: 12px;
  }
  .nce-words-search-input::placeholder { color: var(--dsw-alias-label-secondary, #8a8f98); opacity: .75; }
  .nce-words-select-wrap {
    display: inline-flex; align-items: center; gap: 6px; flex: 0 1 210px;
    height: 30px; padding: 0 10px; border-radius: 8px;
    border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.26));
    color: var(--dsw-alias-label-secondary, #8a8f98);
    background: var(--dsw-alias-bg-base, #fff);
  }
  .nce-words-select {
    flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; cursor: pointer;
    color: var(--dsw-alias-label-primary, #1f2328); font: inherit; font-size: 12px;
  }
  .nce-words-result { margin-left: auto; font-size: 11.5px; color: var(--dsw-alias-label-secondary, #8a8f98); white-space: nowrap; }
  .nce-words-chips { display: flex; gap: 7px; flex-wrap: wrap; margin: 12px 0 14px; }

  .nce-words-group { margin-top: 12px; }
  .nce-words-group-head { display: flex; align-items: baseline; gap: 8px; padding: 0 2px 6px; }
  .nce-words-group-letter {
    min-width: 20px; font-size: 12px; font-weight: 700; letter-spacing: .05em;
    color: var(--dsw-alias-brand-primary, #4c8dff);
  }
  .nce-words-group-count { font-size: 11px; color: var(--dsw-alias-label-secondary, #8a8f98); }
  .nce-words-list {
    border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.18));
    border-radius: 12px; overflow: hidden;
    background: var(--dsw-alias-bg-layer-1, rgba(127,127,127,.03));
  }
  .nce-words-item {
    display: flex; align-items: center; gap: 8px; padding: 8px 12px;
    border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.12));
  }
  .nce-words-item:last-child { border-bottom: 0; }
  .nce-words-item:hover { background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.06)); }
  .nce-words-item-main {
    flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px;
    padding: 0; border: 0; background: transparent; color: inherit; font: inherit;
    text-align: left; cursor: pointer;
  }
  .nce-words-item-main:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #4c8dff); outline-offset: 2px; border-radius: 5px; }
  .nce-words-item-line { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
  .nce-words-item-word { font-size: 13.5px; font-weight: 600; letter-spacing: .005em; }
  .nce-words-item-phonetic { font-size: 11.5px; color: var(--dsw-alias-label-secondary, #8a8f98); }
  .nce-words-item-pos {
    flex: none; padding: 0 5px; border-radius: 4px; font-size: 10px; line-height: 16px;
    color: var(--dsw-alias-brand-primary, #4c8dff);
    background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4c8dff) 10%, transparent);
  }
  .nce-words-item-meaning {
    font-size: 11.5px; color: var(--dsw-alias-label-secondary, #8a8f98);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .nce-words-item-state {
    flex: none; width: 58px; text-align: right; font-size: 10.5px;
    color: var(--dsw-alias-label-secondary, #8a8f98); white-space: nowrap;
  }
  .nce-words-item-origin {
    flex: none; display: inline-flex; align-items: center; gap: 3px;
    height: 18px; padding: 0 7px; border-radius: 999px;
    font-size: 10.5px; color: var(--dsw-alias-label-secondary, #8a8f98);
    background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.12)); white-space: nowrap;
  }
  .nce-words-item-origin-more { opacity: .7; }

  .nce-words-study { max-width: 800px; margin: 0 auto; }
  .nce-words-study-head { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
  .nce-words-study-title { font-size: 13px; font-weight: 650; }
  .nce-words-study-count {
    margin-left: auto; font-size: 11.5px; font-variant-numeric: tabular-nums;
    color: var(--dsw-alias-label-secondary, #8a8f98);
  }
  .nce-words-cardwrap { display: flex; flex-direction: column; gap: 12px; }
  .nce-words-card {
    min-height: 320px; padding: 30px 24px; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    background:
      radial-gradient(110% 150% at 50% 0%, color-mix(in srgb, var(--dsw-alias-brand-primary, #4c8dff) 7%, transparent) 0%, transparent 62%),
      var(--dsw-alias-bg-layer-1, rgba(127,127,127,.04));
    transition: border-color .16s ease;
  }
  .nce-words-card:hover { border-color: var(--dsw-alias-border-l2, rgba(127,127,127,.42)); }
  .nce-words-card.is-flipped { border-color: color-mix(in srgb, var(--dsw-alias-brand-primary, #4c8dff) 34%, transparent); }
  .nce-words-card-face {
    display: flex; flex-direction: column; align-items: center; gap: 9px;
    width: 100%; text-align: center;
  }
  .nce-words-card-word { font-size: 44px; font-weight: 680; line-height: 1.1; letter-spacing: .005em; }
  .nce-words-card-word-sm { font-size: 20px; font-weight: 650; }
  .nce-words-card-phonetic { font-size: 17px; color: var(--dsw-alias-label-secondary, #8a8f98); }
  .nce-words-card-speak { margin-top: 2px; }
  .nce-words-card-line { display: flex; align-items: baseline; justify-content: center; gap: 8px; flex-wrap: wrap; }
  .nce-words-card-pos {
    padding: 1px 7px; border-radius: 999px; font-size: 11px;
    color: var(--dsw-alias-brand-primary, #4c8dff);
    background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4c8dff) 11%, transparent);
  }
  .nce-words-card-meaning { font-size: 21px; font-weight: 620; }
  .nce-words-card-example {
    display: flex; align-items: center; justify-content: center; gap: 6px; flex-wrap: wrap;
    max-width: 560px; margin-top: 2px; padding: 9px 14px; border-radius: 9px;
    font-size: 13px; line-height: 1.7; color: var(--dsw-alias-label-secondary, #8a8f98);
    background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.08));
  }
  .nce-words-card-origin { font-size: 11.5px; color: var(--dsw-alias-label-secondary, #8a8f98); }
  .nce-words-card-hint { margin-top: 6px; font-size: 11px; color: var(--dsw-alias-label-secondary, #8a8f98); opacity: .85; }
  .nce-words-cardbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .nce-words-cardactions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .nce-words-cardkbd { margin-left: auto; font-size: 10.5px; color: var(--dsw-alias-label-secondary, #8a8f98); opacity: .85; }

  @media (max-width: 860px) {
    .nce-words-item-state { display: none; }
  .nce-translate {
    display: flex; flex-direction: column; gap: 8px;
    margin: 12px 0; padding: 12px 14px;
  }
  .nce-translate-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .nce-translate-title {
    display: inline-flex; align-items: center; gap: 6px;
    font-size: 12.5px; font-weight: 600;
  }
  .nce-translate-meta { font-size: 11px; }
  .nce-translate-controls {
    display: inline-flex; align-items: center; gap: 8px; margin-left: auto;
  }
  .nce-translate-limit {
    display: inline-flex; align-items: center; gap: 5px;
    font-size: 11px; color: var(--dsw-alias-label-secondary, #8a8f98);
  }
  .nce-translate-select {
    font: inherit; font-size: 11px; padding: 2px 4px;
    border-radius: 6px; border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.24));
    background: transparent; color: var(--dsw-alias-label-primary, inherit);
  }
  .nce-translate-hint { font-size: 11px; line-height: 1.55; }
  .nce-translate-bulk { display: flex; justify-content: flex-end; padding-top: 2px; }
  .nce-translate-empty { font-size: 11.5px; line-height: 1.6; }
  .nce-translate-list { display: flex; flex-direction: column; }
  .nce-translate-row {
    display: flex; align-items: center; gap: 10px;
    padding: 6px 0; border-top: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.14));
  }
  .nce-translate-row:first-child { border-top: 0; }
  .nce-translate-dir {
    flex: none; font-size: 10px; padding: 1px 5px; border-radius: 4px;
    color: var(--dsw-alias-label-secondary, #8a8f98);
    background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.08));
  }
  .nce-translate-text {
    flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 6px;
    font-size: 12px; overflow: hidden;
  }
  .nce-translate-source, .nce-translate-target {
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .nce-translate-source { max-width: 46%; }
  .nce-translate-target { color: var(--dsw-alias-label-secondary, #8a8f98); }
  .nce-translate-sep { flex: none; color: var(--dsw-alias-label-tertiary, #a0a6ae); }
  .nce-translate-notice {
    display: flex; align-items: center; gap: 5px;
    font-size: 11px; color: var(--dsw-alias-label-secondary, #8a8f98);
  }
  .nce-words-item-state.is-locked { color: var(--dsw-alias-label-tertiary, #a0a6ae); }
  .nce-words-unlockhint {
    display: flex; align-items: center; gap: 6px;
    margin: 6px 0 10px; font-size: 11.5px; line-height: 1.5;
    color: var(--dsw-alias-label-secondary, #8a8f98);
  }
    .nce-words-item-origin { display: none; }
    .nce-words-card-word { font-size: 34px; }
  }
`)
