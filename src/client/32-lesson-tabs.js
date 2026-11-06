// Layer: 32 lesson-tabs — depends on: 00-platform, 01-domain (`LessonArray`), 03-api, 04-tts,
// 05-data, 06-store (`useNce`), 07-ui (Icon/Btn/Speaker/Badge/Empty/...).
// The single-page lesson sections (视频 / 课文 / 单词 / 语法) and their small helpers.
// The page shell (header, anchor bar, section layout, exercise area) is 33-lesson-page.js.

// ---------------------------------------------------------------------------
// Constants and small helpers shared by the page
// ---------------------------------------------------------------------------

/** Book 1 always has 144 lessons; the index only refines this when loaded. */
const LESSON_COUNT_FALLBACK = 144

/** "课本 P5–6" from either {textbook:[5,6]} or [5,6]. */
function LessonPageLabel(lesson) {
  const pages = lesson === null || lesson === undefined ? undefined : lesson.pages
  let list = []
  if (Array.isArray(pages)) list = pages
  else if (pages !== null && typeof pages === 'object' && Array.isArray(pages.textbook)) list = pages.textbook
  const numbers = list.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0)
  if (numbers.length === 0) return ''
  const first = numbers[0]
  const last = numbers[numbers.length - 1]
  return first === last ? `课本 P${first}` : `课本 P${first}–${last}`
}

/** True when an SRS card is already scheduled and due now. */
function LessonCardDue(card) {
  if (card === null || card === undefined || card.state === 0) return false
  const at = Date.parse(card.due)
  return Number.isFinite(at) && at <= Date.now()
}

/** Speak the English head of a note title such as "handbag n.". */
function LessonNoteSpeech(title) {
  return String(title ?? '')
    .replace(/\s+(?:n|v|vt|vi|adj|adv|prep|pron|conj|art|num|int)\.\s*$/i, '')
    .trim()
}

/**
 * The lesson used to be split into tabs; those tab ids are still stored in the
 * saved nav state (and used by deep links such as 计划 → 去练习卷). Map them onto
 * the anchor ids of the merged single-page lesson so old links keep working.
 */
function LessonAnchorOf(value) {
  const raw = String(value ?? '').trim()
  if (raw === '') return ''
  const anchors = {
    video: 'video',
    preview: 'text',
    text: 'text',
    words: 'words',
    grammar: 'grammar',
    homework: 'exercise',
    exercise: 'exercise',
    recall: '',
    review: '',
  }
  return Object.prototype.hasOwnProperty.call(anchors, raw) ? anchors[raw] : ''
}

function formatClock(seconds) {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
  const rest = total % 3600
  const mm = String(Math.floor(rest / 60)).padStart(2, '0')
  const ss = String(rest % 60).padStart(2, '0')
  return total >= 3600 ? `${Math.floor(total / 3600)}:${mm}:${ss}` : `${Math.floor(rest / 60)}:${ss}`
}

// ---------------------------------------------------------------------------
// Section: 视频 (saved bilibili / YouTube link with an inline player)
// ---------------------------------------------------------------------------

function LessonVideoLinks(props) {
  const id = Number(props.id)
  const bili = `https://search.bilibili.com/all?keyword=${encodeURIComponent(`新概念英语第一册 第${id}课`)}`
  const youtube = `https://www.youtube.com/results?search_query=New+Concept+English+1+Lesson+${id}`
  return h('div', { className: 'nce-lesson-video-links' },
    h('a', {
      className: 'nce-btn nce-btn-ghost nce-btn-md nce-lesson-link',
      href: bili,
      target: '_blank',
      rel: 'noreferrer',
    }, Icon('search', 15), '在 B 站搜本课'),
    h('a', {
      className: 'nce-btn nce-btn-ghost nce-btn-md nce-lesson-link',
      href: youtube,
      target: '_blank',
      rel: 'noreferrer',
    }, Icon('search', 15), 'YouTube 搜本课'))
}

