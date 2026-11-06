/**
 * Read-only views derived from a progress document: lesson progress defaults,
 * word unlock rules and review-queue cards.
 *
 * Pure: no IO, no host context. The application layer composes these with data
 * from the repositories.
 *
 * @module host/domain/views
 */

import { LESSON_STEPS } from './constants.js'

export function lessonProgressOr(progress, id) {
  return progress.lessons[id] ?? {
    status: 'learning',
    steps: Object.fromEntries(LESSON_STEPS.map((name) => [name, false])),
    updatedAt: 0,
    lastVisit: 0,
  }
}

/** The card the client should show for a word, without creating it on disk. */
export function wordCardOr(progress, key) {
  return progress.words[key]?.srs ?? null
}

/** Lessons the learner has started; a fresh profile starts at lesson 1. */
export function startedLessonIds(progress) {
  const ids = new Set()
  for (const [id, entry] of Object.entries(progress?.lessons ?? {})) {
    const value = Number(id)
    if (Number.isInteger(value) && value > 0 && entry !== null && typeof entry === 'object') ids.add(value)
  }
  if (ids.size === 0) ids.add(1)
  return [...ids].sort((left, right) => left - right)
}

/** A word is unlocked when any lesson it appears in has been started. */
export function isWordUnlocked(word, startedSet) {
  const first = Number(word?.firstLesson)
  if (Number.isInteger(first) && startedSet.has(first)) return true
  const lessons = Array.isArray(word?.lessons) ? word.lessons : []
  return lessons.some((id) => startedSet.has(Number(id)))
}

/** Started lessons, most recently studied first (drives new-card priority). */
export function recentLessonIds(progress) {
  const rows = []
  for (const [id, entry] of Object.entries(progress?.lessons ?? {})) {
    const value = Number(id)
    if (!Number.isInteger(value) || value <= 0) continue
    rows.push({ id: value, at: Math.max(Number(entry?.updatedAt) || 0, Number(entry?.lastVisit) || 0) })
  }
  rows.sort((left, right) => right.at - left.at || right.id - left.id)
  const ids = rows.map((row) => row.id)
  return ids.length > 0 ? ids : [1]
}

/** Smallest lesson after the current frontier that still has locked new words. */
export function nextUnlockLesson(words, startedSet) {
  const maxStarted = startedSet.size === 0 ? 1 : Math.max(...startedSet)
  let best = 0
  for (const word of words) {
    const first = Number(word?.firstLesson)
    if (!Number.isInteger(first) || first <= maxStarted || startedSet.has(first)) continue
    if (best === 0 || first < best) best = first
  }
  return best
}

export function queueItem(word, card, isNew) {
  return {
    kind: 'word',
    key: word.key,
    word: word.word,
    phonetic: word.phonetic ?? '',
    pos: word.pos ?? '',
    meaning: word.meaning ?? '',
    example: word.example ?? '',
    lesson: word.firstLesson ?? (Array.isArray(word.lessons) ? word.lessons[0] : 0),
    lessons: Array.isArray(word.lessons) ? word.lessons : [],
    card,
    isNew,
    starred: false,
  }
}

/** Sentence card built from one translation history record. */
export function translationQueueItem(key, entry, card, isNew) {
  const enText = entry.direction === 'zh-en' ? entry.translation : entry.source
  return {
    kind: 'translation',
    key,
    word: entry.source,
    phonetic: '',
    pos: '',
    meaning: entry.translation,
    example: '',
    lesson: 0,
    lessons: [],
    card,
    isNew,
    starred: false,
    translation: {
      direction: entry.direction,
      source: entry.source,
      translation: entry.translation,
      notes: entry.notes ?? '',
      examples: Array.isArray(entry.examples) ? entry.examples : [],
      enText,
    },
  }
}
