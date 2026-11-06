// Layer: 02 persistence — depends on: 00-platform (`clamp`, hooks) and the browser localStorage.
// Local persistence adapters: last nav position, learner preferences, scroll
// offsets and small UI flags (the panel is unmounted when you switch DSH
// sessions, so React state alone would forget where you were).

const PREFS_KEY = 'dsh-nce/prefs/v1'
const NAV_KEY = 'dsh-nce/nav/v1'

const DEFAULT_PREFS = {
  rate: 140,
  autoSpeak: false,
  newPerDay: 10,
  translationNewPerDay: 3,
  translateAutoSync: true,
  translateListOpen: false,
  voice: 'edge:en-US-AriaNeural',
}

/** Restore the last visible page/lesson so switching panels keeps your place. */
function readNav() {
  const fallback = { page: 'home', lessonId: 0, tab: '' }
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(NAV_KEY)
    if (raw === null || raw === '') return fallback
    const parsed = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return fallback
    const pages = ['home', 'words', 'mistakes', 'review', 'phonetics']
    const page = pages.includes(parsed.page) ? parsed.page : fallback.page
    const lessonIdRaw = Number(parsed.lessonId)
    const lessonId = Number.isInteger(lessonIdRaw) && lessonIdRaw >= 0 && lessonIdRaw <= 144 ? lessonIdRaw : 0
    const tab = typeof parsed.tab === 'string' ? parsed.tab : ''
    return { page, lessonId, tab }
  } catch {
    return fallback
  }
}

function writeNav(nav) {
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(NAV_KEY, JSON.stringify(nav))
  } catch {
    // Best effort.
  }
}

// ---- scroll position memory ------------------------------------------------

const SCROLL_KEY_PREFIX = 'dsh-nce/scroll/v1/'
const UI_KEY_PREFIX = 'dsh-nce/ui/v1/'

/** Slightly-delayed writes keep the scroll handler cheap. */
const SCROLL_SAVE_DELAY_MS = 120
/** Real user input cancels a still-running scroll restoration. */
const RESTORE_CANCEL_EVENTS = ['wheel', 'touchstart', 'keydown', 'mousedown']

/** `name` is a logical view id: `page:home`, `lesson:12`, `course-list`. */
function readScrollOffset(name) {
  if (typeof window === 'undefined') return 0
  try {
    const raw = window.localStorage.getItem(`${SCROLL_KEY_PREFIX}${name}`)
    const value = Number(raw)
    return Number.isFinite(value) && value > 0 ? value : 0
  } catch {
    return 0
  }
}

function writeScrollOffset(name, value) {
  if (typeof window === 'undefined') return
  try {
    const next = Math.max(0, Math.round(Number(value) || 0))
    if (next === 0) window.localStorage.removeItem(`${SCROLL_KEY_PREFIX}${name}`)
    else window.localStorage.setItem(`${SCROLL_KEY_PREFIX}${name}`, String(next))
  } catch {
    // Best effort.
  }
}

/** Small boolean view state (e.g. one lesson's video player expanded). */
function readUiFlag(name) {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(`${UI_KEY_PREFIX}${name}`) === '1'
  } catch {
    return false
  }
}

function writeUiFlag(name, on) {
  if (typeof window === 'undefined') return
  try {
    if (on === true) window.localStorage.setItem(`${UI_KEY_PREFIX}${name}`, '1')
    else window.localStorage.removeItem(`${UI_KEY_PREFIX}${name}`)
  } catch {
    // Best effort.
  }
}

/**
 * Keep one scroll container's offset across panel unmounts. DSH swaps the main
 * panel when you open another session/menu, which destroys every scroll
 * container; restoring from localStorage makes the panel look untouched.
 *
 * The container may not be rendered yet when the effect first runs (course data
 * / a lesson load asynchronously), so the node is awaited briefly. The saved
 * offset is re-applied over a few timer ticks because async content can still be
 * growing right after the remount; timers (not rAF) also work while hidden.
 */
