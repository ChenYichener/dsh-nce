/**
 * Host-API smoke test: mounts the plugin onto a fake ctx, calls every route
 * through the real handler and checks the JSON contract. Progress is written
 * under the current HOME, so run it isolated:
 *
 *   HOME=$(mktemp -d) node scripts/smoke-api.mjs
 */
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Seed a legacy JSON progress file first so the smoke run also covers the
// one-time migration into SQLite.
const stateDir = path.join(os.homedir(), '.dsh', 'dsh-nce')
await fs.mkdir(stateDir, { recursive: true })
await fs.writeFile(path.join(stateDir, 'progress.json'), JSON.stringify({
  version: 1,
  updatedAt: 123,
  streak: { lastDay: '2026-11-03', days: 2, totalDays: 2 },
  history: { '2026-11-03': 5 },
  lessons: { 1: { status: 'learning', steps: { words: true }, updatedAt: 11, lastVisit: 11 } },
  words: {},
  videos: {},
}, null, 2))

// Seed a tiny translate-plugin history so the bridge can be tested offline.
const translateDir = path.join(os.homedir(), '.dsh', 'dsh-translate')
await fs.mkdir(translateDir, { recursive: true })
await fs.writeFile(path.join(translateDir, 'history.json'), JSON.stringify({
  version: 1,
  records: [
    {
      id: 't1',
      createdAt: new Date().toISOString(),
      direction: 'en-zh',
      study: true,
      source: 'a little',
      translation: '一点；少量',
      notes: '- a little：一点；少量，修饰不可数名词。',
      examples: ['I am a little tired. — 我有点累。'],
    },
    {
      id: 't2',
      createdAt: new Date().toISOString(),
      direction: 'zh-en',
      study: true,
      source: '我该怎么使用它？',
      translation: 'How can I use it?',
      notes: '',
      examples: [],
    },
  ],
}, null, 2))

const { apply } = await import('../index.js')

let handler = null
const routes = new Map()
const ctx = {
  webServer: {
    register(config) {
      routes.set(config.path, config.handler)
      if (config.path === '/dsh-nce/api') handler = config.handler
      return () => {
        routes.delete(config.path)
        if (config.path === '/dsh-nce/api') handler = null
      }
    },
  },
  effect(fn) {
    return fn()
  },
  /** Optional services (llm/default model) are absent in this harness. */
  get() {
    return undefined
  },
}
apply(ctx)
assert.ok(typeof handler === 'function', 'apply() did not register a route handler')

const HOST = '127.0.0.1:49571'

function call(operation, payload) {
  const text = JSON.stringify(payload ?? {})
  return new Promise((resolve, reject) => {
    const req = {
      method: 'POST',
      url: `/dsh-nce/api/${operation}`,
      headers: {
        host: HOST,
        origin: `http://${HOST}`,
        'content-type': 'application/json',
        'content-length': String(Buffer.byteLength(text)),
      },
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(text)
      },
    }
    const result = { status: 0, headers: null, buffer: null, json: null }
    const res = {
      writableEnded: false,
      get headersSent() {
        return result.status !== 0
      },
      writeHead(status, headers) {
        result.status = status
        result.headers = headers
      },
      end(body) {
        result.buffer = body
        result.writableEnded = true
        if (typeof body === 'string' || Buffer.isBuffer(body)) {
          try {
            result.json = JSON.parse(String(body))
          } catch {
            result.json = null
          }
        }
        resolve(result)
      },
    }
    Promise.resolve(handler(req, res)).catch(reject)
  })
}

async function expectOk(operation, payload) {
  const response = await call(operation, payload)
  assert.equal(response.status, 200, `${operation} status ${response.status}: ${String(response.buffer).slice(0, 200)}`)
  assert.equal(response.json?.ok, true, `${operation} did not answer ok:true`)
  return response.json
}