function LessonVideoSection(props) {
  const id = Number(props.id)
  const lesson = props.lesson
  const { progress, saveVideo, reloadProgress } = useNce()
  // The provider progress snapshot is authoritative once loaded (it survives
  // clearing); the cached lesson object can hold a stale saved URL.
  const initial = progress !== null
    ? String(progress.videos?.[String(id)] ?? '').trim()
    : String(lesson?.video ?? '').trim()
  const [saved, setSaved] = useState(initial)
  const [draft, setDraft] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(false)
  const [page, setPage] = useState(0)
  const episodes = bilibiliEpisodes(id)
  const activePage = episodes.some((item) => item.page === page) ? page : (episodes[0]?.page ?? 0)
  const savedEmbed = saved === '' ? null : videoEmbedUrl(saved)
  const embed = savedEmbed ?? (activePage > 0 ? bilibiliEmbedUrl(activePage) : null)

  useEffect(() => {
    setPage(0)
    setEditing(false)
  }, [id])

  const persist = (next) => {
    setBusy(true)
    setError(null)
    saveVideo(id, next)
      .then((video) => {
        const value = typeof video === 'string' ? video : next
        setSaved(value)
        setDraft(value)
        reloadProgress()
      })
      .catch((failure) => setError(failure))
      .finally(() => setBusy(false))
  }

  const saveDraft = () => {
    const next = draft.trim()
    if (next !== '' && !/^https?:\/\//i.test(next)) {
      setError(new Error('只支持 http(s) 链接，请检查是否以 http:// 或 https:// 开头'))
      return
    }
    if (next === saved) {
      setEditing(false)
      return
    }
    persist(next)
    setEditing(false)
  }

  const player = embed === null
    ? h('div', { className: 'nce-card' },
      h(Empty, {
        icon: 'video',
        title: '这一课还没有视频',
        text: '内置 B 站合集里没有匹配到这一课的视频，可以点下面的按钮去 B 站搜索。',
        action: h(LessonVideoLinks, { id }),
      }))
    : h('div', null,
      h('div', { className: 'nce-lesson-video-frame-wrap' },
        h('iframe', {
          className: 'nce-lesson-video-frame',
          src: embed,
          title: `第 ${id} 课视频`,
          allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen',
          allowFullScreen: true,
          frameBorder: '0',
          referrerPolicy: 'no-referrer-when-downgrade',
        })),
      h('div', { className: 'nce-lesson-video-stage-foot' },
        savedEmbed !== null
          ? h(Fragment, null,
            h(Badge, { tone: 'success' }, '自定义链接'),
            h('button', {
              type: 'button',
              className: 'nce-lesson-video-open-link',
              disabled: busy,
              onClick: () => persist(''),
            }, Icon('refresh', 13), '恢复默认 B 站视频'))
          : h(Fragment, null,
            h('a', {
              className: 'nce-lesson-video-open-link',
              href: bilibiliPageUrl(activePage),
              target: '_blank',
              rel: 'noreferrer',
            }, Icon('external', 13), '在 B 站打开'),
            h('span', { className: 'nce-muted' },
              `${BILIBILI_SOURCE.owner} · 合集共 ${BILIBILI_SOURCE.parts} P`))))

  const stage = h('div', { className: 'nce-card nce-lesson-video' },
    episodes.length > 1
      ? h('div', { className: 'nce-lesson-video-parts' }, episodes.map((item) => h('button', {
        key: item.page,
        type: 'button',
        className: cx('nce-lesson-video-part', item.page === activePage && 'is-active'),
        onClick: () => setPage(item.page),
      },
      h('span', null, item.label),
      h('span', { className: 'nce-lesson-video-part-dur' }, formatClock(item.seconds)))))
      : null,
    player)

  const unsupported = saved !== '' && savedEmbed === null
    ? h('div', { className: 'nce-card nce-lesson-video-open' },
      h('div', { className: 'nce-lesson-video-open-main' },
        h('div', { className: 'nce-lesson-video-open-title' }, '保存的链接暂不支持内嵌播放'),
        h('div', { className: 'nce-lesson-video-open-url nce-mono' }, saved),
        h('p', { className: 'nce-lesson-hint' }, '当前播放的是内置 B 站视频；这个链接可以点右侧按钮打开原网页。')),
      h('a', {
        className: 'nce-btn nce-btn-primary nce-btn-md nce-lesson-link',
        href: saved,
        target: '_blank',
        rel: 'noreferrer',
      }, Icon('external', 15), '打开原链接'),
      h(Btn, { kind: 'ghost', icon: 'trash', disabled: busy, onClick: () => persist('') }, '清除'))
    : null

  const form = editing
    ? h('div', { className: 'nce-lesson-video-form' },
      h('label', { className: 'nce-lesson-field' },
        h('span', { className: 'nce-lesson-field-label' }, '自定义视频链接'),
        h('input', {
          className: 'nce-lesson-input',
          value: draft,
          placeholder: '粘贴 B 站 / YouTube 链接，例如 https://www.bilibili.com/video/BV…?p=3',
          onChange: (event) => setDraft(event.target.value),
          onKeyDown: (event) => {
            if (event.key === 'Enter') saveDraft()
          },
        })),
      h('div', { className: 'nce-lesson-video-actions' },
        h(Btn, { kind: 'primary', icon: 'check', disabled: busy || draft.trim() === saved, onClick: saveDraft }, '保存链接'),
        h(Btn, { kind: 'ghost', disabled: busy, onClick: () => {
          setEditing(false)
          setDraft(saved)
        } }, '取消'),
        saved !== '' ? h(Btn, { kind: 'ghost', icon: 'trash', disabled: busy, onClick: () => persist('') }, '清除') : null),
      h('p', { className: 'nce-lesson-hint' }, '默认播放内置的 B 站合集；这里可以把这一课换成自己的 B 站 / YouTube 链接，链接只保存在本地进度里。'))
    : h('button', {
      type: 'button',
      className: 'nce-lesson-video-custom-toggle',
      onClick: () => {
        setDraft(saved)
        setEditing(true)
      },
    }, Icon('plus', 13), saved === '' ? '改用自定义链接' : '修改自定义链接')

  return h('div', null,
    stage,
    unsupported,
    form,
    error !== null ? h(ErrorBox, { error, title: '视频链接没有保存成功' }) : null)
}

