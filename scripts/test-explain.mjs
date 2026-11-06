/**
 * 错题 AI 讲解 tests (host half).
 *
 * `src/host/domain/ai-explain.js` is pure: payload cleaning, the teacher prompt
 * and the plain-text cleanup are tested directly. The last block mounts the real
 * plugin and calls `POST /dsh-nce/api/paper/explain` against a fake default
 * model, covering the route contract, the in-memory cache and the 503/502
 * failure paths.
 *
 * Usage: node scripts/test-explain.mjs
 */
import {
  aiExplainCleanText,
  aiExplainSystemPrompt,
  aiExplainUserPrompt,
  cleanExplainPayload,
} from '../src/host/domain/ai-explain.js'

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
// 1. Payload cleaning
// ---------------------------------------------------------------------------
{
  const input = cleanExplainPayload({
    lessonTitle: '  第10课 · Look at...  ',
    group: ' II. ',
    prompt: '  (your son) He\'s very well, thank you.  ',
    answer: ' How are your son? ',
    reference: ['How is your son?', ' How\'s your son? ', ''],
    verdict: 'wrong',
    comment: ' 主谓一致 ',
  }, fail)
  equal('clean: lesson title trimmed', input.lessonTitle, '第10课 · Look at...')
  equal('clean: group trimmed', input.group, 'II.')
  equal('clean: prompt trimmed', input.prompt, "(your son) He's very well, thank you.")
  equal('clean: answer trimmed', input.answer, 'How are your son?')
  equal('clean: reference joined', input.reference, "How is your son?\nHow's your son?")
  equal('clean: comment trimmed', input.comment, '主谓一致')
  equal('clean: verdict normalized', input.verdict, 'wrong')

  const close = cleanExplainPayload({ prompt: 'p', verdict: 'close' }, fail)
  equal('clean: close verdict kept', close.verdict, 'close')
  equal('clean: missing answer defaults empty', close.answer, '')
  equal('clean: missing reference defaults empty', close.reference, '')

  const long = cleanExplainPayload({
    prompt: 'p'.repeat(1200),
    answer: 'a'.repeat(900),
    reference: 'r'.repeat(900),
    comment: 'c'.repeat(900),
  }, fail)
  equal('clean: prompt clipped', long.prompt.length, 800)
  equal('clean: answer clipped', long.answer.length, 500)
  equal('clean: reference clipped', long.reference.length, 400)
  equal('clean: comment clipped', long.comment.length, 300)

  let error = null
  try {
    cleanExplainPayload({ prompt: '   ' }, fail)
  } catch (failure) {
    error = failure
  }
  equal('clean: empty prompt rejected', error?.status, 400)
  error = null
  try {
    cleanExplainPayload(null, fail)
  } catch (failure) {
    error = failure
  }
  equal('clean: null payload rejected', error?.status, 400)
}

// ---------------------------------------------------------------------------
// 2. Prompts
// ---------------------------------------------------------------------------
{
  const system = aiExplainSystemPrompt()
  check('prompt: system asks for Chinese', system.includes('简体中文'))
  check('prompt: system asks for the grammar point', system.includes('语法点'))
  check('prompt: system caps the length', system.includes('180 字'))

  const text = aiExplainUserPrompt(cleanExplainPayload({
    lessonTitle: '第10课 · Look at...',
    group: 'II.',
    prompt: "(your son) He's very well, thank you.",
    answer: 'How are your son?',
    reference: 'How is your son?',
    verdict: 'wrong',
    comment: '主谓一致',
  }, fail))
  check('prompt: user prompt carries the lesson', text.includes('课：第10课 · Look at...'))
  check('prompt: user prompt carries the question', text.includes("(your son) He's very well, thank you."))
  check('prompt: user prompt carries both answers', text.includes('学生答案：How are your son?') && text.includes('参考答案：How is your son?'))
  check('prompt: user prompt carries the comment', text.includes('已有批改点评：主谓一致'))

  const bare = aiExplainUserPrompt(cleanExplainPayload({ prompt: 'Is this your handbag?' }, fail))
  check('prompt: missing answers are labelled', bare.includes('学生答案：（未作答）') && bare.includes('参考答案：（暂无参考答案，请给出正确写法）'))
}

