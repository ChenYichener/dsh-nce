/**
 * Read-only adapter over the dsh-translate plugin's history file.
 *
 * The file is owned by another plugin; this module never writes it. Sentence
 * cards are snapshots taken by the application layer.
 *
 * @module host/infrastructure/translate-history
 */

import { readJsonFile } from './fs-utils.js'

/**
 * @param {{ translateHistoryFile: string }} config runtime config from `host/config.js`
 * @returns {import('../ports.js').TranslateHistorySource} history source
 */
export function createTranslateHistorySource(config) {
  const historyFile = config.translateHistoryFile

  /** Read the translate plugin's history file (read-only). */
  async function load() {
    let raw
    try {
      raw = await readJsonFile(historyFile)
    } catch (error) {
      return { available: error?.code !== 'ENOENT' ? true : false, records: [] }
    }
    const list = Array.isArray(raw?.records) ? raw.records : []
    const records = []
    const seen = new Set()
    for (const value of list) {
      if (value === null || typeof value !== 'object') continue
      const id = typeof value.id === 'string' ? value.id.trim() : ''
      const source = typeof value.source === 'string' ? value.source.trim() : ''
      const translation = typeof value.translation === 'string' ? value.translation.trim() : ''
      if (id === '' || source === '' || translation === '' || seen.has(id)) continue
      seen.add(id)
      records.push({
        id,
        createdAt: typeof value.createdAt === 'string' ? value.createdAt : '',
        direction: value.direction === 'zh-en' ? 'zh-en' : 'en-zh',
        study: value.study === true,
        source: source.slice(0, 500),
        translation: translation.slice(0, 500),
        notes: typeof value.notes === 'string' ? value.notes : '',
        examples: Array.isArray(value.examples) ? value.examples.filter((item) => typeof item === 'string').slice(0, 2) : [],
      })
    }
    return { available: true, records }
  }

  return { load }
}