const checks = []
async function check(name, run) {
  try {
    await run()
    checks.push({ name, ok: true })
    console.log(`PASS  ${name}`)
  } catch (error) {
    checks.push({ name, ok: false, error })
    console.error(`FAIL  ${name}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

await check('info + sqlite migration', async () => {
  const data = await expectOk('info')
  assert.equal(data.book.lessonCount, 144)
  assert.ok(data.wordCount > 500, `wordCount ${data.wordCount}`)
  assert.equal(data.storage.mode, 'sqlite', 'storage should be sqlite on Node 24')
  assert.ok(data.storage.file.endsWith('nce.sqlite'))
  const files = await fs.readdir(stateDir)
  assert.ok(files.includes('nce.sqlite'), `files: ${files.join(',')}`)
  assert.ok(files.some((name) => name.startsWith('progress.json.migrated-')), `legacy JSON should be renamed: ${files.join(',')}`)
})

await check('translate history is readable', async () => {
  const data = await expectOk('translate/list', { syncTranslate: false })
  assert.equal(data.available, true)
  assert.equal(data.total, 2)
  assert.ok(data.records.some((record) => record.id === 't1' && record.added === false))
})

await check('legacy JSON migrated into sqlite', async () => {
  const data = await expectOk('progress')
  assert.equal(data.progress.lessons['1'].steps.words, true)
  assert.equal(data.progress.streak.days, 2)
  assert.equal(data.progress.history['2026-11-03'], 5)
})

await check('index', async () => {
  const data = await expectOk('index')
  assert.equal(data.index.lessons.length, 144)
  assert.equal(data.index.groups.length, 4)
})

await check('lesson 1', async () => {
  const data = await expectOk('lesson', { id: 1 })
  assert.equal(data.lesson.id, 1)
  assert.ok(data.lesson.dialogue.length > 0)
  assert.ok(Array.isArray(data.lesson.vocab))
})

await check('lesson 72 (multi-page)', async () => {
  const data = await expectOk('lesson', { id: 72 })
  assert.equal(data.lesson.id, 72)
})

await check('lesson invalid id', async () => {
  const response = await call('lesson', { id: 999 })
  assert.equal(response.status, 400)
})

await check('wordbank', async () => {
  const data = await expectOk('wordbank')
  assert.ok(data.wordbank.words.length > 500)
  assert.ok(Array.isArray(data.wordbank.words[0].lessons))
})

await check('phonetics', async () => {
  const data = await expectOk('phonetics')
  assert.ok(Array.isArray(data.phonetics.phonemes))
  assert.ok(data.phonetics.phonemes.length >= 40)
})

await check('progress defaults', async () => {
  const data = await expectOk('progress')
  assert.equal(data.progress.version, 1)
})

await check('lesson/status', async () => {
  const data = await expectOk('lesson/status', { id: 2, steps: { words: true } })
  assert.equal(data.lesson.steps.words, true)
  const after = await expectOk('progress')
  assert.equal(after.progress.lessons['2'].steps.words, true)
})

await check('video/save + clear', async () => {
  const saved = await expectOk('video/save', { id: 2, url: 'https://www.bilibili.com/video/BV1xx411c7mD' })
  assert.equal(saved.video, 'https://www.bilibili.com/video/BV1xx411c7mD')
  const lesson = await expectOk('lesson', { id: 2 })
  assert.equal(lesson.lesson.video, saved.video)
  const invalid = await call('video/save', { id: 2, url: 'javascript:alert(1)' })
  assert.equal(invalid.status, 400)
})

await check('word/star', async () => {
  await expectOk('word/star', { key: 'handbag', starred: true })
  const data = await expectOk('progress')
  assert.equal(data.progress.words.handbag.starred, true)
})

await check('review/queue', async () => {
  const data = await expectOk('review/queue', { limitNew: 5, limitTranslationNew: 2 })
  assert.ok(data.queue.filter((item) => item.isNew === true && item.kind === 'word').length <= 5)
  assert.ok(data.queue.filter((item) => item.isNew === true && item.kind === 'translation').length <= 2)
  assert.ok(data.newCount > 0)
  assert.ok(data.queue.every((item) => typeof item.key === 'string' && item.word !== ''))
  assert.equal(typeof data.counts, 'object')
  assert.ok(Number(data.counts.new) > 0, 'Anki deck counts: new')
  assert.equal(Number(data.counts.learning), 0)
  const progress = await expectOk('progress')
  assert.equal(Object.keys(progress.progress.translations).length, 2, 'translations auto-imported')
})

await check('new cards only from started lessons', async () => {
  const data = await expectOk('review/queue', { limitNew: 50 })
  assert.deepEqual(data.unlocked.lessons, [1, 2])
  assert.ok(data.counts.lockedNew > 0, 'there should be locked new words')
  assert.ok(data.counts.new < data.counts.total)
  for (const item of data.queue.filter((entry) => entry.isNew === true && entry.kind === 'word')) {
    assert.ok(item.lessons.some((id) => id === 1 || id === 2), `locked new card leaked: ${item.word}`)
  }
})

await check('includeLocked can look ahead', async () => {
  const all = await expectOk('review/queue', { limitNew: 50, includeLocked: true })
  assert.equal(Number(all.unlocked.lockedNew), 0)
  const gated = await expectOk('review/queue', { limitNew: 50 })
  assert.ok(Number(all.counts.new) > Number(gated.counts.new))
})

await check('starting a lesson unlocks its words', async () => {
  await expectOk('lesson/status', { id: 3, steps: { words: true } })
  const data = await expectOk('review/queue', { limitNew: 50 })
  assert.ok(data.unlocked.lessons.includes(3))
  assert.ok(data.counts.new > 0)
  for (const item of data.queue.filter((entry) => entry.isNew === true && entry.kind === 'word')) {
    assert.ok(item.lessons.some((id) => id <= 3), `card before frontier leaked: ${item.word}`)
  }
})

await check('lesson status can be switched freely', async () => {
  const unseen = await expectOk('lesson/status', { id: 3, status: 'unseen' })
  assert.equal(unseen.lesson.status, 'unseen')
  assert.equal(unseen.progress.lessons['3'], undefined)
  const learning = await expectOk('lesson/status', { id: 3, status: 'learning' })
  assert.equal(learning.lesson.status, 'learning')
  const done = await expectOk('lesson/status', { id: 3, status: 'done' })
  assert.equal(done.lesson.status, 'done')
  assert.equal(done.progress.lessons['3'].status, 'done')
})

await check('review/grade', async () => {
  const queue = await expectOk('review/queue', { limitNew: 5 })
  const first = queue.queue.find((item) => item.kind === 'word') ?? queue.queue[0]
  assert.ok(first !== undefined, 'empty review queue')
  const result = await expectOk('review/grade', { key: first.key, grade: 'good' })
  assert.equal(result.card.state, 2)
  assert.ok(result.card.scheduledDays >= 1)
  const progress = await expectOk('progress')
  assert.ok(progress.progress.words[first.key].srs.reps >= 1)
  const invalid = await call('review/grade', { key: first.key, grade: 'nope' })
  assert.equal(invalid.status, 400)
})

await check('review/answer', async () => {
  const data = await expectOk('review/answer', { key: 'handbag', correct: false })
  assert.equal(data.ok, true)
})

await check('translation cards auto-sync into the queue', async () => {
  const list = await expectOk('translate/list')
  assert.equal(list.addedCount, 2, 'both history records should be auto-added')
  const progress = await expectOk('progress')
  assert.equal(progress.progress.translations['tr:t1'].source, 'a little')
  const queue = await expectOk('review/queue', { limitNew: 5, limitTranslationNew: 3 })
  const card = queue.queue.find((item) => item.kind === 'translation')
  assert.ok(card !== undefined, 'translation card missing from queue')
  assert.equal(card.word, 'a little')
  assert.equal(card.meaning, '一点；少量')
  assert.equal(card.isNew, true)
  const graded = await expectOk('review/grade', { key: 'tr:t1', grade: 'good' })
  assert.equal(graded.card.state, 2)
  // Removing hides it from reviews and stops auto-sync from re-adding it.
  const removed = await expectOk('translate/remove', { id: 't1' })
  assert.equal(removed.removed, 'tr:t1')
  const after = await expectOk('progress')
  assert.equal(after.progress.translations['tr:t1'], undefined)
  assert.equal(after.progress.words['tr:t1'], undefined)
  assert.equal(after.progress.translateDismissed.t1, true)
  const relisted = await expectOk('translate/list')
  assert.equal(relisted.records.find((record) => record.id === 't1').added, false)
  // Manually adding clears the dismissed flag again.
  const readded = await expectOk('translate/add', { id: 't1' })
  assert.deepEqual(readded.added, ['tr:t1'])
})

await check('SQLite review log records grades', async () => {
  let DatabaseSync
  try {
    ;({ DatabaseSync } = await import('node:sqlite'))
  } catch {
    return
  }
  const db = new DatabaseSync(path.join(stateDir, 'nce.sqlite'))
  try {
    const row = db.prepare('SELECT COUNT(*) AS count FROM reviews').get()
    assert.ok(Number(row.count) >= 1, `review rows: ${row.count}`)
  } finally {
    db.close()
  }
})

await check('progress/reset clears sqlite', async () => {
  const reset = await expectOk('progress/reset', { confirm: 'reset' })
  assert.equal(reset.storage, 'sqlite')
  const data = await expectOk('progress')
  assert.deepEqual(data.progress.lessons, {})
  assert.deepEqual(data.progress.words, {})
  assert.deepEqual(data.progress.translations, {})
  assert.equal(data.progress.plan, undefined)
  assert.equal(data.progress.tasks, undefined)
  assert.equal(data.progress.streak.days, 0)
})

await check('cross-site request is refused', async () => {
  const text = '{}'
  const response = await new Promise((resolve, reject) => {
    const req = {
      method: 'POST',
      url: '/dsh-nce/api/info',
      headers: { host: HOST, origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(text)
      },
    }
    const res = {
      writableEnded: false,
      headersSent: false,
      writeHead(status) {
        res.status = status
      },
      end(body) {
        resolve({ status: res.status, body: String(body) })
      },
    }
    Promise.resolve(handler(req, res)).catch(reject)
  })
  assert.equal(response.status, 403)
})

await check('paper/explain is mounted but needs a default model here', async () => {
  const response = await call('paper/explain', { prompt: 'Is this your handbag?' })
  assert.equal(response.status, 503)
  assert.ok(String(response.json?.error ?? '').includes('默认模型'))
})

await check('removed plan/task operations are gone', async () => {
  for (const operation of ['badge', 'tasks', 'tasks/add', 'tasks/toggle', 'tasks/remove', 'plan/settings', 'suggest']) {
    const response = await call(operation, {})
    assert.equal(response.status, 404, `${operation} should be gone (got ${response.status})`)
  }
})

await check('bad operation is 404', async () => {
  const response = await call('nope', {})
  assert.equal(response.status, 404)
})

await check('tts validates its payload before touching the renderer', async () => {
  const empty = await call('tts', { text: '' })
  assert.equal(empty.status, 400)
  assert.match(empty.json.error, /缺少要朗读的文本/)
  const tooLong = await call('tts', { text: 'a'.repeat(301) })
  assert.equal(tooLong.status, 400)
  assert.match(tooLong.json.error, /最多 300 字/)
})

const failed = checks.filter((item) => !item.ok)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
if (failed.length > 0) process.exit(1)
