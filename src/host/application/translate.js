/**
 * Translation-plugin bridge use cases: promote dsh-translate history records
 * into sentence memory cards, list/remove them and auto-sync new ones.
 *
 * @module host/application/translate
 */

import { readString } from './payload.js'

/**
 * @param {{
 *   translateHistorySource: import('../ports.js').TranslateHistorySource,
 *   progressService: ReturnType<typeof import('./progress.js').createProgressService>,
 *   RouteError: new (status: number, message: string) => Error,
 * }} deps
 */
export function createTranslateService({ translateHistorySource, progressService, RouteError }) {
  function translationCardOf(record) {
    return {
      recordId: record.id,
      direction: record.direction,
      source: record.source,
      translation: record.translation,
      notes: record.notes.slice(0, 800),
      examples: record.examples,
      createdAt: record.createdAt,
      addedAt: new Date().toISOString(),
    }
  }

  /** Snapshot every new translation history record into progress (auto-sync). */
  async function autoImport() {
    const history = await translateHistorySource.load()
    if (!history.available) return 0
    const progress = await progressService.load()
    const pending = history.records.filter((record) => (
      progress.translations[`tr:${record.id}`] === undefined
      && progress.translateDismissed[record.id] !== true
    )).slice(0, 120)
    if (pending.length === 0) return 0
    await progressService.withProgress((state) => {
      for (const record of pending) {
        const key = `tr:${record.id}`
        if (state.translations[key] === undefined && state.translateDismissed[record.id] !== true) {
          state.translations[key] = translationCardOf(record)
        }
      }
      return pending.length
    })
    return pending.length
  }

  return {
    autoImport,

    async 'translate/list'(payload) {
      if (payload.syncTranslate !== false) await autoImport()
      const [history, progress] = await Promise.all([translateHistorySource.load(), progressService.load()])
      const added = new Set(Object.keys(progress.translations ?? {}))
      const records = history.records.slice(0, 60).map((record) => ({
        id: record.id,
        createdAt: record.createdAt,
        direction: record.direction,
        study: record.study,
        source: record.source,
        translation: record.translation,
        notes: record.notes.slice(0, 160),
        added: added.has(`tr:${record.id}`),
      }))
      return {
        ok: true,
        available: history.available,
        total: history.records.length,
        addedCount: added.size,
        records,
      }
    },

    async 'translate/add'(payload) {
      const history = await translateHistorySource.load()
      if (!history.available) throw new RouteError(400, '没有找到翻译插件的历史记录')
      const byId = new Map(history.records.map((record) => [record.id, record]))
      const chosen = []
      if (Array.isArray(payload.ids)) {
        for (const raw of payload.ids) {
          const record = byId.get(String(raw).trim())
          if (record !== undefined) chosen.push(record)
        }
      } else if (typeof payload.id === 'string' && payload.id.trim() !== '') {
        const record = byId.get(payload.id.trim())
        if (record === undefined) throw new RouteError(404, '翻译记录不存在')
        chosen.push(record)
      } else if (Number.isFinite(Number(payload.recent))) {
        const count = Math.min(20, Math.max(1, Math.round(Number(payload.recent))))
        chosen.push(...history.records.slice(0, count))
      }
      if (chosen.length === 0) throw new RouteError(400, '没有可加入的翻译记录')
      const result = await progressService.withProgress((progress) => {
        const added = []
        for (const record of chosen) {
          const key = `tr:${record.id}`
          delete progress.translateDismissed[record.id]
          if (progress.translations[key] !== undefined) continue
          progress.translations[key] = translationCardOf(record)
          added.push(key)
        }
        return { added, progress }
      })
      return { ok: true, added: result.added, progress: result.progress }
    },

    async 'translate/remove'(payload) {
      const id = readString(payload, 'id').trim()
      if (id === '') throw new RouteError(400, '缺少翻译记录 id')
      const key = id.startsWith('tr:') ? id : `tr:${id}`
      const result = await progressService.withProgress((progress) => {
        const existed = progress.translations[key] !== undefined
        delete progress.translations[key]
        delete progress.words[key]
        progress.translateDismissed[id.replace(/^tr:/, '')] = true
        return { existed, progress }
      })
      if (!result.existed) throw new RouteError(404, '这张翻译卡不存在')
      return { ok: true, removed: key, progress: result.progress }
    },
  }
}
