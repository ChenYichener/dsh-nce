/**
 * 错题讲解 prompt + reply cleanup (pure).
 *
 * The 错题本 asks the profile's default model to explain one wrong answer like
 * an English teacher: the correct usage, what went wrong (the grammar point)
 * and a short memory hook. The model replies in plain Chinese text, so the
 * normalizer only strips code fences / labels and clips the length.
 *
 * @module host/domain/ai-explain
 */

const EXPLAIN_MAX_TEXT = 1200

/** One readable line of reference answers (they may be an array-ish string). */
function explainReference(value) {
  if (Array.isArray(value)) return value.map((line) => String(line ?? '').trim()).filter((line) => line !== '').join('\n')
  return String(value ?? '').trim()
}

/**
 * Validate + trim the client payload.
 *
 * @param {unknown} value raw `paper/explain` payload
 * @param {(status: number, message: string) => Error} fail error factory
 * @returns {{ lessonTitle: string, group: string, prompt: string, answer: string, reference: string, verdict: string, comment: string }}
 */
export function cleanExplainPayload(value, fail) {
  const raw = value !== null && typeof value === 'object' && Array.isArray(value) === false ? value : {}
  const prompt = String(raw.prompt ?? '').trim().slice(0, 800)
  if (prompt === '') throw fail(400, '缺少要讲解的题目')
  const answer = String(raw.answer ?? '').trim().slice(0, 500)
  const reference = explainReference(raw.reference).slice(0, 400)
  const verdict = raw.verdict === 'close' ? 'close' : 'wrong'
  return {
    lessonTitle: String(raw.lessonTitle ?? '').trim().slice(0, 120),
    group: String(raw.group ?? '').trim().slice(0, 120),
    prompt,
    answer,
    reference,
    verdict,
    comment: String(raw.comment ?? '').trim().slice(0, 300),
  }
}

export function aiExplainSystemPrompt() {
  return [
    '你是一位耐心、专业的英语老师，正在帮中国学生订正《新概念英语》第一册的练习错题。',
    '用简体中文直接回答，不要输出 Markdown 标题、代码块或多余寒暄。按下面三点写，总字数控制在 180 字以内：',
    '1. 先给出正确答案的写法（如果题目已经给了参考答案，就沿用，不要另立标准）；',
    '2. 用一两句话说清学生答案错在哪里、正确的语法点是什么（例如主谓一致、疑问句结构、时态、介词搭配、单复数等），尽量具体；',
    '3. 最后一句话给一个记忆要点，或一个同类型的小例句。',
    '如果题目本身有多种正确写法，直接说明都可以。语气自然、像老师当面讲题，不要空泛。',
  ].join('\n')
}

/** One-mistake user prompt: the lesson/question context plus both answers. */
export function aiExplainUserPrompt(input) {
  const lines = []
  if (input.lessonTitle !== '') lines.push(`课：${input.lessonTitle}`)
  if (input.group !== '') lines.push(`大题：${input.group}`)
  lines.push('题目：')
  lines.push(input.prompt)
  lines.push(`学生答案：${input.answer !== '' ? input.answer : '（未作答）'}`)
  lines.push(`参考答案：${input.reference !== '' ? input.reference : '（暂无参考答案，请给出正确写法）'}`)
  if (input.comment !== '') lines.push(`已有批改点评：${input.comment}`)
  lines.push('')
  lines.push('请解释这道错题：正确答案 + 错在哪里（点出语法点）+ 一句记忆要点或例句。')
  return lines.join('\n')
}

/** Strip fences/labels and clip; null when the model said nothing usable. */
export function aiExplainCleanText(raw) {
  let text = String(raw ?? '').trim()
  if (text === '') return null
  text = text.replace(/^```[a-zA-Z]*\s*/, '').replace(/\s*```$/, '').trim()
  text = text.replace(/^(?:解释|讲解|回答|答案)[:：]\s*/, '')
  if (text === '') return null
  return text.slice(0, EXPLAIN_MAX_TEXT)
}
