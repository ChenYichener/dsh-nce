/**
 * SRS (simplified FSRS-lite) scheduling and local day helpers.
 *
 * The client only sends a grade; this module decides the next due date and the
 * card counters. Everything here is pure (no IO), so the review use cases and
 * the domain tests can run without a host.
 *
 * @module host/domain/srs
 */

export const DAY_MS = 86_400_000

export function localDayKey(date) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Local midnight `days` from today, as an ISO timestamp. */
export function dueAfterDays(days) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  date.setHours(0, 0, 0, 0)
  return date.toISOString()
}

export function dueAfterMinutes(minutes) {
  return new Date(Date.now() + minutes * 60_000).toISOString()
}

export function normalizeCard(raw) {
  const card = raw !== null && typeof raw === 'object' ? raw : {}
  const num = (key, fallback) => (Number.isFinite(Number(card[key])) ? Number(card[key]) : fallback)
  return {
    due: typeof card.due === 'string' && card.due !== '' ? card.due : new Date().toISOString(),
    stability: Math.max(0, num('stability', 0)),
    difficulty: Math.max(1, Math.min(10, num('difficulty', 5))),
    scheduledDays: Math.max(0, num('scheduledDays', 0)),
    learningSteps: Math.max(0, num('learningSteps', 0)),
    reps: Math.max(0, num('reps', 0)),
    lapses: Math.max(0, num('lapses', 0)),
    state: [0, 1, 2, 3].includes(num('state', 0)) ? num('state', 0) : 0,
    lastReview: typeof card.lastReview === 'string' ? card.lastReview : '',
  }
}

/** Replace one word's card with the next scheduling state. */
export function gradeCard(card, grade) {
  const next = normalizeCard(card)
  const now = new Date()
  next.reps += 1
  next.lastReview = now.toISOString()
  if (grade === 'again') {
    next.lapses += 1
    next.state = next.state === 0 ? 1 : 3
    next.learningSteps = 0
    next.scheduledDays = 0
    next.due = dueAfterMinutes(1)
    return next
  }
  if (grade === 'hard') {
    // A first "hard" answer still puts the card in the learning state so the
    // next queue respects the 10-minute step instead of re-asking right away.
    if (next.state === 0) next.state = 1
    next.learningSteps = 1
    next.scheduledDays = 0
    next.due = dueAfterMinutes(10)
    return next
  }
  if (grade === 'good') {
    if (next.state === 0 || next.state === 1) {
      next.scheduledDays = 1
    } else {
      next.scheduledDays = Math.max(1, Math.round(next.stability * 2.5))
    }
    next.state = 2
    next.stability = next.scheduledDays
    next.learningSteps = 0
    next.due = dueAfterDays(next.scheduledDays)
    return next
  }
  // easy
  if (next.state === 0 || next.state === 1) {
    next.scheduledDays = 4
  } else {
    next.scheduledDays = Math.max(2, Math.round(next.stability * 3.5))
  }
  next.state = 2
  next.stability = next.scheduledDays
  next.learningSteps = 0
  next.due = dueAfterDays(next.scheduledDays)
  return next
}

export function isDue(card, now) {
  if (card === null || typeof card !== 'object') return false
  if (card.state === 0) return false
  const at = Date.parse(card.due)
  return Number.isFinite(at) && at <= now
}