// ---------------------------------------------------------------------------
// Section: 课文 (question, dialogue, collapsible reference translation)
// ---------------------------------------------------------------------------

function LessonDialogueLine(props) {
  const line = props.line ?? {}
  const speaker = String(line.speaker ?? '').trim()
  const en = String(line.en ?? '').trim()
  const zh = String(line.zh ?? '').trim()
  const speak = () => {
    if (en !== '') playText(en)
  }
  return h('div', {
    className: cx('nce-lesson-dialogue-row', en !== '' && 'is-clickable'),
    role: en !== '' ? 'button' : undefined,
    tabIndex: en !== '' ? 0 : undefined,
    title: en !== '' ? '点击整句朗读' : undefined,
    onClick: en !== '' ? speak : undefined,
    onKeyDown: en !== ''
      ? (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          speak()
        }
      }
      : undefined,
  },
  h('span', { className: 'nce-lesson-line-no' }, String(props.index + 1).padStart(2, '0')),
  props.showSpeakers ? h('span', { className: 'nce-lesson-line-speaker' }, speaker) : null,
  h('div', { className: 'nce-lesson-dialogue-main' },
    en !== '' ? h('div', { className: 'nce-lesson-dialogue-en nce-en' }, en) : null,
    zh !== '' ? h('div', { className: 'nce-lesson-dialogue-zh' }, zh) : null),
  en !== ''
    ? h('span', {
      className: 'nce-lesson-dialogue-sound',
      onClick: (event) => event.stopPropagation(),
    }, h(Speaker, { text: en }))
    : null)
}

