/**
 * Read-only content use cases: `/api/info`, the bundled dataset and the stored
 * progress document.
 *
 * @module host/application/content
 */

import { lessonProgressOr } from '../domain/views.js'

/**
 * @param {{
 *   dataRepository: import('../ports.js').DataRepository,
 *   progressRepository: import('../ports.js').ProgressRepository,
 *   progressService: ReturnType<typeof import('./progress.js').createProgressService>,
 *   speechEngine: import('../ports.js').SpeechEngine,
 *   translateHistorySource: import('../ports.js').TranslateHistorySource,
 *   RouteError: new (status: number, message: string) => Error,
 * }} deps
 */
export function createContentOperations({
  dataRepository,
  progressRepository,
  progressService,
  speechEngine,
  translateHistorySource,
  RouteError,
}) {
  return {
    async info() {
      const [index, bank] = await Promise.all([dataRepository.loadIndex(), dataRepository.loadWordbank()])
      await progressRepository.ensureReady()
      const words = Array.isArray(bank?.words) ? bank.words : []
      const storage = progressRepository.storageInfo()
      return {
        ok: true,
        book: index.book,
        dataDir: dataRepository.dir,
        storage,
        // Kept for older clients; points at whichever store is active.
        progressFile: storage.mode === 'sqlite' ? storage.dbFile : storage.legacyFile,
        wordCount: words.length,
        hasPhonetics: await dataRepository.loadPhonetics().then(() => true).catch(() => false),
        ttsEngine: (await speechEngine.available()) ? 'say' : 'none',
        translateHistory: (await translateHistorySource.load()).records.length,
      }
    },

    async index() {
      return { ok: true, index: await dataRepository.loadIndex() }
    },

    async lesson(payload) {
      const id = Number(payload.id)
      if (!Number.isInteger(id) || id < 1 || id > 144) throw new RouteError(400, '课程 id 不合法')
      const lesson = await dataRepository.loadLesson(id)
      const progress = await progressService.load()
      return {
        ok: true,
        lesson: {
          ...lesson,
          lessonProgress: lessonProgressOr(progress, id),
          video: progress.videos[id] ?? '',
        },
      }
    },

    async wordbank() {
      return { ok: true, wordbank: await dataRepository.loadWordbank() }
    },

    async phonetics() {
      return { ok: true, phonetics: await dataRepository.loadPhonetics() }
    },

    async progress() {
      return { ok: true, progress: await progressService.load() }
    },
  }
}
