// Layer: 04 speech — depends on: 00-platform (hooks), 02-persistence (`readPrefs`), 03-api (`API_BASE`).
// Translation-plugin TTS bridge with browser-speech fallback, shared audio state and playText/useSpeaking.

// ---- local TTS playback ---------------------------------------------------

/** The translation plugin hosts the same Edge neural / macOS voices we use. */
const TRANSLATE_API = '/dsh-translate/api'
const VOICE_PREVIEW_TEXT = 'This is how your English will sound.'
/** Same labels and order as the translation panel. */
const SPEECH_RATE_OPTIONS = [
  { value: 100, label: '慢' },
  { value: 140, label: '稍慢' },
  { value: 165, label: '正常' },
  { value: 190, label: '快' },
]
/** Used when the translation plugin is disabled, so the picker stays usable. */
const FALLBACK_VOICES = [
  { name: 'Samantha', label: 'Samantha · 本机', value: 'say:Samantha', provider: 'say' },
  { name: 'Daniel', label: 'Daniel · 本机', value: 'say:Daniel', provider: 'say' },
  { name: '浏览器', label: '浏览器内置语音', value: 'browser:', provider: 'browser' },
]

let ttsInfoCache
let ttsInfoPending

/** Voice list + engine status, read from the translation plugin when it is on. */
function fetchTtsInfo() {
  if (ttsInfoCache !== undefined) return Promise.resolve(ttsInfoCache)
  if (ttsInfoPending !== undefined) return ttsInfoPending
  ttsInfoPending = fetch(`${TRANSLATE_API}/info`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => {
      const info = data !== null && typeof data === 'object' ? data.tts : null
      const usable = info !== null && typeof info === 'object' && Array.isArray(info.voices) && info.voices.length > 0
      // Only a real answer is cached; a miss is retried the next time the menu mounts.
      ttsInfoCache = usable ? info : undefined
      ttsInfoPending = undefined
      return usable ? info : null
    })
    .catch(() => {
      ttsInfoPending = undefined
      ttsInfoCache = undefined
      return null
    })
  return ttsInfoPending
}

function useTtsInfo() {
  const [state, setState] = useState(() => ({ info: ttsInfoCache ?? null, loading: ttsInfoCache === undefined }))
  useEffect(() => {
    let alive = true
    fetchTtsInfo().then((info) => {
      if (alive) setState({ info, loading: false })
    })
    return () => {
      alive = false
    }
  }, [])
  return state
}

/**
 * Render one clip to a playable blob URL. The translation plugin serves the
 * shared Edge/本机 voices; the NCE host `say` route is the offline fallback.
 */
async function fetchAudioUrl(text, voice, rate) {
  try {
    const response = await fetch(`${TRANSLATE_API}/tts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, voice, rate }),
    })
    if (response.ok) return URL.createObjectURL(await response.blob())
  } catch {
    // Fall through to the local voice.
  }
  try {
    const response = await fetch(`${API_BASE}/tts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, rate }),
    })
    if (response.ok) return URL.createObjectURL(await response.blob())
  } catch {
    // The browser voice is the last resort.
  }
  return null
}

const audioState = { playing: false, text: '' }
const audioListeners = new Set()
const audioCache = new Map()
let audioElement = null

function emitAudio() {
  const snapshot = { playing: audioState.playing, text: audioState.text }
  for (const listener of audioListeners) {
    try {
      listener(snapshot)
    } catch {
      // Keep the other listeners alive.
    }
  }
}

function setAudioState(playing, text) {
  audioState.playing = playing
  audioState.text = playing ? String(text ?? '') : ''
  emitAudio()
}

function audioElementOf() {
  if (audioElement !== null) return audioElement
  const element = new Audio()
  element.preload = 'auto'
  element.addEventListener('ended', () => setAudioState(false, ''))
  element.addEventListener('error', () => setAudioState(false, ''))
  audioElement = element
  return element
}

function stopSpeech() {
  if (typeof window !== 'undefined' && window.speechSynthesis !== undefined) {
    try {
      window.speechSynthesis.cancel()
    } catch {
      // Best effort.
    }
  }
  if (audioElement !== null) {
    try {
      audioElement.pause()
      audioElement.currentTime = 0
    } catch {
      // Best effort.
    }
  }
  setAudioState(false, '')
}

function speakWithBrowser(text) {
  if (typeof window === 'undefined' || window.speechSynthesis === undefined) return false
  try {
    const utterance = new window.SpeechSynthesisUtterance(text)
    utterance.lang = 'en-US'
    utterance.rate = 0.95
    utterance.onend = () => setAudioState(false, '')
    utterance.onerror = () => setAudioState(false, '')
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utterance)
    setAudioState(true, text)
    return true
  } catch {
    setAudioState(false, '')
    return false
  }
}

/**
 * Speak one English word/sentence through the same voice pipeline as the
 * translation panel (Edge neural voices, macOS voices as fallback); the Web
 * Speech API is only used when both hosts are unavailable.
 */
async function playText(text, options) {
  const value = String(text ?? '').trim()
  if (value === '') return
  const trimmed = value.length > 280 ? value.slice(0, 280) : value
  const prefs = readPrefs()
  const rate = options?.rate ?? prefs.rate
  const voice = options?.voice ?? prefs.voice
  const cacheKey = `${voice}\u0000${rate}\u0000${trimmed}`
  stopSpeech()
  try {
    let url = audioCache.get(cacheKey)
    if (url === undefined) {
      url = await fetchAudioUrl(trimmed, voice, rate)
      if (url === null) throw new Error('tts unavailable')
      if (audioCache.size >= 120) {
        const first = audioCache.keys().next().value
        const stale = audioCache.get(first)
        audioCache.delete(first)
        try {
          URL.revokeObjectURL(stale)
        } catch {
          // Best effort.
        }
      }
      audioCache.set(cacheKey, url)
    }
    const element = audioElementOf()
    element.src = url
    setAudioState(true, trimmed)
    await element.play().catch(() => {
      setAudioState(false, '')
      throw new Error('playback blocked')
    })
  } catch (error) {
    if (!speakWithBrowser(trimmed)) setAudioState(false, '')
    else if (isAbortError(error)) setAudioState(false, '')
  }
}

function useSpeaking() {
  const [snapshot, setSnapshot] = useState(() => ({ playing: audioState.playing, text: audioState.text }))
  useEffect(() => {
    audioListeners.add(setSnapshot)
    return () => {
      audioListeners.delete(setSnapshot)
    }
  }, [])
  return snapshot
}
