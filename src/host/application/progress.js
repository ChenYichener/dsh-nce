/**
 * Progress state use cases: lazy load, serialized read-modify-write, atomic
 * save-behind, reset and the review log.
 *
 * The in-memory state is shared by every use case (one instance per plugin
 * mount); persistence details live behind the injected `ProgressRepository`.
 *
 * @module host/application/progress
 */

import { emptyProgress } from '../domain/progress.js'
import { readString } from './payload.js'

/**
 * @param {{ repository: import('../ports.js').ProgressRepository }} deps
 * @returns {{
 *   load: () => Promise<object>,
 *   save: () => Promise<void>,
 *   withProgress: (task: (progress: object) => Promise<unknown> | unknown) => Promise<unknown>,
 *   reset: () => Promise<{ cleared: boolean }>,
 *   appendReviewLog: (wordKey: string, grade: string, dueBefore: string|null, dueAfter: string) => void,
 *   state: object|null,
 *   storageMode: string,
 * }} progress service
 */
export function createProgressService({ repository }) {
  let progressState = null
  /** Serializes read-modify-write sections; never waits on its own disk write. */
  let progressLock = Promise.resolve()

  async function load() {
    if (progressState !== null) return progressState
    progressState = await repository.load()
    return progressState
  }

  function save() {
    progressState.updatedAt = Date.now()
    return repository.save(progressState)
  }

  /** Serialized read-modify-write so concurrent requests never interleave. */
  function withProgress(task) {
    const run = async () => {
      const progress = await load()
      const result = await task(progress)
      await save()
      return result
    }
    const serialized = progressLock.then(run, run)
    progressLock = serialized.then(() => undefined, () => undefined)
    return serialized
  }

  /** Wipe all learning progress (used to reset a test/demo state). */
  async function reset() {
    const cleared = await repository.reset()
    progressState = emptyProgress()
    progressState.updatedAt = Date.now()
    if (!cleared) await save()
    return { cleared }
  }

  function appendReviewLog(wordKey, grade, dueBefore, dueAfter) {
    repository.recordReview(wordKey, grade, dueBefore, dueAfter)
  }

  return {
    load,
    save,
    withProgress,
    reset,
    appendReviewLog,
    get state() {
      return progressState
    },
    get storageMode() {
      return repository.storageMode
    },
  }
}

/**
 * Maintenance use case for the `progress/reset` op.
 *
 * @param {{
 *   progressService: ReturnType<typeof createProgressService>,
 *   RouteError: new (status: number, message: string) => Error,
 * }} deps
 */
export function createProgressOperations({ progressService, RouteError }) {
  return {
    async reset(payload) {
      if (readString(payload, 'confirm') !== 'reset') throw new RouteError(400, '需要 { "confirm": "reset" }')
      await progressService.reset()
      return { ok: true, progress: progressService.state, storage: progressService.storageMode }
    },
  }
}
