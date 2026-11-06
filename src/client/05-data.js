// Layer: 05 data — depends on: 00-platform (hooks) and 03-api (`api`).
// Module-cached data hooks: one request per host resource, shared by every view.

// ---- data hooks (module-level cache, one request per resource) ------------

const remoteCache = new Map()

function useRemote(operation) {
  const [state, setState] = useState(() => remoteCache.has(operation)
    ? { data: remoteCache.get(operation), loading: false, error: null }
    : { data: null, loading: true, error: null })
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (state.data !== null && tick === 0) return undefined
    let alive = true
    setState((previous) => ({ data: previous.data, loading: true, error: null }))
    api(operation)
      .then((result) => {
        remoteCache.set(operation, result)
        if (alive) setState({ data: result, loading: false, error: null })
      })
      .catch((error) => {
        if (alive) setState({ data: null, loading: false, error })
      })
    return () => {
      alive = false
    }
  }, [operation, tick])
  const reload = useCallback(() => {
    remoteCache.delete(operation)
    setTick((value) => value + 1)
  }, [operation])
  return { ...state, reload }
}

function useIndex() {
  return useRemote('index')
}

function useWordbank() {
  return useRemote('wordbank')
}

function usePhonetics() {
  return useRemote('phonetics')
}

const lessonCache = new Map()

function useLesson(id) {
  const valid = Number.isInteger(id) && id > 0
  const [state, setState] = useState(() => (valid && lessonCache.has(id)
    ? { data: lessonCache.get(id), loading: false, error: null }
    : { data: null, loading: valid, error: null }))
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!valid) {
      setState({ data: null, loading: false, error: null })
      return undefined
    }
    if (lessonCache.has(id) && tick === 0) {
      setState({ data: lessonCache.get(id), loading: false, error: null })
      return undefined
    }
    let alive = true
    setState({ data: lessonCache.get(id) ?? null, loading: true, error: null })
    api('lesson', { id })
      .then((result) => {
        lessonCache.set(id, result.lesson)
        if (alive) setState({ data: result.lesson, loading: false, error: null })
      })
      .catch((error) => {
        if (alive) setState({ data: null, loading: false, error })
      })
    return () => {
      alive = false
    }
  }, [id, valid, tick])
  const reload = useCallback(() => {
    if (!valid) return
    lessonCache.delete(id)
    setTick((value) => value + 1)
  }, [id, valid])
  return { ...state, reload }
}
