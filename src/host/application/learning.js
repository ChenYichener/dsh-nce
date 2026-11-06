/**
 * Single-lesson use cases: lesson status steps, saved video links and word
 * starring.
 *
 * @module host/application/learning
 */

import { LESSON_STEPS, LESSON_STATUS } from '../domain/constants.js'
import { lessonProgressOr } from '../domain/views.js'
import { readString } from './payload.js'

/**
 * @param {{
 *   progressService: ReturnType<typeof import('./progress.js').createProgressService>,
 *   RouteError: new (status: number, message: string) => Error,
 * }} deps
 */
export function createLearningOperations({ progressService, RouteError }) {
  return {
    async 'lesson/status'(payload) {
      const id = Number(payload.id)
      if (!Number.isInteger(id) || id < 1 || id > 144) throw new RouteError(400, '课程 id 不合法')
      const status = readString(payload, 'status')
      if (status !== '' && status !== 'unseen' && !LESSON_STATUS.has(status)) throw new RouteError(400, '课程状态不合法')
      if (status === 'unseen') {
        await progressService.withProgress((progress) => {
          delete progress.lessons[id]
          return true
        })
        return {
          ok: true,
          lesson: {
            status: 'unseen',
            steps: Object.fromEntries(LESSON_STEPS.map((name) => [name, false])),
            doneSteps: 0,
            updatedAt: 0,
            lastVisit: 0,
          },
          progress: progressService.state,
        }
      }
      const rawSteps = payload.steps !== null && typeof payload.steps === 'object' ? payload.steps : {}
      const result = await progressService.withProgress((progress) => {
        const entry = progress.lessons[id] ?? lessonProgressOr(progress, id)
        if (status !== '') entry.status = status
        for (const name of LESSON_STEPS) {
          if (typeof rawSteps[name] === 'boolean') entry.steps[name] = rawSteps[name]
        }
        entry.updatedAt = Date.now()
        entry.lastVisit = Date.now()
        progress.lessons[id] = entry
        return entry
      })
      return { ok: true, lesson: result, progress: progressService.state }
    },

    async 'video/save'(payload) {
      const id = Number(payload.id)
      if (!Number.isInteger(id) || id < 1 || id > 144) throw new RouteError(400, '课程 id 不合法')
      const url = readString(payload, 'url').trim()
      if (url !== '' && !/^https?:\/\//i.test(url)) throw new RouteError(400, '只支持 http(s) 视频链接')
      if (url.length > 1000) throw new RouteError(400, '视频链接太长')
      const video = await progressService.withProgress((progress) => {
        if (url === '') delete progress.videos[id]
        else progress.videos[id] = url
        return url
      })
      return { ok: true, video }
    },

    async 'word/star'(payload) {
      const key = readString(payload, 'key').trim().toLowerCase()
      if (key === '') throw new RouteError(400, '缺少单词 key')
      const starred = payload.starred === true
      const entry = await progressService.withProgress((progress) => {
        const current = progress.words[key] ?? {}
        if (starred) current.starred = true
        else delete current.starred
        if (Object.keys(current).length === 0) delete progress.words[key]
        else progress.words[key] = current
        return current
      })
      return { ok: true, word: entry }
    },
  }
}
