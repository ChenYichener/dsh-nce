// Layer: 06 store — depends on: 00-platform (hooks), 02-persistence (`readNav`/`writeNav`), 03-api (`api`).
// The learning store: nav state, progress, lesson updates, word grading and video saving.

// ---- learning store -------------------------------------------------------

const NceContext = React.createContext(null)

function NceProvider(props) {
  const [nav, setNav] = useState(readNav)
  const [progress, setProgress] = useState(null)
  const [progressError, setProgressError] = useState(null)

  const loadProgress = useCallback((signal) => {
    api('progress', {}, { signal })
      .then((result) => {
        setProgress(result.progress)
      })
      .catch((error) => {
        if (!isAbortError(error)) setProgressError(error)
      })
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    loadProgress(controller.signal)
    return () => controller.abort()
  }, [loadProgress])

  useEffect(() => {
    writeNav(nav)
  }, [nav])

  const go = useCallback((page, params) => {
    setNav((previous) => ({ ...previous, page, ...(params ?? {}) }))
  }, [])

  /** Selecting a lesson keeps the 课程 tab active (left list + right detail). */
  const openLesson = useCallback((id, tab) => {
    setNav({ page: 'home', lessonId: id, tab: tab ?? '' })
  }, [])

  /** Consume a one-shot lesson anchor (`nav.tab`) once the lesson page used it. */
  const clearLessonTab = useCallback(() => {
    setNav((previous) => (previous.tab === '' ? previous : { ...previous, tab: '' }))
  }, [])

  const updateLesson = useCallback(async (id, patch) => {
    const result = await api('lesson/status', { id, ...(patch ?? {}) })
    if (result.progress !== undefined) setProgress(result.progress)
    return result.lesson
  }, [])

  const starWord = useCallback(async (key, starred) => {
    setProgress((previous) => {
      if (previous === null) return previous
      const words = { ...previous.words }
      const entry = { ...(words[key] ?? {}) }
      if (starred) entry.starred = true
      else delete entry.starred
      if (Object.keys(entry).length === 0) delete words[key]
      else words[key] = entry
      return { ...previous, words }
    })
    try {
      await api('word/star', { key, starred })
    } catch (error) {
      loadProgress()
      throw error
    }
  }, [loadProgress])

  /** Grade one word; returns the host's next card and updated streak. */
  const gradeWord = useCallback(async (key, grade) => {
    const result = await api('review/grade', { key, grade })
    setProgress((previous) => {
      if (previous === null) return previous
      const words = { ...previous.words }
      const entry = { ...(words[key] ?? {}) }
      entry.srs = result.card
      if (grade === 'again') entry.wrong = (Number(entry.wrong) || 0) + 1
      else if (grade !== 'hard') entry.right = (Number(entry.right) || 0) + 1
      words[key] = entry
      const history = { ...previous.history }
      const today = todayKey()
      history[today] = (Number(history[today]) || 0) + 1
      return { ...previous, words, history, streak: result.streak ?? previous.streak }
    })
    return result
  }, [])

  const saveVideo = useCallback(async (id, url) => {
    const result = await api('video/save', { id, url })
    return result.video
  }, [])

  const value = useMemo(() => ({
    nav,
    go,
    openLesson,
    clearLessonTab,
    progress,
    progressError,
    reloadProgress: () => loadProgress(),
    updateLesson,
    starWord,
    gradeWord,
    saveVideo,
  }), [nav, go, openLesson, clearLessonTab, progress, progressError, loadProgress, updateLesson, starWord, gradeWord, saveVideo])

  return h(NceContext.Provider, { value }, props.children)
}

function useNce() {
  const context = useContext(NceContext)
  if (context === null) throw new Error('useNce 必须在 NceProvider 内使用')
  return context
}
