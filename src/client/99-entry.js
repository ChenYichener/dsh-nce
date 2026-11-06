// Layer: 99 entry — depends on: every page fragment + 00/06 (store, CSS registry); ModuleLoader wrapper + slot registration.

// ---------------------------------------------------------------------------
// Entry: page map, panel chrome (three tabs + the voice menu), plugin body and
// slot registration. Must stay last in build order.
// ---------------------------------------------------------------------------

const PAGES = {
  home: HomePage,
  words: WordsPage,
  mistakes: MistakesPage,
  review: ReviewPage,
  phonetics: PhoneticsPage,
}

/** Four top-level destinations; review lives inside 记忆卡. */
const NAV_ITEMS = [
  { id: 'home', label: '课程', icon: 'book' },
  { id: 'words', label: '记忆卡', icon: 'cards' },
  { id: 'mistakes', label: '错题本', icon: 'notebook' },
  { id: 'phonetics', label: '音标&自然拼读', icon: 'headphones' },
]

function navActive(page) {
  if (page === 'review') return 'words'
  if (page === 'lesson') return 'home'
  return page
}

function Subnav() {
  const { nav, go } = useNce()
  const mistakeCount = useMistakeCount()
  const active = navActive(nav.page)
  return h('div', { className: 'nce-subnav' },
    h('div', { className: 'nce-subnav-brand' },
      h('span', { className: 'nce-subnav-title' }, 'NCE'),
      h('span', { className: 'nce-subnav-sub' }, '新概念英语 1')),
    NAV_ITEMS.map((item) => h('button', {
      key: item.id,
      type: 'button',
      className: cx('nce-subnav-tab', active === item.id && 'is-active'),
      onClick: () => go(item.id),
    },
    Icon(item.icon, 16),
    h('span', null, item.label),
    item.id === 'mistakes' && mistakeCount > 0
      ? h('span', { className: 'nce-subnav-tab-count' }, mistakeCount > 99 ? '99+' : String(mistakeCount))
      : null)),
    h('div', { className: 'nce-subnav-spacer' }),
    h(VoiceMenu))
}

function Shell() {
  const { nav } = useNce()
  const scrollRef = useRef(null)
  // Each top-level page keeps its own offset across panel unmounts (and page
  // switches); the course page scrolls its own panes instead (see 40-home).
  useScrollMemory(scrollRef, `page:${nav.page}`)
  const Page = PAGES[nav.page] ?? HomePage
  return h('div', { className: 'nce-root' },
    h(Subnav),
    h('div', { className: cx('nce-scroll', nav.page === 'home' && 'nce-scroll-locked'), ref: scrollRef }, h(Page)))
}

function App() {
  return h(NceProvider, null, h(Shell))
}

/** Last-resort guard so a render error shows a readable message, not a blank panel. */
class PanelErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  render() {
    const error = this.state.error
    if (error !== null && error !== undefined) {
      return h('pre', {
        style: {
          margin: '24px', padding: '16px', overflow: 'auto',
          color: '#ff7b72', background: '#161b22', borderRadius: '10px',
          font: '12px/1.5 ui-monospace, Menlo, monospace', whiteSpace: 'pre-wrap',
        },
      }, String(error?.stack ?? error))
    }
    return this.props.children
  }
}

function Root() {
  return h(PanelErrorBoundary, null, h(App))
}

/** Sidebar mark: the NCE book icon. */
function NceIcon(props) {
  const size = props !== null && props !== undefined && typeof props.size === 'number' ? props.size : 16
  return h('span', {
    className: 'nce-sidebar-mark',
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: `${size}px`,
      height: `${size}px`,
    },
  }, Icon('book', size))
}

const inject = ['slots']

function apply(ctx) {
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    const tag = document.createElement('style')
    tag.dataset.plugin = NS
    tag.dataset.pluginCss = `${NS}/styles`
    tag.textContent = CSS_PARTS.join('\n')
    document.head.appendChild(tag)
    return () => {
      tag.remove()
    }
  }, `${NS}: styles`)

  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
  }, Root))

  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: PANEL_ORDER,
    label: () => COPY.panel,
  }, NceIcon))
}

return { inject, apply }
