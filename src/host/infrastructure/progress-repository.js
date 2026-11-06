/**
 * Progress persistence: SQLite via `node:sqlite`, with the legacy JSON file as
 * fallback (and one-time migration source / mirror).
 *
 * The DB is opened lazily on first access; a missing `node:sqlite` (older
 * Electron) or an unusable database silently keeps the JSON store. A corrupt
 * JSON file is renamed aside so it can never brick the panel.
 *
 * @module host/infrastructure/progress-repository
 */

import { promises as fs } from 'node:fs'
import { safeJson, readJsonFile, writeAtomic } from './fs-utils.js'
import { emptyProgress, normalizeProgress } from '../domain/progress.js'

const DB_SCHEMA_VERSION = 1
const DB_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS lessons (
    lesson_id INTEGER PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'learning',
    steps_json TEXT NOT NULL DEFAULT '{}',
    updated_at INTEGER NOT NULL DEFAULT 0,
    last_visit INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS words (
    word_key TEXT PRIMARY KEY,
    starred INTEGER NOT NULL DEFAULT 0,
    right_count INTEGER NOT NULL DEFAULT 0,
    wrong_count INTEGER NOT NULL DEFAULT 0,
    srs_json TEXT,
    updated_at INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS videos (lesson_id INTEGER PRIMARY KEY, url TEXT NOT NULL, updated_at INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS daily_history (day TEXT PRIMARY KEY, reviews INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS streak (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    last_day TEXT NOT NULL DEFAULT '',
    days INTEGER NOT NULL DEFAULT 0,
    total_days INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS translation_cards (
    key TEXT PRIMARY KEY,
    record_id TEXT NOT NULL,
    direction TEXT NOT NULL,
    source TEXT NOT NULL,
    translation TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    examples_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT '',
    added_at TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word_key TEXT NOT NULL,
    grade TEXT NOT NULL,
    created_at TEXT NOT NULL,
    due_before TEXT,
    due_after TEXT
  );
`

function readProgressDb(database) {
  const progress = emptyProgress()
  for (const row of database.prepare('SELECT lesson_id, status, steps_json, updated_at, last_visit FROM lessons').all()) {
    progress.lessons[String(row.lesson_id)] = {
      status: row.status === 'done' ? 'done' : 'learning',
      steps: safeJson(row.steps_json, {}),
      updatedAt: Number(row.updated_at) || 0,
      lastVisit: Number(row.last_visit) || 0,
    }
  }
  for (const row of database.prepare('SELECT word_key, starred, right_count, wrong_count, srs_json FROM words').all()) {
    const entry = {}
    if (Number(row.starred) === 1) entry.starred = true
    if (typeof row.srs_json === 'string' && row.srs_json !== '') {
      const srs = safeJson(row.srs_json, null)
      if (srs !== null && typeof srs === 'object') entry.srs = srs
    }
    if (Number(row.right_count) > 0) entry.right = Number(row.right_count)
    if (Number(row.wrong_count) > 0) entry.wrong = Number(row.wrong_count)
    if (Object.keys(entry).length > 0) progress.words[row.word_key] = entry
  }
  for (const row of database.prepare('SELECT lesson_id, url FROM videos').all()) {
    if (typeof row.url === 'string' && row.url !== '') progress.videos[String(row.lesson_id)] = row.url
  }
  for (const row of database.prepare('SELECT day, reviews FROM daily_history').all()) {
    progress.history[row.day] = Number(row.reviews) || 0
  }
  for (const row of database.prepare('SELECT * FROM translation_cards').all()) {
    progress.translations[row.key] = {
      recordId: row.record_id,
      direction: row.direction === 'zh-en' ? 'zh-en' : 'en-zh',
      source: row.source,
      translation: row.translation,
      notes: row.notes,
      examples: safeJson(row.examples_json, []),
      createdAt: row.created_at,
      addedAt: row.added_at,
    }
  }
  const streak = database.prepare('SELECT last_day, days, total_days FROM streak WHERE singleton = 1').get()
  if (streak !== undefined) {
    progress.streak = {
      lastDay: typeof streak.last_day === 'string' ? streak.last_day : '',
      days: Number(streak.days) || 0,
      totalDays: Number(streak.total_days) || 0,
    }
  }
  const updated = database.prepare("SELECT value FROM meta WHERE key = 'updated_at'").get()
  progress.updatedAt = updated === undefined ? 0 : Number(updated.value) || 0
  const dismissed = database.prepare("SELECT value FROM meta WHERE key = 'translate_dismissed'").get()
  progress.translateDismissed = dismissed === undefined ? {} : safeJson(dismissed.value, {})
  return normalizeProgress(progress)
}

function writeProgressDb(database, progress) {
  database.exec('BEGIN')
  try {
    database.exec('DELETE FROM lessons; DELETE FROM words; DELETE FROM videos; DELETE FROM daily_history; DELETE FROM translation_cards')
    const insertLesson = database.prepare('INSERT INTO lessons (lesson_id, status, steps_json, updated_at, last_visit) VALUES (?, ?, ?, ?, ?)')
    for (const [id, entry] of Object.entries(progress.lessons)) {
      insertLesson.run(Number(id), entry?.status === 'done' ? 'done' : 'learning', JSON.stringify(entry?.steps ?? {}), Number(entry?.updatedAt) || 0, Number(entry?.lastVisit) || 0)
    }
    const insertWord = database.prepare('INSERT INTO words (word_key, starred, right_count, wrong_count, srs_json, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    for (const [key, entry] of Object.entries(progress.words)) {
      insertWord.run(String(key), entry?.starred === true ? 1 : 0, Number(entry?.right) || 0, Number(entry?.wrong) || 0, entry?.srs ? JSON.stringify(entry.srs) : null, 0)
    }
    const insertVideo = database.prepare('INSERT INTO videos (lesson_id, url, updated_at) VALUES (?, ?, ?)')
    for (const [id, url] of Object.entries(progress.videos)) insertVideo.run(Number(id), String(url), 0)
    const insertHistory = database.prepare('INSERT INTO daily_history (day, reviews) VALUES (?, ?)')
    for (const [day, count] of Object.entries(progress.history)) insertHistory.run(String(day), Number(count) || 0)
    const insertTranslation = database.prepare(
      'INSERT INTO translation_cards (key, record_id, direction, source, translation, notes, examples_json, created_at, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    for (const [key, entry] of Object.entries(progress.translations ?? {})) {
      insertTranslation.run(
        key,
        String(entry.recordId ?? key.slice(3)),
        entry.direction === 'zh-en' ? 'zh-en' : 'en-zh',
        String(entry.source ?? ''),
        String(entry.translation ?? ''),
        String(entry.notes ?? ''),
        JSON.stringify(Array.isArray(entry.examples) ? entry.examples : []),
        String(entry.createdAt ?? ''),
        String(entry.addedAt ?? ''),
      )
    }
    database.prepare(
      'INSERT INTO streak (singleton, last_day, days, total_days) VALUES (1, ?, ?, ?) ON CONFLICT(singleton) DO UPDATE SET last_day = excluded.last_day, days = excluded.days, total_days = excluded.total_days',
    ).run(progress.streak?.lastDay ?? '', Number(progress.streak?.days) || 0, Number(progress.streak?.totalDays) || 0)
    const upsertMeta = database.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    upsertMeta.run('updated_at', String(progress.updatedAt ?? Date.now()))
    upsertMeta.run('schema_version', String(DB_SCHEMA_VERSION))
    upsertMeta.run('translate_dismissed', JSON.stringify(progress.translateDismissed ?? {}))
    database.exec('COMMIT')
  } catch (error) {
    try {
      database.exec('ROLLBACK')
    } catch {
      // The transaction may already be gone.
    }
    throw error
  }
}

/**
 * @param {{ stateDir: string, progressFile: string, dbFile: string }} config runtime config from `host/config.js`
 * @returns {import('../ports.js').ProgressRepository} persistence adapter
 */
export function createProgressRepository(config) {
  const stateDir = config.stateDir
  const progressFile = config.progressFile
  const dbFile = config.dbFile

  let db = null
  let dbLoadAttempted = false
  let storageMode = 'json'
  /** Serializes atomic write-behind of the latest JSON snapshot. */
  let progressWriteQueue = Promise.resolve()

  /** First open on a fresh profile: import the legacy JSON progress once. */
  async function migrateLegacyJson(database) {
    const existing = database.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()
    if (existing !== undefined) return
    let migrated = null
    try {
      migrated = normalizeProgress(await readJsonFile(progressFile))
    } catch {
      migrated = null
    }
    writeProgressDb(database, migrated ?? emptyProgress())
    if (migrated !== null) {
      try {
        await fs.rename(progressFile, `${progressFile}.migrated-${Date.now()}`)
      } catch {
        // Keeping the JSON file is harmless.
      }
    }
  }

  async function loadDatabase() {
    if (dbLoadAttempted) return db
    dbLoadAttempted = true
    try {
      const { DatabaseSync } = await import('node:sqlite')
      await fs.mkdir(stateDir, { recursive: true })
      db = new DatabaseSync(dbFile)
      db.exec('PRAGMA journal_mode = WAL;')
      db.exec('PRAGMA synchronous = NORMAL;')
      db.exec(DB_SCHEMA_SQL)
      await migrateLegacyJson(db)
      // The 计划/任务 feature is gone: old databases may still hold its table and
      // meta key. Drop them so no dead data lingers under the learning store.
      db.exec('DROP TABLE IF EXISTS tasks;')
      db.prepare("DELETE FROM meta WHERE key = 'plan'").run()
      storageMode = 'sqlite'
      return db
    } catch {
      // node:sqlite missing (older Electron) or the file is unusable: keep JSON.
      try {
        db?.close?.()
      } catch {
        // Ignore.
      }
      db = null
      storageMode = 'json'
      return null
    }
  }

  async function load() {
    const database = await loadDatabase()
    if (database !== null) {
      try {
        return readProgressDb(database)
      } catch {
        // A broken database should not block the panel; try the JSON fallback.
      }
    }
    try {
      const raw = await readJsonFile(progressFile)
      return normalizeProgress(raw)
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        // A corrupt file must not brick the panel; keep a backup and start fresh.
        try {
          await fs.rename(progressFile, `${progressFile}.corrupt-${Date.now()}`)
        } catch {
          // Best effort.
        }
      }
      return emptyProgress()
    }
  }

  async function save(progress) {
    if (db !== null && storageMode === 'sqlite') {
      try {
        writeProgressDb(db, progress)
        return
      } catch {
        // Fall through to the JSON mirror so a broken DB never loses a grade.
        storageMode = 'json'
      }
    }
    const snapshot = `${JSON.stringify(progress, null, 2)}\n`
    const write = () => writeAtomic(progressFile, snapshot)
    progressWriteQueue = progressWriteQueue.then(write, write)
    return progressWriteQueue
  }

  async function reset() {
    if (db === null || storageMode !== 'sqlite') return false
    try {
      db.exec('BEGIN; DELETE FROM lessons; DELETE FROM words; DELETE FROM videos; DELETE FROM daily_history; DELETE FROM reviews; DELETE FROM translation_cards; COMMIT;')
      db.prepare("INSERT INTO streak (singleton, last_day, days, total_days) VALUES (1, '', 0, 0) ON CONFLICT(singleton) DO UPDATE SET last_day = '', days = 0, total_days = 0").run()
      db.prepare("INSERT INTO meta (key, value) VALUES ('updated_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(Date.now()))
      return true
    } catch {
      return false
    }
  }

  /** Append one review event (used for stats later; best effort). */
  function recordReview(wordKey, grade, dueBefore, dueAfter) {
    if (db === null || storageMode !== 'sqlite') return
    try {
      db.prepare('INSERT INTO reviews (word_key, grade, created_at, due_before, due_after) VALUES (?, ?, ?, ?, ?)')
        .run(wordKey, grade, new Date().toISOString(), dueBefore ?? null, dueAfter ?? null)
    } catch {
      // Review logging must never break grading.
    }
  }

  function storageInfo() {
    return {
      mode: storageMode,
      file: storageMode === 'sqlite' ? dbFile : progressFile,
      legacyFile: progressFile,
      dbFile,
    }
  }

  return {
    async ensureReady() {
      await loadDatabase()
    },
    load,
    save,
    reset,
    recordReview,
    get storageMode() {
      return storageMode
    },
    storageInfo,
  }
}
