/**
 * AI-teacher grading tests (host half).
 *
 * The prompt/parse helpers are pure domain code in
 * `src/host/domain/ai-grade.js`, imported directly here so they can be tested
 * without a host, a model provider or any network access. The browser half
 * calls the same route (`POST /dsh-nce/api/paper/grade`), so the payload
 * contract is checked here: only answered questions with a prompt get graded,
 * and the model's JSON reply is never trusted blindly (unknown ids / verdicts
 * are dropped). The last block mounts the real plugin to check the route
 * integration end to end against a fake model.
 *
 * Usage: node scripts/test-ai-grade.mjs
 */
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  AI_GRADE_MAX_ITEMS,
  aiGradeSystemPrompt,
  aiGradeUserPrompt,
  cleanAiGradeItems,
  parseAiGrades,
} from '../src/host/domain/ai-grade.js'

/** Error factory the pure domain module gets injected (mirrors the host's RouteError). */
function fail(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

const failures = []
let checks = 0
function check(name, condition, detail) {
  checks += 1
  if (!condition) failures.push(`${name}${detail === undefined ? '' : ` — ${detail}`}`)
}
function equal(name, actual, expected) {
  check(name, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

// ---------------------------------------------------------------------------
// 1. Request payload: trim, drop unusable rows, cap the batch
// ---------------------------------------------------------------------------
{
  const items = cleanAiGradeItems([
    { id: ' ex:0:0 ', prompt: '  Mr. Blake isn\'t a student. ___ a teacher.  ', answer: " He's ", group: ' A ', example: ' Robert ... He\'s an engineer. ', reference: ' He is a teacher. ' },
    { id: 'ex:0:1', prompt: 'This isn\'t my umbrella. ___ your umbrella.', answer: "It's" },
    { id: 'ex:0:1', prompt: 'dup id', answer: "It's" },
    { id: '', prompt: 'no id', answer: 'x' },
    { id: 'ex:0:2', prompt: '', answer: 'She\'s' },
    { id: 'ex:0:3', prompt: 'Sophie isn\'t a teacher. ___ a keyboard operator.', answer: 'She\'s' },
  ], fail)
  equal('clean: keeps only usable rows', items.length, 3)
  equal('clean: trims id', items[0].id, 'ex:0:0')
  equal('clean: trims prompt', items[0].prompt, "Mr. Blake isn't a student. ___ a teacher.")
  equal('clean: trims answer', items[0].answer, "He's")
  equal('clean: trims group', items[0].group, 'A')
  equal('clean: trims example', items[0].example, "Robert ... He's an engineer.")
  equal('clean: trims answer-book reference', items[0].reference, 'He is a teacher.')
  equal('clean: reference defaults to empty', items[1].reference, '')
  equal('clean: second usable row', items[1].id, 'ex:0:1')
  equal('clean: drops duplicate id', items.filter((item) => item.id === 'ex:0:1').length, 1)
  equal('clean: third usable row', items[2].id, 'ex:0:3')

  const long = cleanAiGradeItems([{ id: 'ex:0:0', prompt: 'p'.repeat(900), answer: 'a'.repeat(900), group: 'g'.repeat(300), example: 'e'.repeat(500), reference: 'r'.repeat(900) }], fail)
  equal('clean: prompt clipped', long[0].prompt.length, 500)
  equal('clean: answer clipped', long[0].answer.length, 500)
  equal('clean: group clipped', long[0].group.length, 160)
  equal('clean: example clipped', long[0].example.length, 400)
  equal('clean: reference clipped', long[0].reference.length, 400)

  const many = Array.from({ length: 50 }, (_, index) => ({ id: `q${index}`, prompt: 'p', answer: 'a' }))
  equal('clean: batch capped', cleanAiGradeItems(many, fail).length, AI_GRADE_MAX_ITEMS)
  check('clean: cap is 30', AI_GRADE_MAX_ITEMS === 30)

  for (const [name, value] of [['non-array', 'nope'], ['empty', []], ['all unusable', [{ id: '', answer: 'x' }]]]) {
    let error = null
    try {
      cleanAiGradeItems(value, fail)
    } catch (failure) {
      error = failure
    }
    check(`clean: rejects ${name}`, error !== null && error.status === 400, error === null ? 'no error' : error.message)
  }
}

// ---------------------------------------------------------------------------
// 2. Model reply: strict JSON, tolerant tokens, no hallucinated ids
// ---------------------------------------------------------------------------
{
  const requested = [
    { id: 'ex:0:0', prompt: 'p0', answer: 'a0' },
    { id: 'ex:0:1', prompt: 'p1', answer: 'a1' },
    { id: 'ex:0:2', prompt: 'p2', answer: 'a2' },
  ]
  const reply = [
    '好的，批改如下：',
    '{"items":[',
    '{"id":"ex:0:0","verdict":"correct","comment":"很好","answer":"He is"},',
    '{"id":"ex:0:1","verdict":"right","comment":" 缩写也对 ","answer":"It is"},',
    '{"id":"ex:0:2","verdict":"incorrect","comment":"主谓不一致","answer":"She is"},',
    '{"id":"ex:9:9","verdict":"wrong","comment":"编造的题","answer":"x"},',
    '{"id":"ex:0:0","verdict":"wrong","comment":"重复","answer":"y"},',
    '{"id":"ex:0:1","verdict":"maybe","comment":"乱码","answer":"z"}',
    ']}',
  ].join('\n')
  const graded = parseAiGrades(reply, requested)
  equal('parse: keeps valid rows', graded.length, 3)
  equal('parse: correct verdict', graded[0].verdict, 'correct')
  equal('parse: right alias', graded[1].verdict, 'correct')
  equal('parse: trims comment', graded[1].comment, '缩写也对')
  equal('parse: incorrect alias', graded[2].verdict, 'wrong')
  equal('parse: renamed verdict', graded[2].comment, '主谓不一致')
  equal('parse: drops unknown id', graded.some((row) => row.id === 'ex:9:9'), false)
  equal('parse: drops duplicate id', graded.filter((row) => row.id === 'ex:0:0').length, 1)

  const closeReply = '{"items":[{"id":"ex:0:0","verdict":"partial","comment":"","answer":""}]}'
  equal('parse: partial alias', parseAiGrades(closeReply, requested)[0].verdict, 'close')

  const longReply = `{"items":[{"id":"ex:0:0","verdict":"correct","comment":"${'c'.repeat(400)}","answer":"${'a'.repeat(600)}"}]}`
  const longRow = parseAiGrades(longReply, requested)[0]
  equal('parse: comment clipped', longRow.comment.length, 160)
  equal('parse: answer clipped', longRow.answer.length, 300)

  equal('parse: garbage returns null', parseAiGrades('完全不是 JSON', requested), null)
  equal('parse: empty rows returns null', parseAiGrades('{"items":[]}', requested), null)
  equal('parse: all rows unknown returns null', parseAiGrades('{"items":[{"id":"nope","verdict":"correct"}]}', requested), null)

  // The preferred output shape: one JSON object per line, no outer array.
  const lineReply = [
    '{"id":"ex:0:0","verdict":"correct","comment":"很好","answer":"He is"}',
    '{"id":"ex:0:1","verdict":"close","comment":"注意缩写","answer":"It is"}',
    '{"id":"ex:0:2","verdict":"wrong","comment":"主谓不一致","answer":"She is"}',
  ].join('\n')
  equal('parse: line-delimited rows', parseAiGrades(lineReply, requested).length, 3)

  // Chinese field names / verdict words a model may slip in.
  const chineseReply = '{"题号":"ex:0:0","判定":"正确","点评":"很好","参考答案":"He is"}'
  const chineseRow = parseAiGrades(chineseReply, requested)[0]
  equal('parse: chinese verdict', chineseRow.verdict, 'correct')
  equal('parse: chinese comment field', chineseRow.comment, '很好')
  equal('parse: chinese answer field', chineseRow.answer, 'He is')
  equal('parse: chinese wrong verdict', parseAiGrades('{"id":"ex:0:0","verdict":"不正确"}', requested)[0].verdict, 'wrong')

  // Printed question numbers map to the requested ids in order.
  const numberedReply = [
    '{"id":"1","verdict":"correct","comment":"a","answer":"He is"}',
    '{"id":"2","verdict":"close","comment":"b","answer":"It is"}',
    '{"id":"3","verdict":"wrong","comment":"c","answer":"She is"}',
  ].join('\n')
  equal('parse: numeric ids map in order', parseAiGrades(numberedReply, requested).map((row) => row.id).join(','), 'ex:0:0,ex:0:1,ex:0:2')

  // Rows without any id: only an exact count match allows an order fallback.
  const noIdReply = [
    '{"verdict":"correct","comment":"a","answer":"He is"}',
    '{"verdict":"wrong","comment":"b","answer":"It is"}',
    '{"verdict":"close","comment":"c","answer":"She is"}',
  ].join('\n')
  const noIdRows = parseAiGrades(noIdReply, requested)
  equal('parse: missing ids fall back to order', noIdRows.map((row) => row.id).join(','), 'ex:0:0,ex:0:1,ex:0:2')
  equal('parse: no-id fallback needs a full batch', parseAiGrades('{"verdict":"correct","comment":"a"}', requested), null)

  // A truncated outer JSON object still yields its complete rows.
  const truncated = '{"items":[{"id":"ex:0:0","verdict":"correct","comment":"a","answer":"He is"},{"id":"ex:0:1","verdict":"close","comment":"b","answer":"It is"}'
  const truncatedRows = parseAiGrades(truncated, requested)
  equal('parse: truncated output keeps complete rows', truncatedRows?.length, 2)

  // Common wrappers: data.items / bare array.
  equal('parse: nested data wrapper', parseAiGrades('{"data":{"items":[{"id":"ex:0:0","verdict":"correct"}]}}', requested)[0].id, 'ex:0:0')
  equal('parse: bare array wrapper', parseAiGrades('[{"id":"ex:0:1","verdict":"wrong"}]', requested)[0].verdict, 'wrong')
}

// ---------------------------------------------------------------------------
// 3. Prompts carry exactly what the teacher needs
// ---------------------------------------------------------------------------
{
  const lesson = { id: 10, titleEn: 'Look at...' }
  const items = [
    { id: 'ex:0:0', prompt: "Mr. Blake isn't a student. ___ a teacher.", answer: "He's", group: 'A Complete these sentences using He\'s, She\'s or It\'s.', example: "Robert isn't a teacher. ___ an engineer. → Robert isn't a teacher. He's an engineer." },
    { id: 'ex:0:1', prompt: "This isn't my umbrella. ___ your umbrella.", answer: "It's", group: 'A', example: '', reference: "It is not my umbrella. / It isn't my umbrella." },
  ]
  const prompt = aiGradeUserPrompt(lesson, items)
  check('prompt: names the lesson', prompt.includes('第 10 课') && prompt.includes('Look at...'), prompt.slice(0, 80))
  check('prompt: carries question ids', prompt.includes('id=ex:0:0') && prompt.includes('id=ex:0:1'))
  check('prompt: carries prompts and answers', prompt.includes("Mr. Blake isn't a student. ___ a teacher.") && prompt.includes("学生答案：He's"))
  check('prompt: carries the book context only when present', prompt.includes('本组上下文：Robert') && prompt.split('本组上下文：').length === 2)
  check('prompt: carries the answer-book reference only when present', prompt.includes('答案册参考：It is not my umbrella') && prompt.split('答案册参考：').length === 2)
  check('prompt: counts the batch', prompt.includes('共 2 题'))

  const system = aiGradeSystemPrompt()
  check('system: asks for one JSON object per line', system.includes('每行一个 JSON 对象') && system.includes('不要外层数组'))
  check('system: grades the whole sheet', system.includes('整张'))
  check('system: uses the answer-book key when present', system.includes('答案册') && system.includes('以答案册为准'))
  check('system: explains matching-letter grading', system.includes('配对题') && system.includes('字母集合'))
  check('system: defines all three verdicts', ['correct', 'close', 'wrong'].every((verdict) => system.includes(verdict)))
  check('system: asks for a Chinese comment', system.includes('中文') && system.includes('comment'))
  check('prompt: asks the model to echo ids', prompt.includes('原样复制这个 id'))
}

// ---------------------------------------------------------------------------
// 4. Route integration: real apply()/handler, fake host, fake model
// ---------------------------------------------------------------------------
{
  const { apply } = await import('../index.js')
  const HOST = '127.0.0.1:49572'
  const calls = []

  function makeCtx(model) {
    return {
      webServer: {
        register(config) {
          return () => {}
        },
      },
      effect(fn) {
        return fn()
      },
      get(name) {
        if (name === 'llm' && model !== null) return model
        if (name === 'agentDefaultModel' && model !== null) {
          return { currentSelection: () => ({ provider: 'fake-provider', model: 'fake-model' }) }
        }
        return undefined
      },
    }
  }

  function mount(ctx) {
    let handler = null
    const register = ctx.webServer.register
    // Capture the handler without changing the ctx.get contract.
    ctx.webServer.register = (config) => {
      handler = config.handler
      return register(config)
    }
    apply(ctx)
    return handler
  }

  function call(handler, operation, payload) {
    const body = JSON.stringify(payload ?? {})
    return new Promise((resolve, reject) => {
      const req = {
        method: 'POST',
        url: `/dsh-nce/api/${operation}`,
        headers: {
          host: HOST,
          origin: `http://${HOST}`,
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(body)),
        },
        async *[Symbol.asyncIterator]() {
          yield Buffer.from(body)
        },
      }
      const result = { status: 0, json: null }
      const res = {
        writableEnded: false,
        get headersSent() { return result.status !== 0 },
        writeHead(status) { result.status = status },
        end(buffer) {
          result.writableEnded = true
          try { result.json = JSON.parse(String(buffer)) } catch { result.json = null }
          resolve(result)
        },
      }
      Promise.resolve(handler(req, res)).catch(reject)
    })
  }

  const fakeModel = {
    stream(options) {
      calls.push(options)
      const reply = JSON.stringify({
        items: [
          { id: 'ex:0:0', verdict: 'correct', comment: '很好', answer: "He's" },
          { id: 'ex:0:1', verdict: 'close', comment: '差一点', answer: "It's" },
        ],
      })
      return (async function* () {
        yield { type: 'text-delta', text: `好的：${reply}` }
        yield { type: 'finish' }
      })()
    },
  }
  const handler = mount(makeCtx(fakeModel))
  check('route: handler mounted', typeof handler === 'function')

  const payload = {
    lessonId: 10,
    items: [
      { id: 'ex:0:0', prompt: "Mr. Blake isn't a student. ___ a teacher.", answer: "He's", group: 'A', example: '' },
      { id: 'ex:0:1', prompt: "This isn't my umbrella. ___ your umbrella.", answer: "It's", group: 'A', example: '', reference: "It is not my umbrella. / It isn't my umbrella." },
    ],
  }
  const graded = await call(handler, 'paper/grade', payload)
  equal('route: 200', graded.status, 200)
  equal('route: ok', graded.json?.ok, true)
  equal('route: model echoed', graded.json?.model, 'fake-model')
  equal('route: two verdicts', graded.json?.items?.length, 2)
  equal('route: verdict parsed', graded.json?.items?.[1]?.verdict, 'close')
  equal('route: prompt reached the model', calls.length, 1)
  check('route: prompt has the answer + example slot', calls[0]?.messages?.[0]?.content?.[0]?.text?.includes('学生答案：'), 'prompt body missing')
  check('route: system prompt is the teacher prompt', String(calls[0]?.system ?? '').includes('批改'), 'system prompt missing')
  equal('route: no-thinking, single model call', calls[0]?.reasoningEffort, 'off')

  const cached = await call(handler, 'paper/grade', payload)
  equal('route: cache hits', cached.json?.cached, true)
  equal('route: cache avoids a second model call', calls.length, 1)

  const badLesson = await call(handler, 'paper/grade', { lessonId: 999, items: payload.items })
  equal('route: invalid lesson 400', badLesson.status, 400)
  const noItems = await call(handler, 'paper/grade', { lessonId: 10, items: [] })
  equal('route: empty items 400', noItems.status, 400)

  const noModelHandler = mount(makeCtx(null))
  const noModel = await call(noModelHandler, 'paper/grade', {
    lessonId: 11,
    items: [{ id: 'ex:0:0', prompt: 'x ___ y', answer: 'z' }],
  })
  equal('route: missing model 503', noModel.status, 503)
  check('route: missing model says why', String(noModel.json?.error ?? '').includes('默认模型'), String(noModel.json?.error))

  // One repair round trip: prose reply first, the model then reformats its own output.
  const repairReplies = [
    '我逐题看过了，但这轮先不按 JSON 输出：第一题对，第二题缩写要注意。',
    '{"id":"ex:0:0","verdict":"correct","comment":"很好","answer":"He is"}\n{"id":"ex:0:1","verdict":"wrong","comment":"注意缩写","answer":"It is"}',
  ]
  const repairCalls = []
  const repairModel = {
    stream(options) {
      repairCalls.push(options)
      const text = repairReplies[Math.min(repairCalls.length - 1, repairReplies.length - 1)]
      return (async function* () {
        yield { type: 'text-delta', text }
        yield { type: 'finish' }
      })()
    },
  }
  const repairHandler = mount(makeCtx(repairModel))
  const repaired = await call(repairHandler, 'paper/grade', {
    lessonId: 12,
    items: [
      { id: 'ex:0:0', prompt: 'p0 ___', answer: 'a0' },
      { id: 'ex:0:1', prompt: 'p1 ___', answer: 'a1' },
    ],
  })
  equal('route: repair round trip 200', repaired.status, 200)
  equal('route: repair flag', repaired.json?.repaired, true)
  equal('route: repair parsed rows', repaired.json?.items?.length, 2)
  equal('route: repair used two model calls', repairCalls.length, 2)
  check('route: repair prompt carries the raw output', String(repairCalls[1]?.messages?.[0]?.content?.[0]?.text ?? '').includes('第一题对'), 'repair prompt missing raw output')

  // Both the reply and its repair are unusable → 502 with a raw snippet + debug file.
  const failModel = {
    stream() {
      return (async function* () {
        yield { type: 'text-delta', text: '完全不按格式' }
        yield { type: 'finish' }
      })()
    },
  }
  const failHandler = mount(makeCtx(failModel))
  const failed = await call(failHandler, 'paper/grade', {
    lessonId: 13,
    items: [{ id: 'ex:0:0', prompt: 'p ___', answer: 'a' }],
  })
  equal('route: unparseable reply 502', failed.status, 502)
  check('route: error shows a raw snippet', String(failed.json?.error ?? '').includes('模型输出开头'), String(failed.json?.error))
  const debugFile = path.join(os.homedir(), '.dsh', 'dsh-nce', 'ai-grade-last-failure.json')
  let debug = null
  try {
    debug = JSON.parse(await fs.readFile(debugFile, 'utf8'))
  } catch {
    debug = null
  }
  check('route: failure saved for diagnosis', debug !== null && debug.lessonId === 13 && String(debug.output).includes('完全不按格式'), debug === null ? 'no debug file' : JSON.stringify(debug).slice(0, 120))
  try {
    await fs.unlink(debugFile)
  } catch {
    // Best effort cleanup.
  }

  // A tool-call / length / error finish yields no text at all: say why.
  const emptyModel = {
    stream() {
      return (async function* () {
        yield { type: 'finish', reason: 'tool-calls' }
      })()
    },
  }
  const emptyHandler = mount(makeCtx(emptyModel))
  const empty = await call(emptyHandler, 'paper/grade', {
    lessonId: 14,
    items: [{ id: 'ex:0:0', prompt: 'p ___', answer: 'a' }],
  })
  equal('route: empty text 502', empty.status, 502)
  check('route: empty text names the finish reason', String(empty.json?.error ?? '').includes('tool-calls'), String(empty.json?.error))
  try {
    await fs.unlink(debugFile)
  } catch {
    // Best effort cleanup.
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
if (failures.length > 0) {
  console.error(`test-ai-grade: ${failures.length} failure(s)`)
  for (const failure of failures) console.error(`  ✗ ${failure}`)
  process.exit(1)
}
console.log(`test-ai-grade: ok — ${checks} checks passed`)