function LessonTextSection(props) {
  const lesson = props.lesson
  const question = lesson.question !== null && typeof lesson.question === 'object' ? lesson.question : {}
  const dialogue = LessonArray(lesson.dialogue)
  const translation = LessonArray(lesson.translation)
  const questionEn = String(question.en ?? '').trim()
  const questionZh = String(question.zh ?? '').trim()
  const showSpeakers = dialogue.some((line) => String(line?.speaker ?? '').trim() !== '')
  const missingZh = dialogue.filter((line) => String(line?.zh ?? '').trim() === '').length
  // Lessons whose dialogue has no Chinese yet auto-open the reference translation.
  const [showTranslation, setShowTranslation] = useState(() => translation.length > 0 && missingZh * 2 > dialogue.length)

  if (questionEn === '' && questionZh === '' && dialogue.length === 0 && translation.length === 0) {
    return h(Empty, {
      icon: 'eye',
      title: '这一课没有课文内容',
      text: '数据里没找到课文问题、对话和参考译文；可以先看右边的单词或下面的语法。',
    })
  }

  return h('div', { className: 'nce-lesson-text' },
    questionEn !== '' || questionZh !== ''
      ? h('section', { className: 'nce-lesson-question nce-card' },
        h('div', { className: 'nce-lesson-question-head' },
          h('span', { className: 'nce-lesson-eyebrow' }, 'Question'),
          questionEn !== '' ? h(Speaker, { text: questionEn }) : null),
        questionEn !== '' ? h('p', { className: 'nce-lesson-question-en nce-en' }, questionEn) : null,
        questionZh !== '' ? h('p', { className: 'nce-lesson-question-zh' }, questionZh) : null)
      : null,
    dialogue.length > 0
      ? h('div', null,
        translation.length > 0
          ? h('div', { className: 'nce-lesson-text-actions' },
            h(Btn, {
              kind: 'quiet',
              size: 'sm',
              icon: 'eye',
              active: showTranslation,
              onClick: () => setShowTranslation((value) => !value),
            }, showTranslation ? '隐藏参考译文' : '显示参考译文'))
          : null,
        h('div', { className: 'nce-lesson-dialogue nce-card' },
          dialogue.map((line, index) => h(LessonDialogueLine, {
            key: index,
            line,
            index,
            showSpeakers,
          }))))
      : null,
    showTranslation && translation.length > 0
      ? h('div', { className: 'nce-lesson-trans nce-card' },
        h('div', { className: 'nce-lesson-trans-title' }, '参考译文'),
        translation.map((line, index) => h('div', { key: index, className: 'nce-lesson-trans-row' },
          h('span', { className: 'nce-lesson-line-no' }, String(index + 1).padStart(2, '0')),
          String(line?.speaker ?? '').trim() !== '' ? h('span', { className: 'nce-lesson-line-speaker' }, line.speaker) : null,
          h('span', { className: 'nce-lesson-trans-zh' }, String(line?.zh ?? '')))))
      : null)
}

// ---------------------------------------------------------------------------
// Section: 单词 (compact vocab list with TTS and star/review shortcuts)
// ---------------------------------------------------------------------------

function LessonWordsSection(props) {
  const lesson = props.lesson
  const { progress, starWord } = useNce()
  const vocab = LessonArray(lesson.vocab)
  const [pendingKey, setPendingKey] = useState('')
  const [error, setError] = useState(null)

  if (vocab.length === 0) {
    return h(Empty, {
      icon: 'cards',
      title: '这一课没有生词表',
      text: '数据里没有 vocab 字段；可以在记忆卡页搜索单词，或先看旁边的课文。',
    })
  }

  const toggleStar = (key, starred) => {
    setPendingKey(key)
    setError(null)
    starWord(key, starred)
      .catch((failure) => setError(failure))
      .finally(() => setPendingKey(''))
  }

  return h('div', null,
    h('div', { className: 'nce-lesson-vocab-list nce-card' },
      vocab.map((item, index) => {
        const word = String(item?.word ?? '').trim()
        const key = normWord(word)
        const phonetic = String(item?.phonetic ?? '').trim()
        const pos = String(item?.pos ?? '').trim()
        const meaning = String(item?.meaning ?? '').trim()
        const example = String(item?.example ?? '').trim()
        const card = key === '' ? undefined : progress?.words?.[key]?.srs
        const starred = key !== '' && progress?.words?.[key]?.starred === true
        return h('div', { key: `${key}-${index}`, className: 'nce-lesson-vocab-row' },
          h('div', { className: 'nce-lesson-vocab-main' },
            h('div', { className: 'nce-lesson-vocab-top' },
              h('span', { className: 'nce-lesson-vocab-word nce-en' }, word),
              phonetic !== '' ? h('span', { className: 'nce-lesson-vocab-phonetic nce-mono' }, phonetic) : null,
              pos !== '' ? h('span', { className: 'nce-lesson-vocab-pos' }, pos) : null,
              LessonCardDue(card) ? h(Badge, { tone: 'warn' }, '待复习') : null),
            meaning !== '' ? h('div', { className: 'nce-lesson-vocab-meaning' }, meaning) : null,
            example !== '' ? h('div', { className: 'nce-lesson-vocab-example nce-en' }, example) : null),
          h('div', { className: 'nce-lesson-vocab-actions' },
            word !== '' ? h(Speaker, { text: word }) : null,
            key !== ''
              ? h(Btn, {
                kind: 'quiet',
                size: 'sm',
                icon: 'star',
                title: starred ? '取消星标' : '加入记忆卡收藏',
                active: starred,
                disabled: pendingKey === key,
                onClick: () => toggleStar(key, !starred),
              })
              : null))
      })),
    error !== null ? h(ErrorBox, { error, title: '单词收藏没有保存成功' }) : null)
}

// ---------------------------------------------------------------------------
// Section: 语法 (numbered text notes + classroom note blocks by page)
// ---------------------------------------------------------------------------

