/**
 * AI-teacher grading: request cleaning, model-output parsing and prompt
 * construction for the `paper/grade` op.
 *
 * The op grades the whole exercise sheet with one teacher: every answered
 * question is sent, answer-book questions include their key as `reference`, so
 * the model's verdicts are the paper's single score source. This module owns
 * the deterministic half (what is a valid question, what counts as a parseable
 * verdict, what the teacher is told).
 *
 * Pure: no IO. `fail(status, message)` is injected so this layer never imports
 * the HTTP error type.
 *
 * @module host/domain/ai-grade
 */

/** One grading round trip stays small enough for the body limit and the model. */
export const AI_GRADE_MAX_ITEMS = 30
export const AI_VERDICTS = new Set(['correct', 'close', 'wrong'])

/**
 * Validate and trim the browser's per-question grading payload.
 *
 * @param {unknown} value raw `items` field
 * @param {(status: number, message: string) => Error} fail error factory (produces the request error)
 * @returns {object[]} clean items
 */
export function cleanAiGradeItems(value, fail) {
  if (!Array.isArray(value)) throw fail(400, '缺少题目列表')
  const items = []
  const seen = new Set()
  for (const raw of value) {
    if (items.length >= AI_GRADE_MAX_ITEMS) break
    if (raw === null || typeof raw !== 'object') continue
    const id = String(raw.id ?? '').trim().slice(0, 80)
    if (id === '' || seen.has(id)) continue
    const prompt = String(raw.prompt ?? '').trim().slice(0, 500)
    const answer = String(raw.answer ?? '').trim().slice(0, 500)
    if (prompt === '' || answer === '') continue
    seen.add(id)
    items.push({
      id,
      prompt,
      answer,
      group: String(raw.group ?? '').trim().slice(0, 160),
      example: String(raw.example ?? '').trim().slice(0, 400),
      // Answer-book key (when this question has one) so the teacher agrees with
      // the book instead of inventing a second standard for the same sentence.
      reference: String(raw.reference ?? '').trim().slice(0, 400),
    })
  }
  if (items.length === 0) throw fail(400, '没有可批改的题目')
  return items
}

/** First present, non-empty field among several aliases (models vary). */
export function aiRowField(row, names) {
  if (row === null || typeof row !== 'object') return ''
  for (const name of names) {
    const value = row[name]
    if (value === undefined || value === null) continue
    if (typeof value === 'object') continue
    const text = String(value).trim()
    if (text !== '') return text
  }
  return ''
}