// ---------------------------------------------------------------------------
// 3. Reply cleanup
// ---------------------------------------------------------------------------
{
  equal('clean text: plain', aiExplainCleanText('  How is your son? 用 is，因为主语 your son 是单数。 '), 'How is your son? 用 is，因为主语 your son 是单数。')
  equal('clean text: strips fences', aiExplainCleanText('```text\n用 is，因为主语是单数。\n```'), '用 is，因为主语是单数。')
  equal('clean text: strips label', aiExplainCleanText('解释：用 is。'), '用 is。')
  equal('clean text: empty is null', aiExplainCleanText('   '), null)
  equal('clean text: fences only is null', aiExplainCleanText('```text\n```'), null)
  const long = aiExplainCleanText('x'.repeat(3000))
  equal('clean text: clipped', long.length, 1200)
}

// ---------------------------------------------------------------------------
// 4. Route integration: real plugin + fake default model
// ---------------------------------------------------------------------------
{
  const { apply } = await import('../index.js')
  const HOST = '127.0.0.1:49573'
  const calls = []

  function makeCtx(model) {
    return {
      webServer: { register() { return () => {} } },
      effect(fn) { return fn() },
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

  function modelReply(text) {
    return {
      stream(options) {
        calls.push(options)
        return (async function* stream() {
          if (text !== null) {
            yield { type: 'text-delta', text }
            yield { type: 'finish', reason: 'stop' }
            return
          }
          yield { type: 'finish', reason: 'tool-calls' }
        })()
      },
    }
  }

  const payload = {
    lessonTitle: '第10课 · Look at...',
    group: 'II.',
    prompt: "(your son) He's very well, thank you.",
    answer: 'How are your son?',
    reference: 'How is your son?',
    verdict: 'wrong',
    comment: '主谓一致',
  }

  const handler = mount(makeCtx(modelReply('用 is。your son 是单数，所以用 How is your son? 记住：主语单数用 is。')))
  const explained = await call(handler, 'paper/explain', payload)
  equal('route: ok status', explained.status, 200)
  equal('route: ok flag', explained.json?.ok, true)
  equal('route: source', explained.json?.source, 'ai')
  equal('route: model echoed', explained.json?.model, 'fake-model')
  check('route: text returned', explained.json?.text?.includes('How is your son?'), explained.json?.text)
  equal('route: model was called once', calls.length, 1)
  equal('route: stream uses the default model', calls[0]?.model, 'fake-model')
  check('route: system prompt sent', String(calls[0]?.system ?? '').includes('英语老师'))
  check('route: maxTokens capped', calls[0]?.maxTokens === 900)

  const again = await call(handler, 'paper/explain', payload)
  equal('route: second call served from cache', again.json?.cached, true)
  equal('route: cache avoids a second model call', calls.length, 1)

  const changed = await call(handler, 'paper/explain', { ...payload, answer: 'How is your son?' })
  equal('route: different content calls the model again', calls.length, 2)

  const invalid = await call(handler, 'paper/explain', { prompt: '   ' })
  equal('route: missing prompt is 400', invalid.status, 400)

  const noModel = await call(mount(makeCtx(null)), 'paper/explain', { ...payload, prompt: 'no model question' })
  equal('route: no default model is 503', noModel.status, 503)
  check('route: 503 explains the missing model', String(noModel.json?.error ?? '').includes('默认模型'))

  const emptyReply = await call(mount(makeCtx(modelReply(null))), 'paper/explain', { ...payload, prompt: 'empty reply question' })
  equal('route: empty model reply is 502', emptyReply.status, 502)
  check('route: 502 mentions the empty reply', String(emptyReply.json?.error ?? '').includes('没有返回讲解内容'))
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
if (failures.length > 0) {
  console.error(`test-explain: ${failures.length} failure(s)`)
  for (const failure of failures) console.error(`  ✗ ${failure}`)
  process.exit(1)
}
console.log(`test-explain: ok — ${checks} checks passed`)