function LessonNoteBlock(props) {
  const block = props.block ?? {}
  const type = String(block.type ?? '')
  const title = String(block.title ?? '').trim()
  const phonetic = String(block.phonetic ?? '').trim()
  const lines = LessonArray(block.lines).map((line) => String(line ?? ''))
  const lineList = lines.length > 0
    ? h('ul', { className: 'nce-lesson-noteblock-lines' }, lines.map((line, index) => h('li', { key: index }, line)))
    : null

  if (type === 'vocab') {
    const spoken = LessonNoteSpeech(title)
    return h('div', { className: 'nce-lesson-noteblock is-vocab' },
      h('div', { className: 'nce-lesson-noteblock-head' },
        h('span', { className: 'nce-lesson-noteblock-type' }, '生词'),
        title !== '' ? h('span', { className: 'nce-lesson-noteblock-title' }, title) : null,
        phonetic !== '' ? h('span', { className: 'nce-lesson-noteblock-phonetic nce-mono' }, phonetic) : null,
        spoken !== '' ? h(Speaker, { text: spoken }) : null),
      lineList)
  }

  if (type === 'grammar') {
    return h('div', { className: 'nce-lesson-noteblock is-grammar' },
      h('div', { className: 'nce-lesson-noteblock-head' },
        h('span', { className: 'nce-lesson-noteblock-type' }, '语法'),
        title !== '' ? h('span', { className: 'nce-lesson-noteblock-title' }, title) : null),
      lineList)
  }

  const labels = { practice: '练习', homework: '作业' }
  return h('details', { className: 'nce-lesson-notecollapse' },
    h('summary', null,
      h('span', { className: 'nce-lesson-noteblock-type' }, labels[type] ?? '笔记'),
      title !== '' ? h('span', { className: 'nce-lesson-noteblock-title' }, title) : null,
      title === '' && lines.length > 0 ? h('span', { className: 'nce-lesson-noteblock-hint' }, `${lines.length} 条`) : null,
      Icon('chevronDown', 13)),
    lineList)
}

function LessonGrammarSection(props) {
  const lesson = props.lesson
  const textNotes = LessonArray(lesson.textNotes)
  const notes = LessonArray(lesson.notes)

  if (textNotes.length === 0 && notes.length === 0) {
    return h(Empty, {
      icon: 'pen',
      title: '这一课还没有语法笔记',
      text: '可以先看上面的课文，或者直接做下面的练习卷。',
    })
  }

  return h('div', { className: 'nce-lesson-grammar' },
    textNotes.length > 0
      ? h('div', { className: 'nce-lesson-notepage' },
        h('div', { className: 'nce-lesson-notepage-head' },
          h('span', { className: 'nce-lesson-notepage-title' }, `课文注释 · ${textNotes.length} 条`)),
        h('ol', { className: 'nce-lesson-textnotes nce-card' },
        textNotes.map((note, index) => {
          const en = String(note?.en ?? '').trim()
          const zh = String(note?.zh ?? '').trim()
          return h('li', { key: index, className: 'nce-lesson-textnote' },
            h('span', { className: 'nce-lesson-textnote-num' }, String(note?.num ?? index + 1)),
            h('div', { className: 'nce-lesson-textnote-body' },
              en !== '' ? h('div', { className: 'nce-lesson-textnote-en' },
                h('span', { className: 'nce-en' }, en),
                h(Speaker, { text: en })) : null,
              zh !== '' ? h('p', { className: 'nce-lesson-textnote-zh' }, zh) : null))
        })))
      : null,
    notes.map((note, index) => {
      const blocks = LessonArray(note?.blocks)
      const tags = LessonArray(note?.tags).map((tag) => String(tag ?? '')).filter((tag) => tag !== '')
      const page = Number(note?.page)
      if (blocks.length === 0) return null
      return h('div', { key: index, className: 'nce-lesson-notepage' },
        h('div', { className: 'nce-lesson-notepage-head' },
          h('span', { className: 'nce-lesson-notepage-title' },
            `课堂笔记 · 第 ${Number.isFinite(page) && page > 0 ? page : index + 1} 页`),
          tags.length > 0 ? h('span', { className: 'nce-lesson-notepage-tags' }, tags.join(' · ')) : null),
        h('div', { className: 'nce-lesson-noteblocks nce-card' },
          blocks.map((block, blockIndex) => h(LessonNoteBlock, { key: blockIndex, block }))))
    }))
}