/** Map a model-provided id to one of the requested question ids. */
export function aiResolveItemId(raw, items, byId) {
  const text = String(raw ?? '').trim().replace(/^id\s*[=:：]\s*/i, '').replace(/^["'「『]|["'」』]$/g, '').trim()
  if (text === '') return ''
  if (byId.has(text)) return byId.get(text)
  const lower = text.toLowerCase()
  if (byId.has(lower)) return byId.get(lower)
  // "题号 ex:0:0" / "ex:0:0（第 1 题）": find a known id inside the value.
  for (const [id] of byId) {
    if (text.includes(id)) return id
  }
  // Models often answer with the printed question number (1, 2, …).
  const numeric = /^#?(\d{1,3})[)）.、]?$/.exec(text)
  if (numeric !== null) {
    const index = Number(numeric[1]) - 1
    if (index >= 0 && index < items.length) return items[index].id
  }
  return ''
}

/** Accept English verdicts plus the Chinese words a model may slip into JSON. */
export function aiNormalizeVerdict(raw) {
  const text = String(raw ?? '').trim().toLowerCase().replace(/[。.!！,，:：;；\s"']/g, '')
  if (text === '') return ''
  if (/不正确|错误|^错$|wrong|incorrect|^false$|^error$|^×$|^✗$|^✘$|^no$/.test(text)) return 'wrong'
  if (/近似|基本正确|接近|部分正确|close|partial|almost|^≈$/.test(text)) return 'close'
  if (/正确|^对$|^√$|^✓$|^✔$|correct|^right$|^true$|^ok$|^yes$/.test(text)) return 'correct'
  return ''
}

/**
 * Pull every balanced JSON object / array out of the model's text. Models
 * sometimes wrap JSON in prose or a code fence, and a truncated outer object
 * still leaves its complete inner rows usable — so each candidate is parsed
 * independently instead of trusting one greedy regex.
 */
export function aiJsonCandidates(text) {
  const source = String(text ?? '')
  const found = []
  const push = (raw) => {
    const trimmed = raw.trim()
    if (trimmed === '') return
    try {
      found.push(JSON.parse(trimmed))
    } catch {
      // Not JSON (prose / partial object) — ignore.
    }
  }
  push(source)
  const fence = /```(?:json)?\s*([\s\S]*?)```/gi
  let match
  while ((match = fence.exec(source)) !== null) push(match[1])
  for (let start = 0; start < source.length; start += 1) {
    const head = source[start]
    if (head !== '{' && head !== '[') continue
    const open = head
    const close = head === '{' ? '}' : ']'
    let depth = 0
    let inString = false
    let escaped = false
    for (let index = start; index < source.length; index += 1) {
      const character = source[index]
      if (inString) {
        if (escaped) escaped = false
        else if (character === '\\') escaped = true
        else if (character === '"') inString = false
        continue
      }
      if (character === '"') { inString = true; continue }
      if (character === open) depth += 1
      else if (character === close) {
        depth -= 1
        if (depth === 0) {
          push(source.slice(start, index + 1))
          break
        }
      }
    }
  }
  return found
}

/** Flatten any parsed JSON value into row objects (items array, array, single row). */
export function aiRowsFromJson(value, rows, depth = 0) {
  if (value === null || value === undefined || depth > 4) return
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (entry !== null && typeof entry === 'object') rows.push(entry)
    }
    return
  }
  if (typeof value !== 'object') return
  if (Array.isArray(value.items)) {
    for (const entry of value.items) {
      if (entry !== null && typeof entry === 'object') rows.push(entry)
    }
    return
  }
  for (const key of ['data', 'result', 'results', 'grades', 'grading']) {
    if (value[key] !== undefined) {
      aiRowsFromJson(value[key], rows, depth + 1)
      return
    }
  }
  if (aiRowField(value, ['id', 'questionId', 'num', '题号', 'verdict', 'result', '判定', '结果']) !== '') rows.push(value)
}

/** Convert one model row into a trusted verdict for a requested question id. */
export function aiGradeRow(row, items, byId, fallbackId) {
  const rawId = aiRowField(row, ['id', 'questionId', 'question_id', 'qid', 'itemId', 'num', '题号', '编号'])
  const id = aiResolveItemId(rawId, items, byId) || fallbackId
  if (id === '') return null
  const verdict = aiNormalizeVerdict(aiRowField(row, ['verdict', 'result', 'judgement', 'judgment', 'grade', '判定', '结果', '评分']))
  if (!AI_VERDICTS.has(verdict)) return null
  return {
    id,
    verdict,
    comment: aiRowField(row, ['comment', 'remark', 'feedback', 'note', 'reason', '点评', '评价', '说明', '理由']).slice(0, 160),
    answer: aiRowField(row, ['answer', 'reference', 'suggested', 'correction', 'sample', '参考答案', '参考写法', '答案']).slice(0, 300),
  }
}

/**
 * Parse the teacher's reply. Accepts strict JSON, line-delimited JSON objects,
 * fenced blocks and Chinese verdict words; unknown ids and verdicts are
 * dropped. When the model numbered the questions instead of echoing ids, its
 * rows are matched to the requested items in order (only if every row is
 * otherwise unmatched and the counts line up).
 */
export function parseAiGrades(text, items) {
  const parsed = aiJsonCandidates(text)
  const rows = []
  for (const value of parsed) aiRowsFromJson(value, rows)
  if (rows.length === 0) return null
  const byId = new Map()
  for (const item of items) {
    byId.set(item.id, item.id)
    byId.set(item.id.toLowerCase(), item.id)
    byId.set(item.id.replace(/\s+/g, '').toLowerCase(), item.id)
  }
  const result = []
  const seen = new Set()
  const unmatched = []
  for (const row of rows) {
    const graded = aiGradeRow(row, items, byId, '')
    if (graded === null) {
      unmatched.push(row)
      continue
    }
    if (seen.has(graded.id)) continue
    seen.add(graded.id)
    result.push(graded)
  }
  // Order fallback: the model answered "1) …, 2) …" instead of echoing ids.
  if (result.length === 0 && unmatched.length > 0 && unmatched.length === items.length) {
    unmatched.forEach((row, index) => {
      const graded = aiGradeRow(row, items, byId, items[index].id)
      if (graded !== null && !seen.has(graded.id)) {
        seen.add(graded.id)
        result.push(graded)
      }
    })
  }
  return result.length > 0 ? result : null
}

export function aiGradeSystemPrompt() {
  return [
    '你是《新概念英语》第一册（NCE1）的英语老师，正在批改中国成年自学者的整张课后练习卷。',
    '上面会给出每道题的题号、所属大题、题干（填空处用 ___ 表示）、书上的示范（可能为空）、答案册参考（可能为空）和学生答案。',
    '有的题带「答案册参考」：请以答案册为准判断（同义写法、缩写展开、大小写和句末标点差异都算对）；',
    '没有答案册参考的题，按英语语法、题意和书上的示范判断。',
    '配对题（题干 + 学生填的字母）：答案册参考里列出的字母就是应选集合；学生填的字母集合与应选集合完全一致才判 correct，',
    '只命中一部分判 close，完全没命中判 wrong；学生写的是 B 栏单词时按对应字母处理。',
    '请逐题判断：',
    '- correct：完全正确（大小写、句末标点不计较；缩写与完整形式都可以接受）；',
    '- close：基本正确，但有小问题（拼写、冠词、单复数等）；',
    '- wrong：有需要纠正的语法或用词错误。',
    '每题的 comment 用中文一句话点评（不超过 30 字），指出问题或给一句简短鼓励，不要空话。',
    '每题的 answer 给出参考写法：填空题给应填内容；整句题给完整英文句子。',
    '只根据给出的题目和学生答案判断，不要编造题号或题目；学生答案与题目无关时判 wrong。',
    '输出格式：每行一个 JSON 对象，一行一题；不要外层数组、不要 markdown 代码块、不要任何解释文字。',
    '每行严格是这个形状：{"id":"原样复制题目给的 id","verdict":"correct 或 close 或 wrong","comment":"中文点评","answer":"参考写法"}',
    'verdict 只能用英文 correct / close / wrong 三个词之一，不要写中文判定词；id 必须原样复制，不要改成 1、2、3。',
  ].join('\n')
}

export function aiRepairSystemPrompt() {
  return [
    '你是格式修复助手：把一段英语作业批改的原始输出，转换成严格的行分隔 JSON。',
    '规则：每题一行 JSON 对象，不要外层数组、不要代码块、不要解释。',
    '每行严格是：{"id":"原样复制的题号 id","verdict":"correct 或 close 或 wrong","comment":"中文点评","answer":"参考写法"}',
    '只保留能判断的题；看不懂的行直接丢弃，不要编造新题。',
  ].join('\n')
}

export function aiGradeUserPrompt(lesson, items) {
  const lessonId = Number(lesson?.id) || 0
  const titleEn = typeof lesson?.titleEn === 'string' ? lesson.titleEn.trim() : ''
  const lines = [`第 ${lessonId} 课${titleEn !== '' ? `《${titleEn}》` : ''}，共 ${items.length} 题，请逐题批改。`]
  items.forEach((item, index) => {
    lines.push('')
    lines.push(`${index + 1}) id=${item.id}（输出时原样复制这个 id）`)
    if (item.group !== '') lines.push(`   大题：${item.group}`)
    lines.push(`   题干：${item.prompt}`)
    if (item.example !== '') lines.push(`   本组上下文：${item.example}`)
    if (typeof item.reference === 'string' && item.reference !== '') lines.push(`   答案册参考：${item.reference}`)
    lines.push(`   学生答案：${item.answer}`)
  })
  return lines.join('\n')
}