function useScrollMemory(ref, name, enabled) {
  const pending = useRef(null)
  const restoring = useRef(false)
  const saveTimer = useRef(0)
  const attachTimer = useRef(0)
  const restoreTimer = useRef(0)
  useEffect(() => {
    if (enabled === false) return undefined
    let disposed = false
    let node = null
    const onScroll = () => {
      if (restoring.current || node === null) return
      pending.current = { name, value: node.scrollTop }
      if (saveTimer.current !== 0) return
      saveTimer.current = setTimeout(() => {
        saveTimer.current = 0
        if (pending.current !== null) writeScrollOffset(pending.current.name, pending.current.value)
      }, SCROLL_SAVE_DELAY_MS)
    }
    let userTouched = false
    const markUser = () => { userTouched = true }
    const finishRestore = () => {
      if (restoreTimer.current !== 0) {
        clearTimeout(restoreTimer.current)
        restoreTimer.current = 0
      }
      restoring.current = false
    }
    const tick = (target, tries, lastMax, stable) => {
      if (disposed || node === null || userTouched) {
        finishRestore()
        return
      }
      const max = Math.max(0, node.scrollHeight - node.clientHeight)
      const wanted = Math.min(target, max)
      node.scrollTop = wanted
      const reached = target === 0 || (wanted >= target && node.scrollTop >= target)
      const nextStable = max === lastMax ? stable + 1 : 0
      // Async content may still be growing after the remount: keep enforcing the
      // saved offset while the page grows, but give up when it settles shorter
      // (the learner then scrolls freely) or after ~1.9 s.
      if (reached || tries >= 80 || (nextStable >= 10 && wanted < target)) {
        finishRestore()
        return
      }
      restoreTimer.current = setTimeout(() => tick(target, tries + 1, max, nextStable), 24)
    }
    const attach = (tries) => {
      if (disposed) return
      const target = ref.current
      if (target === null || target === undefined) {
        if (tries < 120) attachTimer.current = setTimeout(() => attach(tries + 1), 20)
        return
      }
      node = target
      restoring.current = true
      for (const eventName of RESTORE_CANCEL_EVENTS) node.addEventListener(eventName, markUser, { passive: true })
      tick(readScrollOffset(name), 0, -1, 0)
      node.addEventListener('scroll', onScroll, { passive: true })
    }
    attach(0)
    return () => {
      disposed = true
      if (attachTimer.current !== 0) {
        clearTimeout(attachTimer.current)
        attachTimer.current = 0
      }
      if (restoreTimer.current !== 0) {
        clearTimeout(restoreTimer.current)
        restoreTimer.current = 0
      }
      if (saveTimer.current !== 0) {
        clearTimeout(saveTimer.current)
        saveTimer.current = 0
      }
      if (pending.current !== null && pending.current.name === name) writeScrollOffset(name, pending.current.value)
      if (node !== null) {
        node.removeEventListener('scroll', onScroll)
        for (const eventName of RESTORE_CANCEL_EVENTS) node.removeEventListener(eventName, markUser)
      }
      node = null
      restoring.current = false
    }
  }, [ref, name, enabled])
}

// ---- preferences ----------------------------------------------------------

function readPrefs() {
  if (typeof window === 'undefined') return { ...DEFAULT_PREFS }
  try {
    const raw = window.localStorage.getItem(PREFS_KEY)
    if (raw === null || raw === '') return { ...DEFAULT_PREFS }
    const parsed = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...DEFAULT_PREFS }
    const rate = Number(parsed.rate)
    return {
      rate: Number.isFinite(rate) ? clamp(Math.round(rate), 80, 240) : DEFAULT_PREFS.rate,
      autoSpeak: parsed.autoSpeak === true,
      newPerDay: Number.isFinite(Number(parsed.newPerDay)) ? clamp(Math.round(Number(parsed.newPerDay)), 0, 50) : DEFAULT_PREFS.newPerDay,
      translationNewPerDay: Number.isFinite(Number(parsed.translationNewPerDay)) ? clamp(Math.round(Number(parsed.translationNewPerDay)), 0, 20) : DEFAULT_PREFS.translationNewPerDay,
      translateAutoSync: parsed.translateAutoSync !== false,
      translateListOpen: parsed.translateListOpen === true,
      voice: typeof parsed.voice === 'string' && parsed.voice !== '' ? parsed.voice : DEFAULT_PREFS.voice,
    }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

function writePrefs(patch) {
  const next = { ...readPrefs(), ...(patch ?? {}) }
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(PREFS_KEY, JSON.stringify(next))
  } catch {
    // Preferences are best effort.
  }
  return next
}
