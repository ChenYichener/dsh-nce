/**
 * Read-only adapter over the bundled NCE dataset (`data/`).
 *
 * Files are immutable for the lifetime of the process, so each load is cached
 * as a promise; a rejected load is evicted so the next request retries.
 *
 * @module host/infrastructure/data-repository
 */

import path from 'node:path'
import { readJsonFile } from './fs-utils.js'

/**
 * @param {{ dataDir: string }} config runtime config from `host/config.js`
 * @returns {import('../ports.js').DataRepository} data adapter
 */
export function createDataRepository(config) {
  const dataDir = config.dataDir
  const dataCache = new Map()
  /** Build a key → word lookup over the word bank; cached. */
  let wordLookupPromise

  async function loadData(name) {
    const cached = dataCache.get(name)
    if (cached !== undefined) return cached
    const record = readJsonFile(path.join(dataDir, name)).then(
      (value) => value,
      (error) => {
        dataCache.delete(name)
        throw error
      },
    )
    dataCache.set(name, record)
    return record
  }

  async function loadIndex() {
    const index = await loadData('index.json')
    return index
  }

  async function loadLesson(id) {
    const file = `lessons/lesson-${String(id).padStart(3, '0')}.json`
    return loadData(file)
  }

  async function loadWordbank() {
    return loadData('wordbank.json')
  }

  async function loadPhonetics() {
    return loadData('phonetics.json')
  }

  function wordLookup() {
    if (wordLookupPromise === undefined) {
      wordLookupPromise = loadWordbank().then((bank) => {
        const map = new Map()
        const words = Array.isArray(bank?.words) ? bank.words : []
        for (const word of words) {
          if (word === null || typeof word !== 'object') continue
          const key = typeof word.key === 'string' && word.key !== '' ? word.key : String(word.word ?? '').trim().toLowerCase()
          if (key === '') continue
          map.set(key, word)
        }
        return map
      })
    }
    return wordLookupPromise
  }

  return { dir: dataDir, loadIndex, loadLesson, loadWordbank, loadPhonetics, wordLookup }
}
