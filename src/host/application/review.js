/**
 * Memory-card review use cases: the Anki-style queue, grading (SRS + streak)
 * and the lightweight right/wrong answer counter.
 *
 * @module host/application/review
 */

import { GRADES } from '../domain/constants.js'
import { DAY_MS, gradeCard, isDue, localDayKey } from '../domain/srs.js'
import {
  isWordUnlocked,
  nextUnlockLesson,
  queueItem,
  recentLessonIds,
  startedLessonIds,
  translationQueueItem,
  wordCardOr,
} from '../domain/views.js'
import { readString } from './payload.js'

/**
 * @param {{
 *   dataRepository: import('../ports.js').DataRepository,
 *   progressService: ReturnType<typeof import('./progress.js').createProgressService>,
 *   translateService: ReturnType<typeof import('./translate.js').createTranslateService>,
 *   RouteError: new (status: number, message: string) => Error,
 * }} deps
 */
export function createReviewOperations({ dataRepository, progressService, translateService, RouteError }) {
  return {
    async 'review/queue'(payload) {
      if (payload.syncTranslate !== false) await translateService.autoImport()
      const bank = await dataRepository.loadWordbank()
      const progress = await progressService.load()
      const limitNewRaw = Number(payload.limitNew)
      const limitNew = Number.isFinite(limitNewRaw) ? Math.min(50, Math.max(0, Math.round(limitNewRaw))) : 10
      const limitTranslationRaw = Number(payload.limitTranslationNew)
      const limitTranslationNew = Number.isFinite(limitTranslationRaw) ? Math.min(20, Math.max(0, Math.round(limitTranslationRaw))) : 3
      const now = Date.now()
      const words = Array.isArray(bank?.words) ? bank.words : []
      const started = startedLessonIds(progress)
      const startedSet = new Set(started)
      const frontOrder = new Map(recentLessonIds(progress).map((id, index) => [id, index]))
      const includeLocked = payload.includeLocked === true
      const due = []
      const fresh = []
      let learning = 0
      let reviewDue = 0
      for (const word of words) {
        if (word === null || typeof word !== 'object') continue
        const key = typeof word.key === 'string' ? word.key : ''
        if (key === '') continue
        const card = wordCardOr(progress, key)
        if (card === null) {
          fresh.push(word)
          continue
        }
        // Anki-style deck counters: learning steps (1/3), review cards due (2).
        if (card.state === 1 || card.state === 3) learning += 1
        if (card.state === 2 && isDue(card, now)) reviewDue += 1
        if (card.state === 0 || isDue(card, now)) due.push({ word, card })
      }
      // New cards follow the lesson frontier: only words from lessons already started,
      // with the most recently studied lesson first.
      const unlockedFresh = includeLocked ? fresh.slice() : fresh.filter((word) => isWordUnlocked(word, startedSet))
      const unlockedKeys = new Set(unlockedFresh.map((word) => word.key))
      if (!includeLocked) {
        const rank = (word) => {
          const id = Number(word?.firstLesson)
          return frontOrder.has(id) ? frontOrder.get(id) : 999
        }
        unlockedFresh.sort((left, right) => rank(left) - rank(right) || Number(left.firstLesson) - Number(right.firstLesson) || String(left.word).localeCompare(String(right.word)))
      }
      // Cards created from the translation plugin's history (sentence cards).
      const translationEntries = Object.entries(progress.translations ?? {})
      const translationDue = []
      const translationNew = []
      for (const [key, entry] of translationEntries) {
        const card = progress.words[key]?.srs ?? null
        if (card === null) {
          translationNew.push({ key, entry, card: null })
          continue
        }
        if (card.state === 0 || isDue(card, now)) translationDue.push({ key, entry, card })
      }

      const dueQueue = []
      for (const { word, card } of due) dueQueue.push({ at: Date.parse(card.due) || 0, item: queueItem(word, card, false) })
      for (const { key, entry, card } of translationDue) dueQueue.push({ at: Date.parse(card.due) || 0, item: translationQueueItem(key, entry, card, false) })
      dueQueue.sort((left, right) => left.at - right.at)
      const queue = dueQueue.map((row) => row.item)
      const newItems = []
      for (const { key, entry } of translationNew) {
        if (newItems.length >= limitTranslationNew) break
        newItems.push(translationQueueItem(key, entry, null, true))
      }
      let wordNewAdded = 0
      for (const word of unlockedFresh) {
        if (wordNewAdded >= limitNew) break
        newItems.push(queueItem(word, null, true))
        wordNewAdded += 1
      }
      queue.push(...newItems)
      return {
        ok: true,
        queue,
        dueCount: due.length + translationDue.length,
        newCount: unlockedFresh.length + translationNew.length,
        counts: {
          new: unlockedFresh.length + translationNew.length,
          learning,
          due: reviewDue,
          total: words.length,
          lockedNew: includeLocked ? 0 : fresh.filter((word) => !unlockedKeys.has(word.key)).length,
          translationNew: translationNew.length,
        },
        translation: {
          added: translationEntries.length,
          new: translationNew.length,
          newInQueue: Math.min(translationNew.length, limitTranslationNew),
          limit: limitTranslationNew,
        },
        unlocked: {
          lessons: started,
          newCount: includeLocked ? fresh.length : unlockedFresh.length,
          lockedNew: includeLocked ? 0 : fresh.filter((word) => !unlockedKeys.has(word.key)).length,
          nextLesson: nextUnlockLesson(words, startedSet),
        },
        today: localDayKey(new Date()),
        dayCount: progress.history[localDayKey(new Date())] ?? 0,
        streak: progress.streak,
      }
    },

    async 'review/grade'(payload) {
      const key = readString(payload, 'key').trim().toLowerCase()
      const grade = readString(payload, 'grade').trim().toLowerCase()
      if (key === '') throw new RouteError(400, '缺少单词 key')
      if (!GRADES.has(grade)) throw new RouteError(400, '评分不合法')
      const isTranslation = key.startsWith('tr:')
      let word
      if (isTranslation) {
        const progressNow = await progressService.load()
        const record = progressNow.translations?.[key]
        if (record === undefined || record === null) throw new RouteError(404, '没有这张翻译卡')
        word = { key, word: record.source, phonetic: '', pos: '', meaning: record.translation, lesson: 0 }
      } else {
        const lookup = await dataRepository.wordLookup()
        word = lookup.get(key)
        if (word === undefined) throw new RouteError(404, '词库里没有这个单词')
      }
      const today = localDayKey(new Date())
      const result = await progressService.withProgress((progress) => {
        const entry = progress.words[key] ?? {}
        const dueBefore = entry.srs?.due ?? null
        const card = gradeCard(entry.srs ?? null, grade)
        entry.srs = card
        progressService.appendReviewLog(key, grade, dueBefore, card.due)
        if (grade === 'again') entry.wrong = (Number(entry.wrong) || 0) + 1
        else if (grade !== 'hard') entry.right = (Number(entry.right) || 0) + 1
        progress.words[key] = entry
        progress.history[today] = (progress.history[today] ?? 0) + 1
        if (progress.streak.lastDay !== today) {
          const last = Date.parse(`${progress.streak.lastDay}T00:00:00`)
          const yesterday = Date.now() - DAY_MS
          const isConsecutive = Number.isFinite(last) && localDayKey(new Date(yesterday)) === progress.streak.lastDay
          progress.streak.days = isConsecutive ? progress.streak.days + 1 : 1
          progress.streak.lastDay = today
          progress.streak.totalDays = Math.max(progress.streak.days, progress.streak.totalDays)
        }
        return {
          card,
          word: {
            key: word.key,
            word: word.word,
            phonetic: word.phonetic ?? '',
            pos: word.pos ?? '',
            meaning: word.meaning ?? '',
            lesson: word.firstLesson ?? 0,
          },
          streak: progress.streak,
          todayCount: progress.history[today] ?? 0,
        }
      })
      return { ok: true, ...result }
    },

    async 'review/answer'(payload) {
      const key = readString(payload, 'key').trim().toLowerCase()
      if (key === '') throw new RouteError(400, '缺少单词 key')
      const correct = payload.correct === true
      await progressService.withProgress((progress) => {
        const entry = progress.words[key] ?? {}
        if (correct) entry.right = (Number(entry.right) || 0) + 1
        else entry.wrong = (Number(entry.wrong) || 0) + 1
        progress.words[key] = entry
      })
      return { ok: true }
    },
  }
}
