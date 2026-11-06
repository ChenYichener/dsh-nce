// Layer: 07 design system — depends on: 00-platform (h/cx/utils), 02-persistence (prefs), 04-tts (speech).
// The small component kit every view builds on: icons, buttons, chips, sections, modal, speaker, voice menu.

// ---- design system --------------------------------------------------------

const ICONS = {
  book: [
    ['path', { d: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20' }],
    ['path', { d: 'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z' }],
  ],
  cards: [
    ['rect', { x: 3, y: 6, width: 13, height: 15, rx: 2 }],
    ['path', { d: 'M8 3h10a3 3 0 0 1 3 3v11' }],
  ],
  lock: [
    ['rect', { x: 4, y: 10, width: 16, height: 11, rx: 2 }],
    ['path', { d: 'M8 10V7a4 4 0 0 1 8 0v3' }],
  ],
  sound: [
    ['path', { d: 'M11 5 6 9H2v6h4l5 4V5z' }],
    ['path', { d: 'M15.5 8.5a5 5 0 0 1 0 7' }],
    ['path', { d: 'M18.5 5.5a9 9 0 0 1 0 13' }],
  ],
  play: [['path', { d: 'm7 4 13 8-13 8V4z' }]],
  star: [['path', { d: 'm12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3z' }]],
  check: [['path', { d: 'm20 6-11 11-5-5' }]],
  refresh: [
    ['path', { d: 'M21 12a9 9 0 1 1-2.6-6.4' }],
    ['path', { d: 'M21 3v6h-6' }],
  ],
  chevronRight: [['path', { d: 'm9 18 6-6-6-6' }]],
  chevronLeft: [['path', { d: 'm15 18-6-6 6-6' }]],
  chevronDown: [['path', { d: 'm6 9 6 6 6-6' }]],
  search: [
    ['circle', { cx: 11, cy: 11, r: 7 }],
    ['path', { d: 'm20 20-3.2-3.2' }],
  ],
  close: [['path', { d: 'M18 6 6 18M6 6l12 12' }]],
  download: [
    ['path', { d: 'M12 3v12' }],
    ['path', { d: 'm7 11 5 5 5-5' }],
    ['path', { d: 'M5 21h14' }],
  ],
  printer: [
    ['path', { d: 'M7 8V3h10v5' }],
    ['rect', { x: 4, y: 8, width: 16, height: 8, rx: 2 }],
    ['path', { d: 'M7 16h10v5H7z' }],
  ],
  spark: [['path', { d: 'M12 2l1.9 5.6L19.5 9l-5.6 1.9L12 16.5l-1.9-5.6L4.5 9l5.6-1.4L12 2z' }]],
  home: [
    ['path', { d: 'm3 10 9-7 9 7' }],
    ['path', { d: 'M5 9v11h14V9' }],
  ],
  target: [
    ['circle', { cx: 12, cy: 12, r: 9 }],
    ['circle', { cx: 12, cy: 12, r: 5 }],
    ['circle', { cx: 12, cy: 12, r: 1.4 }],
  ],
  flame: [['path', { d: 'M12 3c3 3.4 5.5 6 5.5 9.5a5.5 5.5 0 0 1-11 0C6.5 9 9 6.4 12 3Z' }]],
  list: [
    ['path', { d: 'M8 6h13M8 12h13M8 18h13' }],
    ['path', { d: 'M3.5 6h.01M3.5 12h.01M3.5 18h.01' }],
  ],
  pen: [
    ['path', { d: 'M12 20h9' }],
    ['path', { d: 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z' }],
  ],
  headphones: [
    ['path', { d: 'M4 14v-2a8 8 0 0 1 16 0v2' }],
    ['rect', { x: 2.5, y: 14, width: 4, height: 6, rx: 1.6 }],
    ['rect', { x: 17.5, y: 14, width: 4, height: 6, rx: 1.6 }],
  ],
  video: [
    ['rect', { x: 2, y: 5, width: 14, height: 14, rx: 2 }],
    ['path', { d: 'm16 10 5-3v10l-5-3' }],
  ],
  eye: [
    ['path', { d: 'M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z' }],
    ['circle', { cx: 12, cy: 12, r: 2.6 }],
  ],
  flip: [
    ['path', { d: 'M21 12a9 9 0 0 1-15 6.7L3 16' }],
    ['path', { d: 'M3 12a9 9 0 0 1 15-6.7L21 8' }],
    ['path', { d: 'M3 21v-5h5M21 3v5h-5' }],
  ],
  external: [
    ['path', { d: 'M14 4h6v6' }],
    ['path', { d: 'M20 4 10 14' }],
    ['path', { d: 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5' }],
  ],
  trash: [
    ['path', { d: 'M4 7h16' }],
    ['path', { d: 'M9 7V4h6v3' }],
    ['path', { d: 'M6 7l1 13h10l1-13' }],
  ],
  grid: [
    ['rect', { x: 3, y: 3, width: 7, height: 7, rx: 1.4 }],
    ['rect', { x: 14, y: 3, width: 7, height: 7, rx: 1.4 }],
    ['rect', { x: 3, y: 14, width: 7, height: 7, rx: 1.4 }],
    ['rect', { x: 14, y: 14, width: 7, height: 7, rx: 1.4 }],
  ],
  arrowLeft: [['path', { d: 'M19 12H5M11 6l-6 6 6 6' }]],
  arrowRight: [['path', { d: 'M5 12h14M13 6l6 6-6 6' }]],
  info: [
    ['circle', { cx: 12, cy: 12, r: 9 }],
    ['path', { d: 'M12 11v5M12 8h.01' }],
  ],
  plus: [['path', { d: 'M12 5v14M5 12h14' }]],
  translate: [
    ['path', { d: 'M4 6h10M9 6v1M6 9c1 2.5 3 4.5 6 5.5M11 9c-1 2.5-3 4.5-6 5.5' }],
    ['path', { d: 'm14 19 3.5-8 3.5 8M15.5 16h4' }],
  ],
  notebook: [
    ['rect', { x: 4, y: 3, width: 16, height: 18, rx: 2 }],
    ['path', { d: 'M8 3v18' }],
    ['path', { d: 'M11 8h6M11 12h6M11 16h4' }],
  ],
  clock: [
    ['circle', { cx: 12, cy: 12, r: 9 }],
    ['path', { d: 'M12 7v5l3.5 2' }],
  ],
}

function Icon(name, size, extra) {
  const shapes = ICONS[name] ?? ICONS.book
  const edge = Number.isFinite(Number(size)) ? Number(size) : 16
  return h('svg', {
    width: edge,
    height: edge,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    className: 'nce-icon',
    ...(extra ?? {}),
  }, shapes.map((shape, index) => h(shape[0], { key: index, ...shape[1] })))
}

function Btn(props) {
  const kind = props.kind ?? 'soft'
  const size = props.size ?? 'md'
  const hasChildren = props.children !== undefined && props.children !== null && props.children !== ''
  return h('button', {
    type: 'button',
    className: cx('nce-btn', `nce-btn-${kind}`, `nce-btn-${size}`, !hasChildren && 'is-icon', props.active === true && 'is-active', props.className),
    disabled: props.disabled === true,
    title: props.title,
    'aria-label': props.title,
    'aria-expanded': props['aria-expanded'],
    'aria-pressed': props['aria-pressed'],
    onClick: props.onClick,
  }, props.icon !== undefined ? Icon(props.icon, size === 'sm' ? 14 : 16) : null, hasChildren ? props.children : null)
}

function Chip(props) {
  return h('button', {
    type: 'button',
    className: cx('nce-chip', props.active === true && 'is-active', props.className),
    onClick: props.onClick,
    title: props.title,
    disabled: props.disabled === true,
  },
  props.children,
  props.count !== undefined && props.count !== null && props.count !== '' ? h('span', { className: 'nce-chip-count' }, props.count) : null)
}

function Section(props) {
  const hasHead = props.title !== undefined || props.hint !== undefined || props.extra !== undefined
  return h('section', { className: cx('nce-section', props.className) },
    hasHead ? h('div', { className: 'nce-section-head' },
      h('div', { className: 'nce-section-titles' },
        props.title !== undefined ? h('h2', { className: 'nce-section-title' }, props.title) : null,
        props.hint !== undefined ? h('p', { className: 'nce-section-hint' }, props.hint) : null),
      props.extra !== undefined ? h('div', { className: 'nce-section-extra' }, props.extra) : null) : null,
    props.children)
}

function Empty(props) {
  return h('div', { className: 'nce-empty' },
    h('div', { className: 'nce-empty-icon' }, Icon(props.icon ?? 'book', 22)),
    h('div', { className: 'nce-empty-title' }, props.title ?? '还没有内容'),
    props.text !== undefined ? h('p', { className: 'nce-empty-text' }, props.text) : null,
    props.action !== undefined ? h('div', { className: 'nce-empty-action' }, props.action) : null)
}

function Loading(props) {
  return h('div', { className: 'nce-loading' },
    h('span', { className: 'nce-spinner' }),
    h('span', null, props.text ?? '加载中…'))
}

function ErrorBox(props) {
  return h('div', { className: 'nce-errorbox' },
    h('div', { className: 'nce-errorbox-icon' }, Icon('info', 18)),
    h('div', { className: 'nce-errorbox-body' },
      h('div', { className: 'nce-errorbox-title' }, props.title ?? '加载失败'),
      h('p', { className: 'nce-errorbox-text' }, errorMessage(props.error, props.text ?? '请稍后重试'))),
    props.onRetry !== undefined ? h(Btn, { size: 'sm', onClick: props.onRetry }, '重试') : null)
}

function Stat(props) {
  return h('div', { className: cx('nce-stat', props.className) },
    h('div', { className: 'nce-stat-value' }, props.value, props.unit !== undefined ? h('span', { className: 'nce-stat-unit' }, props.unit) : null),
    h('div', { className: 'nce-stat-label' }, props.label),
    props.hint !== undefined ? h('div', { className: 'nce-stat-hint' }, props.hint) : null)
}

function Bar(props) {
  const value = clamp(Number(props.value) || 0, 0, Number(props.total) || 0)
  const width = pct(value, props.total)
  return h('div', { className: cx('nce-bar', props.className), role: 'progressbar', 'aria-valuenow': value, 'aria-valuemin': 0, 'aria-valuemax': props.total },
    h('span', { className: 'nce-bar-fill', style: { width: `${width}%` } }))
}


function Speaker(props) {
  const speaking = useSpeaking()
  const text = String(props.text ?? '').trim()
  const active = text !== '' && speaking.playing && speaking.text === (text.length > 280 ? text.slice(0, 280) : text)
  if (text === '') return null
  return h(Btn, {
    kind: 'quiet',
    size: props.size ?? 'sm',
    icon: 'sound',
    active,
    title: props.title ?? '朗读',
    className: cx('nce-speaker', props.className),
    onClick: (event) => {
      event?.stopPropagation?.()
      if (active) stopSpeech()
      else playText(text)
    },
  })
}

function VoiceMenu() {
  const tts = useTtsInfo()
  const [prefs, setPrefs] = useState(readPrefs)
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event) => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target)) setOpen(false)
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const info = tts.info
  const voices = info !== null && info !== undefined && Array.isArray(info.voices) && info.voices.length > 0 ? info.voices : FALLBACK_VOICES
  const current = voices.find((voice) => voice.value === prefs.voice) ?? voices[0]
  const engineLabel = info === null
    ? (tts.loading ? '检测中…' : '本机语音')
    : info.engine === 'edge' ? '在线音色' : info.engine === 'say' ? '本机音色' : '浏览器语音'
  const update = (patch) => setPrefs(writePrefs(patch))
  const preview = () => playText(VOICE_PREVIEW_TEXT)

  return h('div', { className: 'nce-voice', ref: rootRef },
    h(Btn, {
      kind: 'quiet',
      size: 'sm',
      icon: 'headphones',
      active: open,
      title: '朗读声音与速度',
      onClick: () => setOpen((value) => !value),
    }, '声音'),
    open
      ? h('div', { className: 'nce-voice-pop' },
        h('div', { className: 'nce-voice-head' },
          h('span', null, '朗读声音'),
          h('span', { className: 'nce-voice-engine' }, engineLabel)),
        h('select', {
          className: 'nce-voice-select',
          value: current !== undefined ? current.value : prefs.voice,
          'aria-label': '朗读音色',
          onChange: (event) => {
            update({ voice: event.target.value })
            if (prefs.autoSpeak) preview()
          },
        }, voices.map((voice) => h('option', { key: voice.value, value: voice.value }, voice.label ?? voice.name))),
        h('div', { className: 'nce-voice-row' },
          SPEECH_RATE_OPTIONS.map((option) => h(Chip, {
            key: option.value,
            active: prefs.rate === option.value,
            onClick: () => update({ rate: option.value }),
          }, option.label))),
        h('div', { className: 'nce-voice-row' },
          h(Chip, {
            active: prefs.autoSpeak,
            onClick: () => update({ autoSpeak: !prefs.autoSpeak }),
          }, prefs.autoSpeak ? '自动朗读 开' : '自动朗读 关')),
        h('div', { className: 'nce-voice-foot' },
          h('span', { className: 'nce-voice-note' }, '与翻译插件同一套音色'),
          h(Btn, { kind: 'primary', size: 'sm', icon: 'play', onClick: preview }, '试听')))
      : null)
}

function Badge(props) {
  return h('span', { className: cx('nce-badge', props.tone !== undefined && `nce-badge-${props.tone}`, props.className) }, props.children)
}
