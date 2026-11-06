/**
 * Learning-progress model: the default document and the normalizer that turns
 * whatever is on disk (SQLite rows or legacy JSON) into it.
 *
 * @module host/domain/progress
 */

import { LESSON_STEPS, LESSON_STATUS } from './constants.js'
import { normalizeCard } from './srs.js'

const PROGRESS_VERSION = 1

export function emptyProgress() {
  return {
    version: PROGRESS_VERSION,
    updatedAt: 0,
    streak: { lastDay: '', days: 0, totalDays: 0 },
    history: {},
    lessons: {},
    words: {},
    videos: {},
    translations: {},
    translateDismissed: {},
  }
}

export function normalizeProgress(raw) {
  const progress = emptyProgress()
  if (raw === null || typeof raw !== 'object') return progress
  if (raw.streak !== null && typeof raw.streak === 'object') {
    progress.streak = {
      lastDay: typeof raw.streak.lastDay === 'string' ? raw.streak.lastDay : '',
      days: Math.max(0, Number(raw.streak.days) || 0),
      totalDays: Math.max(0, Number(raw.streak.totalDays) || 0),
    }
  }
  if (raw.history !== null && typeof raw.history === 'object' && !Array.isArray(raw.history)) {
    for (const [day, count] of Object.entries(raw.history)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Number(count))) progress.history[day] = Number(count)
    }
  }
  if (raw.lessons !== null && typeof raw.lessons === 'object' && !Array.isArray(raw.lessons)) {
    for (const [id, value] of Object.entries(raw.lessons)) {
      if (!/^\d+$/.test(id) || value === null || typeof value !== 'object') continue
      const steps = {}
      const source = value.steps !== null && typeof value.steps === 'object' ? value.steps : {}
      for (const name of LESSON_STEPS) steps[name] = source[name] === true
      progress.lessons[id] = {
        status: LESSON_STATUS.has(value.status) ? value.status : 'learning',
        steps,
        updatedAt: Number(value.updatedAt) || 0,
        lastVisit: Number(value.lastVisit) || 0,
      }
    }
  }
  if (raw.words !== null && typeof raw.words === 'object' && !Array.isArray(raw.words)) {
    for (const [key, value] of Object.entries(raw.words)) {
      if (value === null || typeof value !== 'object') continue
      const entry = {}
      if (value.starred === true) entry.starred = true
      if (value.srs !== null && typeof value.srs === 'object') entry.srs = normalizeCard(value.srs)
      if (Number.isFinite(Number(value.right))) entry.right = Number(value.right)
      if (Number.isFinite(Number(value.wrong))) entry.wrong = Number(value.wrong)
      if (Object.keys(entry).length > 0) progress.words[key] = entry
    }
  }
  if (raw.videos !== null && typeof raw.videos === 'object' && !Array.isArray(raw.videos)) {
    for (const [id, url] of Object.entries(raw.videos)) {
      if (/^\d+$/.test(id) && typeof url === 'string' && /^https?:\/\//i.test(url)) progress.videos[id] = url
    }
  }
  if (raw.translations !== null && typeof raw.translations === 'object' && !Array.isArray(raw.translations)) {
    for (const [key, value] of Object.entries(raw.translations)) {
      if (!/^tr:[A-Za-z0-9_-]{1,64}$/.test(key) || value === null || typeof value !== 'object') continue
      const source = typeof value.source === 'string' ? value.source.trim() : ''
      const translation = typeof value.translation === 'string' ? value.translation.trim() : ''
      if (source === '' || translation === '') continue
      const examples = Array.isArray(value.examples)
        ? value.examples.filter((item) => typeof item === 'string' && item.trim() !== '').slice(0, 2).map((item) => item.slice(0, 300))
        : []
      progress.translations[key] = {
        recordId: typeof value.recordId === 'string' && value.recordId !== '' ? value.recordId : key.slice(3),
        direction: value.direction === 'zh-en' ? 'zh-en' : 'en-zh',
        source: source.slice(0, 500),
        translation: translation.slice(0, 500),
        notes: typeof value.notes === 'string' ? value.notes.slice(0, 800) : '',
        examples,
        createdAt: typeof value.createdAt === 'string' ? value.createdAt : '',
        addedAt: typeof value.addedAt === 'string' ? value.addedAt : '',
      }
    }
  }
  if (raw.translateDismissed !== null && typeof raw.translateDismissed === 'object' && !Array.isArray(raw.translateDismissed)) {
    for (const id of Object.keys(raw.translateDismissed)) {
      if (/^[A-Za-z0-9_-]{1,64}$/.test(id)) progress.translateDismissed[id] = true
    }
  }
  progress.updatedAt = Number(raw.updatedAt) || 0
  return progress
}
