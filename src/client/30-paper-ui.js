// Layer: 30 paper-ui — depends on: 00-platform, 01-domain, 03-api (`api`), 04-tts, 05-data (`useLesson`),
// 06-store (`useNce`), 07-ui (components) and 10-paper-engine (the pure `Paper*` engine).
//
// ---------------------------------------------------------------------------
// Tab: exercise — a fillable exam paper (练习卷 / 试卷)
//
// The old tab was read-only: questions plus a "显示答案" toggle. It is now a
// worksheet you can actually write on:
//   - blank items render the "___" as inline inputs, everything else gets an
//     answer line under the question;
//   - reference answers are parsed out of the grammar workbook (numbers, a/b/c
//     sub-questions, OCR artifacts, multiple acceptable forms);
//   - "批改整卷" grades the paper with a forgiving comparer (case, punctuation,
//     contractions, fragment answers) and shows 红笔 marks + references;
//   - anything the comparer cannot judge (no reference in the source data, or
//     an answer with several acceptable wordings) stays self-assessed: the
//     learner can mark 对 / 错 by hand;
//   - answers, marks, revealed sections and the graded flag are auto-saved to
//     this browser's localStorage, keyed per lesson, so a paper survives tab
//     switches and app restarts.
//
// Every lesson keeps its own paper; switching lessons remounts the tab (the
// parent passes a per-lesson key).
//
// The pure parser/grader lives in 10-paper-engine.js; this fragment keeps the
// draft persistence, the worksheet/grader UI, the PDF export integration and CSS.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Draft persistence (localStorage, one key per lesson)
// ---------------------------------------------------------------------------

function PaperEmptyState() {
  return { version: PAPER_STATE_VERSION, answers: {}, marks: {}, graded: false, revealed: {}, ai: {}, updatedAt: 0 }
}

function PaperReadState(lessonId) {
  const base = PaperEmptyState()
  try {
    const raw = window.localStorage.getItem(`${PAPER_STORAGE_PREFIX}${lessonId}`)
    if (raw === null || raw === '') return base
    const parsed = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object') return base
    const answers = {}
    if (parsed.answers !== null && typeof parsed.answers === 'object' && !Array.isArray(parsed.answers)) {
      for (const [key, value] of Object.entries(parsed.answers)) {
        const text = typeof value === 'string' ? value.slice(0, 2000) : ''
        if (text.trim() !== '') answers[String(key).slice(0, 120)] = text
      }
    }
    const marks = {}
    if (parsed.marks !== null && typeof parsed.marks === 'object' && !Array.isArray(parsed.marks)) {
      for (const [key, value] of Object.entries(parsed.marks)) {
        if (value === 'right' || value === 'wrong') marks[String(key).slice(0, 120)] = value
      }
    }
    const revealed = {}
    if (parsed.revealed !== null && typeof parsed.revealed === 'object' && !Array.isArray(parsed.revealed)) {
      for (const [key, value] of Object.entries(parsed.revealed)) {
        if (value === true) revealed[String(key).slice(0, 120)] = true
      }
    }
    return {
      version: PAPER_STATE_VERSION,
      answers,
      marks,
      graded: parsed.graded === true,
      revealed,
      ai: PaperAiRows({ ai: parsed.ai }),
      updatedAt: Number(parsed.updatedAt) || 0,
    }
  } catch {
    return base
  }
}

function PaperWriteState(lessonId, state) {
  const answers = {}
  if (state.answers !== null && typeof state.answers === 'object') {
    for (const [key, value] of Object.entries(state.answers)) {
      const text = typeof value === 'string' ? value.slice(0, 2000) : ''
      if (text.trim() !== '') answers[key] = text
    }
  }
  const marks = {}
  if (state.marks !== null && typeof state.marks === 'object') {
    for (const [key, value] of Object.entries(state.marks)) {
      if (value === 'right' || value === 'wrong') marks[key] = value
    }
  }
  const revealed = {}
  if (state.revealed !== null && typeof state.revealed === 'object') {
    for (const [key, value] of Object.entries(state.revealed)) if (value === true) revealed[key] = true
  }
  const payload = {
    version: PAPER_STATE_VERSION,
    updatedAt: Date.now(),
    graded: state.graded === true,
    answers,
    marks,
    revealed,
    ai: PaperAiRows(state),
  }
  try {
    window.localStorage.setItem(`${PAPER_STORAGE_PREFIX}${lessonId}`, JSON.stringify(payload))
    return payload.updatedAt
  } catch {
    return 0
  }
}

// ---------------------------------------------------------------------------
// Small presentational pieces shared by the paper
// ---------------------------------------------------------------------------

/** Bordered word/phrase box (book: "Use the words in the box…"). */
function PaperWordBox(props) {
  const words = PaperList(props.words).map((word) => String(word).trim()).filter((word) => word !== '')
  if (words.length === 0) return null
  return h('div', { className: 'nce-paper-wordbox' },
    h('div', { className: 'nce-paper-wordbox-label' }, 'WORD BOX'),
    h('div', { className: 'nce-paper-wordbox-words' },
      words.map((word, index) => h('span', { key: index, className: 'nce-paper-wordbox-word nce-en' }, word))))
}

function PaperExampleList(props) {
  const entries = PaperList(props.entries)
  const nodes = []
  entries.forEach((entry, index) => {
    if (entry !== null && typeof entry === 'object') {
      const en = String(entry.en ?? '').trim()
      const zh = String(entry.zh ?? '').trim()
      if (en === '' && zh === '') return
      nodes.push(h('div', { key: index, className: 'nce-paper-example-row' },
        en !== '' ? h('div', { className: 'nce-paper-example-en nce-en' }, en) : null,
        zh !== '' ? h('div', { className: 'nce-paper-example-zh' }, zh) : null))
      return
    }
    const text = String(entry ?? '').trim()
    if (text === '') return
    nodes.push(h('div', { key: index, className: 'nce-paper-example-line nce-en' }, text))
  })
  if (nodes.length === 0) return null
  return h('div', { className: 'nce-paper-example' },
    h('div', { className: 'nce-paper-example-label' }, props.label ?? 'EXAMPLE'),
    nodes)
}

function PaperTableView(props) {
  const rows = PaperList(props.rows)
  if (rows.length === 0) return null
  return h('div', { className: 'nce-paper-table-wrap' },
    h('table', { className: 'nce-paper-table' },
      h('tbody', null, rows.map((row, rowIndex) => h('tr', { key: rowIndex },
        PaperList(row).map((cell, cellIndex) => h('td', { key: cellIndex }, String(cell ?? ''))))))))
}

function PaperMarkBadge(props) {
  const status = String(props.status ?? '')
  if (status === '' || status === 'blank') return null
  if (status === 'correct') return h('span', { className: 'nce-paper-mark is-correct' }, Icon('check', 12))
  if (status === 'wrong') return h('span', { className: 'nce-paper-mark is-wrong' }, Icon('close', 12))
  if (status === 'close') return h('span', { className: 'nce-paper-mark is-close' }, '≈')
  return null
}

function PaperSelfMark(props) {
  const mark = props.mark === 'right' || props.mark === 'wrong' ? props.mark : ''
  return h('div', { className: 'nce-paper-selfmark' },
    h('button', {
      type: 'button',
      className: cx('nce-paper-self-btn', mark === 'right' && 'is-on is-right'),
      title: '我把这道题判为正确',
      'aria-pressed': mark === 'right',
      onClick: () => props.onMark('right'),
    }, Icon('check', 12), '判对'),
    h('button', {
      type: 'button',
      className: cx('nce-paper-self-btn', mark === 'wrong' && 'is-on is-wrong'),
      title: '我把这道题判为错误',
      'aria-pressed': mark === 'wrong',
      onClick: () => props.onMark('wrong'),
    }, Icon('close', 12), '判错'))
}

function PaperReferenceBlock(props) {
  const question = props.question
  const slots = PaperList(question.slotReference)
  const lines = slots.length > 0 ? slots.map((slot) => slot.raw) : PaperList(question.referenceLines)
  const label = question.referenceSource === 'prompt' ? '原文' : '参考答案'
  if (lines.length === 0) {
    return h('div', { className: 'nce-paper-ref is-empty' },
      h('span', { className: 'nce-paper-ref-label' }, '无参考答案'),
      h('span', { className: 'nce-paper-ref-hint' }, '对照上面的示例，自己判对错'))
  }
  return h('div', { className: 'nce-paper-ref' },
    h('span', { className: 'nce-paper-ref-label' }, label),
    h('div', { className: 'nce-paper-ref-lines' },
      lines.map((line, index) => h('div', { key: index, className: 'nce-paper-ref-line nce-en' }, line))))
}

// ---------------------------------------------------------------------------
// Question row (blank inputs / answer line / reference + self-mark)
// ---------------------------------------------------------------------------

function PaperBlankPrompt(props) {
  const question = props.question
  const answers = props.answers
  const letterLabel = question.letterLabel !== undefined ? question.letterLabel : question.letter
  return h('div', { className: 'nce-paper-prompt' },
    PaperList(question.lineTokens).map((line, lineIndex) => h('div', { key: lineIndex, className: 'nce-paper-line' },
      PaperList(line).map((token, tokenIndex) => {
        if (token.kind === 'text') {
          return h('span', { key: tokenIndex, className: 'nce-paper-fragment nce-en' }, token.text)
        }
        const key = `${question.id}#b${token.index}`
        const value = String(answers[key] ?? '')
        return h('input', {
          key: tokenIndex,
          type: 'text',
          className: 'nce-paper-blank',
          'data-paper-input': key,
          'aria-label': `第 ${question.num}${letterLabel} 题第 ${token.index + 1} 空`,
          value,
          size: Math.max(6, Math.min(30, value.length + 2)),
          autoComplete: 'off',
          spellCheck: false,
          onChange: (event) => props.onAnswer(key, event.target.value),
        })
      }))))
}

function PaperTextPrompt(props) {
  const question = props.question
  return h('div', { className: 'nce-paper-prompt' },
    PaperList(question.lines).map((line, index) => h('div', { key: index, className: 'nce-paper-line nce-en' }, line)))
}

function PaperExamplePrompt(props) {
  const question = props.question
  const lines = PaperList(question.lines)
  const given = PaperList(question.exampleAnswers)
  let rows = []
  if (given.length === lines.length && lines.length > 0) {
    rows = lines.map((line, index) => ({ line, answer: given[index] }))
  } else if (lines.length >= 2 && lines.length % 2 === 0 && lines.every((line, index) => index % 2 === 0 || !/\?/.test(String(line)))) {
    // Printed examples in the answer book are Q/A pairs stacked line by line.
    for (let index = 0; index < lines.length; index += 2) rows.push({ line: lines[index], answer: lines[index + 1] })
  }
  if (rows.length === 0) {
    const display = lines.length === 1 ? String(lines[0]).split(/(?<=[.?!])\s+(?=[A-Z(])/).map((part) => part.trim()).filter(Boolean) : lines
    return h('div', { className: 'nce-paper-prompt nce-paper-example' }, display.map((line, index) => h('div', { key: index, className: 'nce-paper-example-q nce-en' }, line)))
  }
  return h('div', { className: 'nce-paper-prompt nce-paper-example' },
    rows.map((row, index) => h('div', { key: index, className: 'nce-paper-example-row' },
      h('span', { className: 'nce-paper-example-q nce-en' }, row.line),
      h('span', { className: 'nce-paper-example-a nce-en' }, row.answer))))
}

/** Stacked questions each get their own answer line, like the book's ruled lines. */
function PaperLineAnswerPrompt(props) {
  const question = props.question
  const answers = props.answers
  const lineStatuses = PaperList(props.lineStatuses)
  const letterLabel = question.letterLabel !== undefined ? question.letterLabel : question.letter
  const lines = PaperList(question.lines)
  const rowCount = Math.max(lines.length, PaperList(question.lineParts).length)
  return h('div', { className: 'nce-paper-prompt nce-paper-lines' },
    Array.from({ length: rowCount }, (_row, index) => {
      const line = lines[index] ?? ''
      const key = `${question.id}#l${index}`
      const value = String(answers[key] ?? '')
      const status = lineStatuses[index] ?? ''
      return h('div', {
        key: index,
        className: cx('nce-paper-line-row', status !== '' && `is-${status}`),
      },
      h('span', { className: 'nce-paper-line-text nce-en' }, line),
      h('input', {
        type: 'text',
        className: 'nce-paper-answer nce-paper-line-answer',
        'data-paper-input': key,
        'aria-label': `第 ${question.num}${letterLabel} 题第 ${index + 1} 句答案`,
        placeholder: rowCount > lines.length ? (index % 2 === 1 ? '在这里写下答句…' : '在这里写下问句…') : '在这里写下答案…',
        value,
        autoComplete: 'off',
        spellCheck: false,
        onChange: (event) => props.onAnswer(key, event.target.value),
      }),
      status === 'correct' || status === 'wrong'
        ? h('span', { className: cx('nce-paper-line-mark', `is-${status}`) }, Icon(status === 'correct' ? 'check' : 'close', 11))
        : null)
    }))
}

function PaperQuestionItem(props) {
  const { question, paper, aiRow, status, showReference } = props
  const marks = paper.marks !== null && typeof paper.marks === 'object' ? paper.marks : {}
  const answers = paper.answers !== null && typeof paper.answers === 'object' ? paper.answers : {}
  const isExample = question.isExample === true
  const answered = PaperQuestionAnswered(question, answers)
  const showVerdict = showReference && !isExample
  const showSelfMark = showVerdict && answered
  const letterLabel = question.letterLabel !== undefined ? question.letterLabel : question.letter
  const badge = showVerdict ? h(PaperMarkBadge, { status }) : null
  const lineParts = PaperList(question.lineParts)
  const lineStatuses = showVerdict && lineParts.length > 1 ? PaperJudgeLines(question, answers) : []
  let prompt = null
  let answerInput = null
  if (isExample) {
    prompt = h(PaperExamplePrompt, { question })
  } else if (question.kind === 'blank') {
    prompt = h(PaperBlankPrompt, { question, answers, onAnswer: props.onAnswer })
  } else if (lineParts.length > 1) {
    prompt = h(PaperLineAnswerPrompt, {
      question,
      answers,
      lineStatuses,
      onAnswer: props.onAnswer,
    })
  } else {
    prompt = PaperList(question.lines).length > 0
      ? h(PaperTextPrompt, { question })
      : h('div', { className: 'nce-paper-prompt nce-paper-prompt-empty' },
        h('span', null, '（按本组例题 / 表格要求作答）'))
    const key = PaperQuestionAnswerKeys(question)[0]
    const value = String(answers[key] ?? '')
    answerInput = h('div', { className: 'nce-paper-answerline' },
      h('input', {
        type: 'text',
        className: 'nce-paper-answer',
        'data-paper-input': key,
        'aria-label': `第 ${question.num}${letterLabel} 题答案`,
        placeholder: question.referenceSource === 'prompt'
          ? '照着上面的句子抄写…'
          : (question.freeWrite === true ? '按上面的表格/要求写一句…' : '在这里写下答案…'),
        value,
        autoComplete: 'off',
        spellCheck: false,
        onChange: (event) => props.onAnswer(key, event.target.value),
      }))
  }
  return h('li', {
    className: cx('nce-paper-q', isExample && 'is-example', status === 'correct' && 'is-correct', status === 'wrong' && 'is-wrong'),
    'data-paper-q': question.id,
    'data-status': status,
  },
  h('div', { className: 'nce-paper-q-head' },
    h('span', { className: 'nce-paper-q-num' }, letterLabel === '' ? String(question.num) : `${question.num}${letterLabel}`),
    isExample ? h('span', { className: 'nce-paper-q-tag' }, '示例') : null,
    badge),
  h('div', { className: 'nce-paper-q-body' },
    prompt,
    answerInput,
    showVerdict
      ? h('div', { className: 'nce-paper-verdict' },
        h('span', { className: cx('nce-paper-pill', `is-${status}`) }, PAPER_STATUS_LABEL[status] ?? '待批改'),
        h(PaperReferenceBlock, { question }),
        aiRow !== null && aiRow !== undefined
          ? h('div', { className: 'nce-paper-ai', 'data-paper-ai': question.id, 'data-verdict': aiRow.verdict },
            h('div', { className: 'nce-paper-ai-head' },
              h('span', { className: `nce-paper-ai-tag is-${aiRow.verdict}` },
                Icon('spark', 12),
                `AI 老师：${PAPER_AI_VERDICT_LABEL[aiRow.verdict] ?? ''}`),
              aiRow.comment !== ''
                ? h('span', { className: 'nce-paper-ai-comment' }, aiRow.comment)
                : null),
            aiRow.answer !== '' && !PaperQuestionHasReference(question)
              ? h('div', { className: 'nce-paper-ai-answer' },
                h('span', { className: 'nce-paper-ai-answer-label' }, '参考写法'),
                h('span', { className: 'nce-paper-ai-answer-text nce-en' }, aiRow.answer))
              : null)
          : null,
        showSelfMark
          ? h(PaperSelfMark, {
            mark: marks[question.id] === 'right' || marks[question.id] === 'wrong' ? marks[question.id] : '',
            onMark: (value) => props.onMark(question.id, value),
          })
          : null)
      : null))
}

// ---------------------------------------------------------------------------
// Section card
// ---------------------------------------------------------------------------

/**
 * Two-column matching view: Column A rows get one letter slot each, Column B
 * keeps the book's lettered options. After grading every row shows its verdict
 * and the matched option, so the paper mirrors the real exercise instead of
 * pasting "question + answer" lines into one prompt.
 */
function PaperMatchingView(props) {
  const { group, paper, statuses, showReference, onAnswer, onMark } = props
  const data = group.matchingData
  const answers = paper.answers !== null && typeof paper.answers === 'object' ? paper.answers : {}
  const marks = paper.marks !== null && typeof paper.marks === 'object' ? paper.marks : {}
  const optionByLetter = new Map(PaperList(data.right).map((option) => [String(option.letter).toLowerCase(), String(option.text)]))
  const rows = PaperList(group.questions)
  return h('div', { className: 'nce-paper-match' },
    h('div', { className: 'nce-paper-match-tip' }, '在 A 栏每题后面填上 B 栏对应的字母（可填多个，如 e, f）；批改后由 AI 老师判分，也可手动判对/判错。'),
    h('div', { className: 'nce-paper-match-columns' },
      h('div', { className: 'nce-paper-match-side' },
        h('div', { className: 'nce-paper-match-head' }, `Column ${data.leftTitle}`),
        rows.map((question) => {
          const key = `${question.id}#m`
          const value = String(answers[key] ?? '')
          const status = statuses[question.id] ?? 'blank'
          const showVerdict = showReference && question.referenceSource !== 'none'
          const reference = PaperList(question.referenceLines)
          return h('div', {
            key: question.id,
            className: cx('nce-paper-match-row',
              showVerdict && status === 'correct' && 'is-correct',
              showVerdict && status === 'wrong' && 'is-wrong',
              showVerdict && status === 'close' && 'is-close'),
            'data-paper-q': question.id,
            'data-status': status,
          },
          h('span', { className: 'nce-paper-match-num' }, String(question.num)),
          h('span', { className: 'nce-paper-match-text nce-en' }, question.promptText),
          h('input', {
            type: 'text',
            className: 'nce-paper-match-input',
            'data-paper-input': key,
            'aria-label': `第 ${question.num} 题匹配字母`,
            placeholder: '字母',
            maxLength: 12,
            autoComplete: 'off',
            spellCheck: false,
            value,
            onChange: (event) => onAnswer(key, event.target.value),
          }),
          showVerdict
            ? h('div', { className: 'nce-paper-match-verdict' },
              h('span', { className: cx('nce-paper-pill', `is-${status}`) }, PAPER_STATUS_LABEL[status] ?? '待批改'),
              reference.map((line, index) => h('span', { key: index, className: 'nce-paper-match-ref nce-en' }, line)),
              question.referenceSource !== 'none'
                ? h(PaperSelfMark, {
                  mark: marks[question.id] === 'right' || marks[question.id] === 'wrong' ? marks[question.id] : '',
                  onMark: (mark) => onMark(question.id, mark),
                })
                : null)
            : null)
        })),
      h('div', { className: 'nce-paper-match-side is-right' },
        h('div', { className: 'nce-paper-match-head' }, `Column ${data.rightTitle}`),
        PaperList(data.right).map((option) => h('div', { key: option.letter, className: 'nce-paper-match-option' },
          h('span', { className: 'nce-paper-match-letter' }, `${option.letter}.`),
          h('span', { className: 'nce-paper-match-option-text nce-en' }, option.text))))),
    PaperList(data.keyNote).length > 0
      ? h('p', { className: 'nce-paper-match-note' }, PaperList(data.keyNote).join(' '))
      : null,
    h('div', { className: 'nce-paper-match-meta' },
      h('span', null, `${rows.length} 题`),
      h('span', null, `${rows.filter((question) => question.referenceSource !== 'none').length} 题有答案`),
      data.keyNote.length > 0 ? h('span', { className: 'is-warn' }, '答案不唯一') : null))
}

function PaperGroupCard(props) {
  const { group, paper, counters, statuses } = props
  const questions = PaperList(group.questions)
  const revealed = paper.revealed !== null && typeof paper.revealed === 'object' && paper.revealed[group.key] === true
  const graded = paper.graded === true
  const showReference = graded || revealed
  const gradable = counters !== undefined ? counters.gradable : 0
  const aiRows = PaperAiRows(paper)
  const answers = paper.answers !== null && typeof paper.answers === 'object' ? paper.answers : {}
  const answerable = questions.filter((question) => !question.isExample)
  const anyAi = Object.keys(aiRows).length > 0
  const aiGroup = answerable.filter((question) => aiRows[question.id] !== undefined).length
  const aiPendingGroup = answerable.filter((question) => aiRows[question.id] === undefined && PaperQuestionAnswered(question, answers)).length
  const aiCorrect = answerable.filter((question) => statuses[question.id] === 'correct').length
  const metaParts = [`${answerable.length} 题`]
  if (aiGroup > 0) metaParts.push(`AI 批改 ${aiGroup}`)
  else if (anyAi && aiPendingGroup > 0) metaParts.push(`AI 待批 ${aiPendingGroup}`)
  else if (gradable > 0) metaParts.push(`可判分 ${gradable}`)
  if (group.freeWrite === true) metaParts.push('自由作答')
  metaParts.push(`已答 ${counters !== undefined ? counters.answered : 0}`)
  if (showReference) {
    if (aiGroup > 0) metaParts.push(`正确 ${aiCorrect}/${answerable.length}`)
    else if (gradable > 0 && aiPendingGroup === 0) metaParts.push(`正确 ${counters.correct}/${gradable}`)
  }
  if (aiGroup === 0 && counters.selfRight + counters.selfWrong > 0) {
    metaParts.push(`自评 ${counters.selfRight} 对 / ${counters.selfWrong} 错`)
  }
  const titleZh = group.titleZh !== '' ? group.titleZh : (group.source === 'gwb' ? '语法练习册' : '课文书面练习')
  const titleEn = group.titleEn
  const primaryTitle = titleEn !== '' ? titleEn : titleZh
  const secondaryTitle = titleEn !== '' && titleZh !== '' && titleZh !== titleEn ? titleZh : ''
  const matchingView = group.matching === true && group.matchingData !== null && group.matchingData !== undefined
  return h('article', { className: 'nce-paper-group nce-card', 'data-paper-group': group.key },
    h('header', { className: 'nce-paper-group-head' },
      h('div', { className: 'nce-paper-group-titles' },
        h('div', { className: 'nce-paper-group-titleline' },
          group.label !== ''
            ? h('span', { className: 'nce-paper-group-label' }, group.label)
            : h('span', { className: 'nce-paper-group-index' }, PaperChineseIndex(group.index)),
          h('h3', { className: cx('nce-paper-group-title', titleEn !== '' && 'nce-en') }, primaryTitle)),
        secondaryTitle !== '' ? h('p', { className: 'nce-paper-group-sub' }, secondaryTitle) : null,
        matchingView
          ? h('p', { className: 'nce-paper-group-sub' }, '在 A 栏每题后填 B 栏字母，完成配对；批改后由 AI 老师判分（也可手动判定）')
          : null,
        group.freeWrite === true
          ? h('p', { className: 'nce-paper-group-freehint' }, '自由作答：这一组没有固定答案，按表格/要求自己写句子，写完点「批改整卷」交给 AI 老师批改。')
          : null,
        group.note.length > 0
          ? h('ul', { className: 'nce-paper-group-notes' },
            group.note.map((line, index) => h('li', { key: index }, line)))
          : null),
      h('div', { className: 'nce-paper-group-side' },
        h('span', { className: 'nce-paper-group-meta' }, metaParts.join(' · ')),
        gradable > 0
          ? h(Btn, {
            kind: 'quiet',
            size: 'sm',
            className: 'nce-paper-reveal',
            icon: 'eye',
            active: revealed,
            'aria-expanded': revealed,
            onClick: () => props.onReveal(group.key),
          }, revealed ? '收起答案' : '对答案')
          : (aiGroup > 0
            ? h('span', { className: 'nce-paper-group-meta' }, 'AI 老师批改')
            : h('span', { className: 'nce-paper-group-meta is-warn' }, '无参考答案 · 自评（不计分）')))),
    matchingView ? null : h(PaperWordBox, { words: group.wordBox }),
    matchingView ? null : h(PaperTableView, { rows: group.table }),
    matchingView || PaperList(group.table).length > 0 || PaperList(group.wordBox).length > 0
      ? null
      : h(PaperExampleList, { entries: group.example, label: group.source === 'gwb' ? 'EXAMPLE' : '示范' }),
    matchingView
      ? h(PaperMatchingView, {
        group,
        paper,
        statuses,
        showReference,
        onAnswer: props.onAnswer,
        onMark: props.onMark,
      })
      : h('ol', { className: 'nce-paper-questions' },
        questions.map((question) => h(PaperQuestionItem, {
          key: question.id,
          question,
          paper,
          aiRow: aiRows[question.id],
          status: statuses[question.id] ?? 'blank',
          showReference,
          onAnswer: props.onAnswer,
          onMark: props.onMark,
        }))),
    matchingView
      ? (PaperList(group.matchingKey).length > 0
        ? h('details', { className: 'nce-paper-matching' },
          h('summary', null, `配对参考答案（${PaperList(group.matchingKey).length} 行，批改后逐题自动判分）`),
          h('div', { className: 'nce-paper-ref-lines' },
            PaperList(group.matchingKey).map((line, index) => h('div', { key: index, className: 'nce-paper-ref-line nce-en' }, line))))
        : null)
      : (group.matching === true && PaperList(group.matchingKey).length > 0
        ? h('details', { className: 'nce-paper-matching' },
          h('summary', null, `配对参考答案（${PaperList(group.matchingKey).length} 行，本题组不自动判分）`),
          h('div', { className: 'nce-paper-ref-lines' },
            PaperList(group.matchingKey).map((line, index) => h('div', { key: index, className: 'nce-paper-ref-line nce-en' }, line))))
        : null))
}

// ---------------------------------------------------------------------------
// Tab
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 练习卷 PDF：浏览器本地渲染（src/client/09-pdf-export.js 暴露 window.PaperExportPdf）
// 预览/下载都用同一份真实 PDF 页图；不经过 host、不联网、不弹打印对话框。
// ---------------------------------------------------------------------------

function PaperPdfModal(props) {
  const { result, title, busy, progress, error, saved, onClose, onDownload, onPrint } = props
  const pages = result !== null && result !== undefined ? PaperList(result.pageImages) : []
  const ratio = progress !== null && progress !== undefined && Number.isFinite(Number(progress.ratio))
    ? Math.min(100, Math.max(0, Math.round(Number(progress.ratio) * 100)))
    : 0
  const meta = result !== null && result !== undefined
    ? `${result.pages} 页 · ${Math.max(1, Math.round(Number(result.bytes) / 1024))} KB · ${Math.round(Number(result.ms) || 0)}ms · ${result.pageWidth}×${result.pageHeight}px`
    : ''
  return h('div', { className: 'nce-paper-pdf-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': '练习卷 PDF 预览' },
    h('div', { className: 'nce-paper-pdf-modal' },
      h('header', { className: 'nce-paper-pdf-head' },
        h('div', null,
          h('div', { className: 'nce-paper-pdf-title' }, title),
          h('div', { className: 'nce-paper-pdf-sub' }, 'A4 预览 · PDF 在浏览器本地生成，下载的是真实 PDF 文件（不联网、不弹打印对话框）')),
        h('div', { className: 'nce-paper-pdf-actions' },
          h(Btn, { kind: 'primary', icon: 'download', disabled: busy, onClick: onDownload }, busy ? '生成中…' : '下载 PDF'),
          h(Btn, { kind: 'quiet', size: 'sm', icon: 'printer', onClick: onPrint }, '打印'),
          h(Btn, { kind: 'quiet', size: 'sm', icon: 'close', onClick: onClose }, '关闭'))),
      saved !== '' ? h('div', { className: 'nce-paper-pdf-saved' }, Icon('check', 12), saved) : null,
      error !== null ? h(ErrorBox, { error, title: 'PDF 生成失败' }) : null,
      h('div', { className: 'nce-paper-pdf-body' },
        busy && pages.length === 0
          ? h('div', { className: 'nce-paper-pdf-loading' },
            h('span', { className: 'nce-paper-pdf-spinner' }),
            h('span', null, `正在渲染 PDF… ${ratio}%`))
          : (pages.length === 0
            ? h('div', { className: 'nce-paper-pdf-loading' }, '还没有 PDF 预览')
            : h('div', { className: 'nce-paper-pdf-pages' }, pages.map((src, index) => h('figure', { key: index, className: 'nce-paper-pdf-page' },
              h('img', { src, alt: `练习卷第 ${index + 1} 页` }),
              h('figcaption', null, `第 ${index + 1} / ${pages.length} 页`)))))),
      h('footer', { className: 'nce-paper-pdf-foot' },
        meta !== ''
          ? `${meta} · 图片型 PDF（文字不可选中），适合打印、批改留档`
          : 'PDF 在浏览器本地生成；图片型 PDF（文字不可选中），适合打印、批改留档。')))
}

function LessonExerciseTab(props) {
  const lesson = props.lesson !== null && typeof props.lesson === 'object' ? props.lesson : {}
  const lessonId = Number(lesson.id) || 0
  const model = useMemo(() => PaperBuildModel(lesson), [lesson])
  const [paper, setPaper] = useState(() => PaperReadState(lessonId))
  const [savedAt, setSavedAt] = useState(() => {
    const restored = PaperReadState(lessonId)
    return restored.updatedAt > 0 ? restored.updatedAt : 0
  })
  const [saveFailed, setSaveFailed] = useState(false)
  const [resetArmed, setResetArmed] = useState(false)
  const [stepPending, setStepPending] = useState(false)
  const [stepError, setStepError] = useState(null)
  const [pdfOpen, setPdfOpen] = useState(false)
  const [pdfResult, setPdfResult] = useState(null)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [pdfProgress, setPdfProgress] = useState(null)
  const [pdfError, setPdfError] = useState(null)
  const [pdfSaved, setPdfSaved] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiProgress, setAiProgress] = useState({ done: 0, total: 0 })
  const [aiError, setAiError] = useState(null)
  const [aiNotice, setAiNotice] = useState('')
  const rootRef = useRef(null)
  const heroRef = useRef(null)
  const firstWriteRef = useRef(true)
  const restoredLessonRef = useRef(lessonId)
  const savedMinuteRef = useRef(0)
  const { progress, updateLesson } = useNce()

  useEffect(() => {
    // Safety net when the parent does not remount us on a lesson change.
    if (restoredLessonRef.current !== lessonId) {
      restoredLessonRef.current = lessonId
      const restored = PaperReadState(lessonId)
      firstWriteRef.current = true
      setPaper(restored)
      setSavedAt(restored.updatedAt > 0 ? restored.updatedAt : 0)
      setSaveFailed(false)
      return
    }
    // Mount (or a fresh lesson) never creates an empty draft key.
    if (firstWriteRef.current) {
      firstWriteRef.current = false
      return
    }
    const saved = PaperWriteState(lessonId, paper)
    if (saved <= 0) {
      setSaveFailed(true)
      return
    }
    setSaveFailed(false)
    // Only refresh the header label when the minute changes, not on each key.
    const minute = Math.floor(saved / 60000)
    if (minute !== savedMinuteRef.current) {
      savedMinuteRef.current = minute
      setSavedAt(saved)
    }
  }, [lessonId, paper])

  useEffect(() => {
    if (!resetArmed) return undefined
    const timer = setTimeout(() => setResetArmed(false), 4000)
    return () => clearTimeout(timer)
  }, [resetArmed])

  // Keep the 错题本 in sync with the current sheet (see 15-mistakes.js).
  useEffect(() => {
    mistakesSyncPaper(lessonId, model.titleEn !== '' ? model.titleEn : String(lesson.titleEn ?? ''), model, paper)
  }, [lessonId, lesson, model, paper])

  const stats = useMemo(() => PaperEvaluate(model, paper), [model, paper])
  const aiCandidates = useMemo(() => PaperAiCandidates(model, paper), [model, paper])
  const aiRows = useMemo(() => PaperAiRows(paper), [paper])
  const aiPending = useMemo(
    () => aiCandidates.filter((item) => aiRows[item.id] === undefined),
    [aiCandidates, aiRows],
  )

  const pdfPaperEl = () => {
    const root = rootRef.current
    if (root === null || root === undefined) return null
    if (root.classList !== undefined && root.classList.contains('nce-paper')) return root
    return root.querySelector('.nce-paper')
  }

  const buildPdf = async (modeOverride) => {
    const paperEl = pdfPaperEl()
    if (paperEl === null) throw new Error('练习卷还在渲染，请稍后再试')
    if (window.PaperExportPdf === undefined || typeof window.PaperExportPdf !== 'function') {
      throw new Error('PDF 模块没有加载成功（请刷新页面后再试；或使用「打印整卷」）')
    }
    const mode = modeOverride !== undefined ? modeOverride : (paper.graded === true ? 'graded' : 'paper')
    return window.PaperExportPdf({
      root: paperEl,
      fileName: `第${lessonId}课-练习卷-${mode === 'graded' ? '已批改' : '空白'}.pdf`,
      mode,
      title: `第 ${lessonId} 课 · 练习卷`,
      onProgress: (payload) => setPdfProgress(payload),
    })
  }

  const openPdfPreview = async () => {
    setPdfOpen(true)
    setPdfError(null)
    setPdfSaved('')
    setPdfResult(null)
    setPdfProgress(null)
    setPdfBusy(true)
    try {
      setPdfResult(await buildPdf())
    } catch (failure) {
      setPdfError(failure)
    } finally {
      setPdfBusy(false)
    }
  }

  const downloadPdf = async () => {
    if (pdfBusy) return
    setPdfError(null)
    try {
      let result = pdfResult
      if (result === null) {
        setPdfBusy(true)
        setPdfProgress(null)
        result = await buildPdf()
        setPdfResult(result)
      }
      if (typeof window.PaperPdfSave === 'function') {
        window.PaperPdfSave(result, result.fileName)
      } else {
        const url = URL.createObjectURL(result.blob)
        const link = document.createElement('a')
        link.href = url
        link.download = String(result.fileName ?? `第${lessonId}课-练习卷.pdf`)
        document.body.appendChild(link)
        link.click()
        link.remove()
        setTimeout(() => URL.revokeObjectURL(url), 30000)
      }
      setPdfSaved(`已下载 ${result.fileName} · ${result.pages} 页 · ${Math.max(1, Math.round(Number(result.bytes) / 1024))} KB`)
    } catch (failure) {
      setPdfError(failure)
    } finally {
      setPdfBusy(false)
    }
  }

  const printPdf = () => {
    const paperEl = pdfPaperEl()
    if (paperEl === null) return
    try {
      if (window.PaperPdfExport !== undefined && typeof window.PaperPdfExport.printFallback === 'function') {
        window.PaperPdfExport.printFallback({
          root: paperEl,
          mode: paper.graded === true ? 'graded' : 'paper',
          title: `第 ${lessonId} 课 · 练习卷`,
        })
      } else {
        window.print()
      }
    } catch (failure) {
      setPdfError(failure)
    }
  }

  const setAnswer = (key, value) => {
    const text = String(value ?? '').slice(0, 2000)
    setPaper((previous) => {
      const answers = { ...previous.answers }
      if (text.trim() === '') delete answers[key]
      else answers[key] = text
      // The teacher graded the old wording; drop that verdict once it changes.
      const questionId = String(key).split('#')[0]
      const ai = { ...(previous.ai !== null && typeof previous.ai === 'object' ? previous.ai : {}) }
      if (ai[questionId] !== undefined) delete ai[questionId]
      return { ...previous, answers, ai }
    })
  }

  const toggleMark = (questionId, value) => {
    setPaper((previous) => {
      const marks = { ...previous.marks }
      if (marks[questionId] === value) delete marks[questionId]
      else marks[questionId] = value
      return { ...previous, marks }
    })
  }

  const toggleReveal = (groupKey) => {
    setPaper((previous) => {
      const revealed = { ...previous.revealed }
      if (revealed[groupKey] === true) delete revealed[groupKey]
      else revealed[groupKey] = true
      return { ...previous, revealed }
    })
  }

  const allRevealed = PaperRevealedAll(model, paper)
  const toggleRevealAll = () => {
    setPaper((previous) => {
      const revealed = { ...previous.revealed }
      if (allRevealed) {
        for (const group of model.groups) delete revealed[group.key]
      } else {
        for (const group of model.groups) {
          if (group.questions.some((question) => question.referenceSource !== 'none')) revealed[group.key] = true
        }
      }
      return { ...previous, revealed }
    })
  }

  /** One grading action for the whole sheet: the AI teacher first, then the deterministic grader. */
  const gradePaper = () => {
    if (aiBusy) return
    if (paper.graded === true) {
      setPaper((previous) => ({ ...previous, graded: false }))
      return
    }
    if (aiCandidates.length === 0 || aiPending.length === 0) {
      // Nothing answered, or every answer already has a teacher verdict: just
      // show the existing grading again instead of paying for a fresh round.
      setPaper((previous) => ({ ...previous, graded: true }))
      return
    }
    if (heroRef.current !== null && typeof heroRef.current.scrollIntoView === 'function') {
      setTimeout(() => heroRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30)
    }
    void runAiGrade({ fallbackToSystem: true })
  }

  const resetPaper = () => {
    if (!resetArmed) {
      setResetArmed(true)
      return
    }
    setResetArmed(false)
    setAiError(null)
    setAiNotice('')
    try {
      window.localStorage.removeItem(`${PAPER_STORAGE_PREFIX}${lessonId}`)
    } catch {
      // Clearing is best effort; the empty state below hides the old answers.
    }
    firstWriteRef.current = true
    setSavedAt(0)
    setSaveFailed(false)
    setPaper(PaperEmptyState())
    mistakesClearLesson(lessonId)
  }

  /**
   * Ask the AI teacher to grade every answered question (batching large papers).
   * With `fallbackToSystem`, a failure never leaves the sheet ungraded: the
   * deterministic grader shows its result and a notice offers a retry.
   */
  const runAiGrade = async (options) => {
    if (aiBusy) return false
    const fallbackToSystem = options !== null && typeof options === 'object' && options.fallbackToSystem === true
    const targets = aiPending.length > 0 ? aiPending : aiCandidates
    if (targets.length === 0) {
      if (fallbackToSystem) setPaper((previous) => ({ ...previous, graded: true }))
      return false
    }
    setAiBusy(true)
    setAiError(null)
    setAiNotice('')
    setAiProgress({ done: 0, total: targets.length })
    const batchSize = 20
    try {
      const collected = []
      for (let start = 0; start < targets.length; start += batchSize) {
        const batch = targets.slice(start, start + batchSize)
        const result = await api('paper/grade', { lessonId, items: batch })
        const rows = Array.isArray(result?.items) ? result.items : []
        if (rows.length === 0) throw new Error('AI 老师没有返回批改结果，请重试')
        collected.push(...rows)
        setAiProgress({ done: Math.min(targets.length, start + batch.length), total: targets.length })
      }
      const applied = PaperAiAppliedCount(model, paper, collected)
      setPaper((previous) => PaperApplyAi(model, previous, collected))
      setAiNotice(applied < targets.length
        ? `AI 只批改了 ${applied}/${targets.length} 题；再点「AI 补批」补齐剩下的题。`
        : '')
      return true
    } catch (error) {
      if (fallbackToSystem) {
        setPaper((previous) => (previous.graded === true ? previous : { ...previous, graded: true }))
        setAiNotice(`AI 批改失败（${error.message}），已先用系统判分；可稍后点「AI 补批」重试。`)
        return false
      }
      setAiError(error)
      return false
    } finally {
      setAiBusy(false)
    }
  }

  const lessonState = progress !== null && progress.lessons !== null && typeof progress.lessons === 'object'
    ? progress.lessons[String(lessonId)]
    : undefined
  const stepDone = lessonState !== undefined && lessonState !== null && lessonState.steps !== null && typeof lessonState.steps === 'object' && lessonState.steps.exercise === true
  const markStepDone = () => {
    setStepPending(true)
    setStepError(null)
    updateLesson(lessonId, { steps: { exercise: true } })
      .catch((error) => setStepError(error))
      .finally(() => setStepPending(false))
  }

  const handleKeyDown = (event) => {
    if (event.key !== 'Enter') return
    const target = event.target
    if (target === null || target === undefined || target.tagName !== 'INPUT') return
    const root = rootRef.current
    if (root === null) return
    const inputs = Array.from(root.querySelectorAll('input[data-paper-input]'))
    const index = inputs.indexOf(target)
    if (index === -1) return
    event.preventDefault()
    const next = inputs[index + (event.shiftKey ? -1 : 1)]
    if (next !== undefined) next.focus()
    else target.blur()
  }

  if (model.groups.length === 0 || (model.stats.questions === 0 && model.stray.length === 0)) {
    return h(Empty, {
      icon: 'pen',
      title: '这一课没有练习',
      text: '课文书面练习和语法练习册都没有这一课的题目，去复习 tab 把单词过一遍吧。',
    })
  }

  const savedLabel = savedAt > 0
    ? new Date(savedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : ''
  const totalAnswerable = stats.total
  // One grading channel: once the AI teacher has verdicts, the score is its
  // judgement over the whole sheet (unanswered questions stay 未答 and count
  // against the total, like a teacher marking a partially filled paper).
  const aiMode = stats.aiJudged > 0
  const pendingJudge = stats.statusCounts.unrated + stats.statusCounts.open
  const scorePct = aiMode ? stats.aiScore : stats.score
  const scoreValue = aiMode ? `${stats.statusCounts.correct} / ${stats.total}` : `${stats.autoCorrect} / ${stats.gradable}`
  const scoreHint = paper.graded === true && !aiMode ? PaperScoreHint(model, stats, paper) : ''
  const aiProgressLabel = aiProgress.total > 0 ? `AI 批改中 ${aiProgress.done}/${aiProgress.total}…` : 'AI 批改中…'
  const aiPendingLabel = aiMode ? `AI 补批 ${aiPending.length} 题` : `AI 批改 ${aiPending.length} 题`
  const gradeLabel = paper.graded === true ? '收起批改' : (aiBusy ? aiProgressLabel : '批改整卷')
  const titleEn = model.titleEn !== '' ? model.titleEn : String(lesson.titleEn ?? '').trim()
  const titleZh = model.titleZh !== '' ? model.titleZh : String(lesson.titleZh ?? '').trim()

  return h('div', {
    className: 'nce-paper',
    'data-paper-lesson': String(lessonId),
    ref: rootRef,
    onKeyDown: handleKeyDown,
  },
  h('section', { className: 'nce-paper-hero nce-card', ref: heroRef },
    h('div', { className: 'nce-paper-hero-main' },
      h('div', { className: 'nce-paper-kicker' }, '练习卷 · WORKSHEET'),
      h('h2', { className: 'nce-paper-hero-title' },
        h('span', { className: 'nce-paper-hero-no' }, `第 ${lessonId} 课`),
        titleEn !== '' ? h('span', { className: 'nce-paper-hero-en nce-en' }, titleEn) : null),
      titleZh !== '' ? h('p', { className: 'nce-paper-hero-sub' }, titleZh) : null,
      h('div', { className: 'nce-paper-hero-stats' },
        h('span', { className: 'nce-paper-stat' }, h('b', null, String(stats.answered)), ` / ${totalAnswerable} 题已答`),
        h('span', { className: 'nce-paper-stat' }, '可判分 ', h('b', null, String(stats.gradable)), ' 题'),
        stats.examples > 0 ? h('span', { className: 'nce-paper-stat is-muted' }, `${stats.examples} 个例句`) : null,
        saveFailed
          ? h('span', { className: 'nce-paper-saved is-warn' }, Icon('info', 12), '自动保存失败：浏览器存储不可用，请先复制答案')
          : (savedLabel !== ''
            ? h('span', { className: 'nce-paper-saved' }, Icon('check', 12), `已自动保存 ${savedLabel}`)
            : h('span', { className: 'nce-paper-saved' }, Icon('check', 12), '写下的答案会自动保存在本机'))),
      h(Bar, { value: stats.answered, total: totalAnswerable, className: 'nce-paper-bar' }),
      paper.graded !== true
        ? h('p', { className: 'nce-paper-grade-hint' },
          aiCandidates.length > 0
            ? `写完后点「批改整卷」：AI 老师会逐题批改全部 ${aiCandidates.length} 道已答题，给出判对 / 点评 / 参考答案；没有默认模型时会退回系统判分。`
            : '先把答案写上去，再点「批改整卷」：AI 老师会逐题批改并给参考答案。')
        : null),
    paper.graded === true
      ? h('div', { className: 'nce-paper-hero-side' },
        h('div', { className: 'nce-paper-score', 'data-paper-score': '', role: 'status', 'aria-live': 'polite' },
          h('div', { className: 'nce-paper-score-main' },
            h('span', { className: 'nce-paper-score-label' }, '得分'),
            h('span', {
              className: cx('nce-paper-score-value', scorePct >= 85 ? 'is-good' : scorePct >= 60 ? 'is-mid' : 'is-low'),
            }, scoreValue)),
          aiMode
            ? h('div', { className: 'nce-paper-score-note' },
              'AI 老师：',
              `正确 ${stats.statusCounts.correct}`,
              stats.statusCounts.close > 0 ? ` · 近似 ${stats.statusCounts.close}` : '',
              ` · 错误 ${stats.statusCounts.wrong}`,
              stats.statusCounts.blank > 0 ? ` · 未答 ${stats.statusCounts.blank}` : '',
              pendingJudge > 0 ? ` · 待批 ${pendingJudge}` : '')
            : h('div', { className: 'nce-paper-score-note' },
              `正确 ${stats.autoCorrect}`,
              ` · 错误 ${stats.autoWrong}`,
              stats.autoClose > 0 ? ` · 近似 ${stats.autoClose}` : '',
              stats.blankGradable > 0 ? ` · 未答 ${stats.blankGradable}` : '',
              stats.unrated > 0 ? ` · 待自评 ${stats.unrated}` : '',
              stats.selfRight + stats.selfWrong > 0 ? ` · 自评 ${stats.selfRight} 对 / ${stats.selfWrong} 错` : ''),
          scoreHint !== '' ? h('p', { className: 'nce-paper-score-hint' }, scoreHint) : null,
          aiMode
            ? h('div', { className: 'nce-paper-score-ai' }, 'AI 老师批改 · 每题「判对 / 判错」可手改')
            : null))
      : null,
    h('div', { className: 'nce-paper-toolbar' },
      h('div', { className: 'nce-paper-toolbar-main' },
        h(Btn, {
          kind: paper.graded === true ? 'soft' : 'primary',
          className: 'nce-paper-grade',
          icon: paper.graded === true ? 'eye' : 'spark',
          disabled: aiBusy,
          title: paper.graded === true
            ? '隐藏批改与参考答案'
            : '让 AI 老师批改整卷（没有默认模型时退回系统判分）',
          onClick: gradePaper,
        }, gradeLabel),
        paper.graded === true && aiPending.length > 0
          ? h(Btn, {
            kind: 'soft',
            size: 'sm',
            icon: 'spark',
            className: 'nce-paper-ai-grade',
            disabled: aiBusy,
            title: `把这 ${aiPending.length} 道还没有 AI 判词的题发给 AI 老师`,
            onClick: () => { void runAiGrade() },
          }, aiBusy ? aiProgressLabel : aiPendingLabel)
          : null,
        paper.graded === true && !stepDone
          ? h(Btn, {
            kind: 'ghost',
            size: 'sm',
            icon: 'check',
            disabled: stepPending,
            onClick: markStepDone,
          }, stepPending ? '保存中…' : '标记练习完成')
          : null,
        stepDone ? h('span', { className: 'nce-paper-stepdone' }, Icon('check', 12), '本课练习已完成') : null),
      h('div', { className: 'nce-paper-toolbar-utils' },
        h(Btn, {
          kind: 'quiet',
          size: 'sm',
          icon: 'eye',
          active: allRevealed,
          'aria-expanded': allRevealed,
          onClick: toggleRevealAll,
        }, allRevealed ? '收起答案' : '显示全部答案'),
        h(Btn, {
          kind: 'quiet',
          size: 'sm',
          className: 'nce-paper-reset',
          icon: 'refresh',
          onClick: resetPaper,
        }, resetArmed ? '再点一次清空' : '清空答案'),
        h(Btn, {
          kind: 'quiet',
          size: 'sm',
          icon: 'eye',
          title: '预览 PDF（A4）并下载',
          onClick: openPdfPreview,
        }, '预览 PDF'),
        h(Btn, {
          kind: 'quiet',
          size: 'sm',
          icon: 'list',
          title: '打印整卷（浏览器打印对话框，可另存为 PDF）',
          onClick: () => {
            try {
              window.print()
            } catch {
              // Printing is best effort; embedded webviews may block it.
            }
          },
        }, '打印整卷'))),
    aiNotice !== '' ? h('p', { className: 'nce-paper-ai-notice' }, aiNotice) : null,
    aiError !== null ? h('p', { className: 'nce-paper-ai-error' }, `AI 老师批改失败：${aiError.message}`) : null,
    stepError !== null ? h(ErrorBox, { error: stepError, title: '学习步骤没有保存成功' }) : null),
  model.groups.map((group) => h(PaperGroupCard, {
    key: group.key,
    group,
    paper,
    counters: stats.groups[group.key],
    statuses: stats.statuses,
    onAnswer: setAnswer,
    onMark: toggleMark,
    onReveal: toggleReveal,
  })),
  model.stray.length > 0
    ? h('section', { className: 'nce-paper-stray nce-card' },
      h('div', { className: 'nce-paper-stray-head' },
        h('div', null,
          h('h3', { className: 'nce-paper-stray-title' }, '其他参考答案'),
          h('p', { className: 'nce-paper-stray-hint' }, '练习册里没有找到对应题目，只作参考')),
        h(Btn, {
          kind: 'quiet',
          size: 'sm',
          icon: 'eye',
          active: paper.revealed.stray === true,
          onClick: () => toggleReveal('stray'),
        }, paper.revealed.stray === true ? '隐藏答案' : '显示答案')),
      paper.revealed.stray === true
        ? h('div', { className: 'nce-paper-ref-lines' },
          model.stray.map((entry, index) => h('div', { key: index, className: 'nce-paper-stray-block' },
            h('div', { className: 'nce-paper-stray-label' }, entry.label !== '' ? entry.label : `答案 ${index + 1}`),
            entry.lines.map((line, lineIndex) => h('div', { key: lineIndex, className: 'nce-paper-ref-line nce-en' }, line)))))
        : null)
    : null,
  pdfOpen
    ? h(PaperPdfModal, {
      result: pdfResult,
      title: `第 ${lessonId} 课 · 练习卷 PDF`,
      busy: pdfBusy,
      progress: pdfProgress,
      error: pdfError,
      saved: pdfSaved,
      onClose: () => setPdfOpen(false),
      onDownload: downloadPdf,
      onPrint: printPdf,
    })
    : null)
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

addCss(`
  .nce-paper { display: flex; flex-direction: column; gap: 16px; container-type: inline-size; }
  .nce-paper .nce-en { font-family: var(--nce-font-reading); letter-spacing: .004em; }
  .nce-paper-hero {
    padding: 18px 20px 14px; border-radius: 14px;
    display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px 24px; align-items: start;
    background:
      radial-gradient(120% 140% at 0% 0%, color-mix(in srgb, var(--dsw-alias-brand-primary, #4c8dff) 6%, transparent) 0%, transparent 55%),
      var(--dsw-alias-bg-layer-1, rgba(127,127,127,.04));
  }
  .nce-paper-hero-main { min-width: 0; }
  .nce-paper-hero-side { display: flex; flex-direction: column; gap: 10px; align-items: flex-end; max-width: 100%; }
  .nce-paper-kicker {
    font-size: 10px; font-weight: 650; letter-spacing: .16em; text-transform: uppercase;
    color: var(--dsw-alias-brand-primary, #4c8dff);
  }
  .nce-paper-hero-title {
    margin: 6px 0 0; display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 10px;
    font-size: 20px; font-weight: 680; line-height: 1.3; letter-spacing: -.008em;
  }
  .nce-paper-hero-no { flex: none; }
  .nce-paper-hero-en { font-size: 16px; font-weight: 600; }
  .nce-paper-hero-sub { margin: 4px 0 0; font-size: 12.5px; color: var(--dsw-alias-label-secondary, #8a8f98); }
  .nce-paper-hero-stats { margin-top: 12px; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 16px; font-size: 12px; color: var(--dsw-alias-label-secondary, #8a8f98); }
  .nce-paper-stat b { color: var(--dsw-alias-label-primary, #1f2328); font-weight: 650; }
  .nce-paper-stat.is-muted { opacity: .72; }
  .nce-paper-saved { display: inline-flex; align-items: center; gap: 4px; font-size: 10.5px; opacity: .7; }
  .nce-paper-bar { margin-top: 10px; max-width: 460px; }
  .nce-paper-grade-hint { margin: 10px 0 0; max-width: 560px; font-size: 11.5px; line-height: 1.7; color: var(--dsw-alias-label-secondary, #8a8f98); }
  .nce-paper-toolbar {
    grid-column: 1 / -1;
    display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
    margin-top: 4px; padding-top: 13px;
    border-top: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.16));
  }
  .nce-paper-toolbar-main { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .nce-paper-toolbar-utils { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; margin-left: auto; }
  .nce-paper-stepdone { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: var(--dsw-alias-state-success-primary, #2f9e44); }
  .nce-paper-score {
    padding: 12px 16px; border-radius: 12px;
    display: flex; flex-direction: column; align-items: flex-end; gap: 3px;
    border: 1px solid color-mix(in srgb, var(--dsw-alias-brand-primary, #4c8dff) 25%, transparent);
    background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4c8dff) 6%, transparent);
  }
  .nce-paper-score-main { display: flex; align-items: baseline; gap: 7px; }
  .nce-paper-score-label { font-size: 11px; color: var(--dsw-alias-label-secondary, #8a8f98); letter-spacing: .1em; }
  .nce-paper-score-value { font-size: 30px; font-weight: 720; line-height: 1; font-variant-numeric: tabular-nums; color: var(--dsw-alias-state-error-primary, #d6393f); }
  .nce-paper-score-value.is-good { color: var(--dsw-alias-state-success-primary, #2f9e44); }
  .nce-paper-score-value.is-mid { color: var(--dsw-alias-state-warn-primary, #d97706); }
  .nce-paper-score-value.is-low { color: var(--dsw-alias-state-error-primary, #d6393f); }
  .nce-paper-score-note { font-size: 11px; color: var(--dsw-alias-label-secondary, #8a8f98); }
  .nce-paper-score-hint { margin: 5px 0 0; max-width: 340px; font-size: 10.5px; line-height: 1.65; text-align: right; color: var(--dsw-alias-state-warn-primary, #d97706); }
  .nce-paper-score-ai { margin-top: 3px; font-size: 10.5px; font-weight: 600; color: var(--dsw-alias-brand-primary, #4c8dff); }
  .nce-paper-ai-error { grid-column: 1 / -1; margin: 2px 0 0; font-size: 11.5px; line-height: 1.6; color: var(--dsw-alias-state-error-primary, #d6393f); }
  .nce-paper-ai-notice { grid-column: 1 / -1; margin: 2px 0 0; font-size: 11.5px; line-height: 1.6; color: var(--dsw-alias-state-warn-primary, #d97706); }
  .nce-paper-group { padding: 18px 20px 8px; border-radius: 14px; }
  .nce-paper-group-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-start; gap: 12px 18px; }
  .nce-paper-group-titles { flex: 1; min-width: 220px; }
  .nce-paper-group-titleline { display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px; }
  .nce-paper-group-index { font-size: 16px; font-weight: 680; color: var(--dsw-alias-label-primary, #1f2328); }
  .nce-paper-group-label {
    flex: none; min-width: 26px; height: 22px; padding: 0 8px; border-radius: 7px;
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 11px; font-weight: 680; letter-spacing: .03em;
    color: var(--dsw-alias-brand-primary, #4c8dff);
    background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4c8dff) 10%, transparent);
  }
  .nce-paper-group-title { margin: 0; font-size: 15px; font-weight: 680; line-height: 1.45; }
  .nce-paper-group-sub { margin: 4px 0 0; font-size: 12.5px; line-height: 1.6; color: var(--dsw-alias-label-secondary, #8a8f98); }
  .nce-paper-group-freehint { margin: 8px 0 0; font-size: 12px; line-height: 1.65; color: var(--dsw-alias-state-warn-primary, #d97706); }
  .nce-paper-group-notes { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
  .nce-paper-group-notes > li { font-size: 12px; line-height: 1.7; color: var(--dsw-alias-label-secondary, #8a8f98); white-space: pre-wrap; }
  .nce-paper-group-side { flex: none; display: flex; flex-direction: column; align-items: flex-end; gap: 7px; }
  .nce-paper-group-meta { font-size: 11px; color: var(--dsw-alias-label-secondary, #8a8f98); font-variant-numeric: tabular-nums; }
  .nce-paper-group-meta.is-warn {
    padding: 2px 8px; border-radius: 999px;
    color: var(--dsw-alias-state-warn-primary, #d97706);
    background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #d97706) 9%, transparent);
  }
  .nce-paper-wordbox {
    margin-top: 14px; padding: 11px 14px; border-radius: 10px;
    border: 1.5px solid var(--dsw-alias-border-l2, rgba(127,127,127,.45));
    background: var(--dsw-alias-bg-layer-1, rgba(127,127,127,.04));
  }
  .nce-paper-wordbox-label { font-size: 10px; font-weight: 650; letter-spacing: .14em; color: var(--dsw-alias-label-secondary, #8a8f98); margin-bottom: 7px; }
  .nce-paper-wordbox-words { display: flex; flex-wrap: wrap; gap: 5px 10px; }
  .nce-paper-wordbox-word { padding: 3px 10px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.28)); background: var(--dsw-alias-bg-base, #fff); font-size: 12.5px; }
  .nce-paper-ai {
    margin-top: 10px; padding: 10px 13px; border-radius: 10px;
    display: flex; flex-direction: column; gap: 6px;
    border: 1px solid color-mix(in srgb, var(--dsw-alias-brand-primary, #4c8dff) 26%, transparent);
    background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4c8dff) 5%, transparent);
  }
  .nce-paper-ai-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 3px 10px; }
  .nce-paper-ai-tag {
    display: inline-flex; align-items: center; gap: 4px;
    font-size: 10.5px; font-weight: 650; white-space: nowrap;
    color: var(--dsw-alias-brand-primary, #4c8dff);
  }
  .nce-paper-ai-tag.is-correct { color: var(--dsw-alias-state-success-primary, #2f9e44); }
  .nce-paper-ai-tag.is-wrong { color: var(--dsw-alias-state-error-primary, #d6393f); }
  .nce-paper-ai-tag.is-close { color: var(--dsw-alias-state-warn-primary, #d97706); }
  .nce-paper-ai-comment { font-size: 12px; line-height: 1.65; color: var(--dsw-alias-label-secondary, #8a8f98); }
  .nce-paper-ai-answer { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; font-size: 12.5px; line-height: 1.7; }
  .nce-paper-ai-answer-label {
    flex: none; font-size: 9.5px; font-weight: 650; letter-spacing: .06em;
    color: var(--dsw-alias-label-secondary, #8a8f98);
  }
  .nce-paper-ai-answer-text { color: var(--dsw-alias-label-primary, #1f2328); }
  .nce-paper-example {
    margin-top: 14px; padding: 11px 14px; border-radius: 10px;
    border-left: 3px solid var(--dsw-alias-brand-primary, #4c8dff);
    background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4c8dff) 5%, transparent);
  }
  .nce-paper-example-label { font-size: 10px; font-weight: 650; letter-spacing: .14em; color: var(--dsw-alias-brand-primary, #4c8dff); }
  .nce-paper-example-row { margin-top: 5px; }
  .nce-paper-example-en { font-size: 13px; line-height: 1.65; }
  .nce-paper-example-zh { font-size: 12px; color: var(--dsw-alias-label-secondary, #8a8f98); }
  .nce-paper-example-line { margin-top: 5px; font-size: 12.5px; line-height: 1.7; }
  .nce-paper-table-wrap { margin-top: 12px; overflow: auto; }
  .nce-paper-table { border-collapse: collapse; font-size: 12.5px; min-width: 200px; }
  .nce-paper-table td { border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.24)); padding: 6px 11px; min-width: 64px; }
  .nce-paper-questions { list-style: none; margin: 18px 0 0; padding: 0; display: flex; flex-direction: column; }
  .nce-paper-q { display: flex; align-items: flex-start; gap: 12px; padding: 12px 2px; border-top: 1px dashed var(--dsw-alias-border-l1, rgba(127,127,127,.18)); }
  .nce-paper-q:first-child { border-top: 0; }
  .nce-paper-q.is-example { opacity: .82; }
  .nce-paper-q-head { flex: none; width: 36px; display: flex; flex-direction: column; align-items: center; gap: 4px; padding-top: 1px; }
  .nce-paper-q-num {
    min-width: 26px; height: 24px; padding: 0 6px; border-radius: 8px;
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 11.5px; font-weight: 650; font-variant-numeric: tabular-nums;
    color: var(--dsw-alias-label-secondary, #8a8f98);
    background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.12));
  }
  .nce-paper-q-tag {
    font-size: 9px; padding: 1px 5px; border-radius: 999px; white-space: nowrap;
    color: var(--dsw-alias-label-secondary, #8a8f98);
    border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.24));
  }
  .nce-paper-q-body { flex: 1; min-width: 0; }
  .nce-paper-prompt { font-size: 13.5px; line-height: 2; }
  .nce-paper-line { white-space: pre-wrap; word-break: break-word; }
  .nce-paper-fragment { white-space: pre-wrap; }
  .nce-paper-blank {
    display: inline-block; vertical-align: baseline;
    min-width: 54px; margin: 0 2px; padding: 0 5px;
    border: 0; border-bottom: 1.5px solid var(--dsw-alias-border-l2, rgba(127,127,127,.5));
    border-radius: 3px 3px 0 0;
    background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4c8dff) 5%, transparent);
    color: var(--dsw-alias-label-primary, #1f2328);
    font-family: var(--nce-font-reading); font-size: 13.5px; line-height: 1.75;
    outline: none; transition: border-color .14s ease, background .14s ease;
  }
  .nce-paper-blank:hover { border-bottom-color: var(--dsw-alias-brand-primary, #4c8dff); }
  .nce-paper-blank:focus { border-bottom-color: var(--dsw-alias-brand-primary, #4c8dff); background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4c8dff) 10%, transparent); }
  .nce-paper-q.is-correct .nce-paper-blank,
  .nce-paper-q.is-correct .nce-paper-answer { border-color: var(--dsw-alias-state-success-primary, #2f9e44); }
  .nce-paper-q.is-wrong .nce-paper-blank,
  .nce-paper-q.is-wrong .nce-paper-answer { border-color: var(--dsw-alias-state-error-primary, #d6393f); }
  .nce-paper-prompt-empty { font-size: 11px; color: var(--dsw-alias-label-tertiary, #9aa0a8); }
  .nce-paper-lines { display: flex; flex-direction: column; gap: 8px; }
  .nce-paper-line-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .nce-paper-line-text { flex: 1 1 auto; min-width: 0; }
  .nce-paper-line-answer { flex: 0 1 44%; min-width: 170px; padding: 5px 10px; }
  .nce-paper-line-mark { flex: 0 0 auto; width: 16px; height: 16px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; }
  .nce-paper-line-mark.is-correct { color: var(--dsw-alias-state-success-primary, #2f9e44); background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #2f9e44) 14%, transparent); }
  .nce-paper-line-mark.is-wrong { color: var(--dsw-alias-state-error-primary, #d6393f); background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #d6393f) 14%, transparent); }
  .nce-paper-example { display: flex; flex-direction: column; gap: 4px; }
  .nce-paper-example-row { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; }
  .nce-paper-example-q { flex: 1 1 auto; min-width: 0; }
  .nce-paper-example-a { flex: 0 1 44%; min-width: 150px; color: var(--dsw-alias-label-secondary, #5a6069); border-bottom: 1px dotted var(--dsw-alias-border-l2, rgba(127,127,127,.45)); }
  .nce-paper-answerline { margin-top: 6px; }
  .nce-paper-answer {
    width: 100%; box-sizing: border-box;
    padding: 9px 12px; border-radius: 9px;
    border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.3));
    border-bottom: 1.5px solid var(--dsw-alias-border-l2, rgba(127,127,127,.45));
    background: color-mix(in srgb, var(--dsw-alias-bg-base, #fff) 55%, transparent);
    color: var(--dsw-alias-label-primary, #1f2328);
    font-family: var(--nce-font-reading); font-size: 13.5px; line-height: 1.65; outline: none;
    transition: border-color .14s ease, box-shadow .14s ease;
  }
  .nce-paper-answer:focus {
    border-color: var(--dsw-alias-brand-primary, #4c8dff);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary, #4c8dff) 14%, transparent);
  }
  .nce-paper-mark {
    width: 18px; height: 18px; border-radius: 50%;
    display: inline-flex; align-items: center; justify-content: center;
  }
  .nce-paper-mark.is-correct { color: var(--dsw-alias-state-success-primary, #2f9e44); background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #2f9e44) 13%, transparent); }
  .nce-paper-mark.is-wrong { color: var(--dsw-alias-state-error-primary, #d6393f); background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #d6393f) 13%, transparent); }
  .nce-paper-mark.is-close { color: var(--dsw-alias-state-warn-primary, #d97706); background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #d97706) 13%, transparent); font-size: 12px; font-weight: 700; }
  .nce-paper-verdict { margin-top: 7px; padding-top: 7px; border-top: 1px dashed var(--dsw-alias-border-l1, rgba(127,127,127,.22)); display: flex; flex-wrap: wrap; align-items: flex-start; gap: 8px 12px; }
  .nce-paper-pill {
    flex: none; height: 21px; padding: 0 9px; border-radius: 999px;
    display: inline-flex; align-items: center; font-size: 10.5px; font-weight: 650;
    color: var(--dsw-alias-label-secondary, #8a8f98);
    background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.12));
  }
  .nce-paper-pill.is-correct { color: var(--dsw-alias-state-success-primary, #2f9e44); background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #2f9e44) 12%, transparent); }
  .nce-paper-pill.is-wrong { color: var(--dsw-alias-state-error-primary, #d6393f); background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #d6393f) 12%, transparent); }
  .nce-paper-pill.is-close { color: var(--dsw-alias-state-warn-primary, #d97706); background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #d97706) 12%, transparent); }
  .nce-paper-pill.is-open, .nce-paper-pill.is-unrated, .nce-paper-pill.is-blank { color: var(--dsw-alias-label-secondary, #8a8f98); }
  .nce-paper-ref { flex: 1; min-width: 180px; display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; }
  .nce-paper-ref-label { flex: none; font-size: 9.5px; font-weight: 650; letter-spacing: .1em; color: var(--dsw-alias-state-success-primary, #2f9e44); }
  .nce-paper-ref-lines { flex: 1; min-width: 140px; display: flex; flex-direction: column; gap: 2px; }
  .nce-paper-ref-line { font-size: 12.5px; line-height: 1.7; color: var(--dsw-alias-label-primary, #1f2328); white-space: pre-wrap; word-break: break-word; }
  .nce-paper-ref.is-empty { align-items: center; }
  .nce-paper-ref.is-empty .nce-paper-ref-label { color: var(--dsw-alias-label-secondary, #8a8f98); }
  .nce-paper-ref-hint { font-size: 11px; color: var(--dsw-alias-label-secondary, #8a8f98); }
  .nce-paper-selfmark { flex: none; display: flex; align-items: center; gap: 4px; margin-left: auto; }
  .nce-paper-self-btn {
    display: inline-flex; align-items: center; gap: 3px; height: 24px; padding: 0 8px;
    border-radius: 7px; border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.24));
    background: transparent; color: var(--dsw-alias-label-secondary, #8a8f98);
    font: inherit; font-size: 10.5px; cursor: pointer;
    transition: color .12s ease, border-color .12s ease, background .12s ease;
  }
  .nce-paper-self-btn:hover { color: var(--dsw-alias-label-primary, #1f2328); border-color: var(--dsw-alias-border-l2, rgba(127,127,127,.45)); }
  .nce-paper-self-btn.is-on.is-right { color: var(--dsw-alias-state-success-primary, #2f9e44); border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary, #2f9e44) 45%, transparent); background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #2f9e44) 10%, transparent); }
  .nce-paper-self-btn.is-on.is-wrong { color: var(--dsw-alias-state-error-primary, #d6393f); border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, #d6393f) 45%, transparent); background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #d6393f) 10%, transparent); }

  .nce-paper-stray { padding: 14px 16px; }
  .nce-paper-stray-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
  .nce-paper-stray-title { margin: 0; font-size: 12.5px; font-weight: 650; }
  .nce-paper-stray-hint { margin: 2px 0 0; font-size: 11px; color: var(--dsw-alias-label-secondary, #8a8f98); }
  .nce-paper-stray-block + .nce-paper-stray-block { margin-top: 10px; }
  .nce-paper-stray-label { margin-bottom: 3px; font-size: 11px; font-weight: 600; color: var(--dsw-alias-brand-primary, #4c8dff); }
  .nce-paper-saved.is-warn { color: var(--dsw-alias-state-error-primary, #d6393f); opacity: 1; }
  .nce-paper-match { margin: 8px 0 4px; }
  .nce-paper-match-tip { font-size: 11px; line-height: 1.6; color: var(--dsw-alias-label-secondary, #8a8f98); margin-bottom: 8px; }
  .nce-paper-match-columns {
    display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 14px;
    align-items: start;
  }
  .nce-paper-match-side { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .nce-paper-match-head {
    font-size: 10.5px; font-weight: 650; letter-spacing: .08em; text-transform: uppercase;
    color: var(--dsw-alias-label-secondary, #8a8f98); padding: 0 0 6px; border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.2));
    margin-bottom: 4px;
  }
  .nce-paper-match-row {
    display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px;
    padding: 6px 2px; border-bottom: 1px dashed var(--dsw-alias-border-l1, rgba(127,127,127,.16));
  }
  .nce-paper-match-row.is-correct .nce-paper-match-text { color: var(--dsw-alias-state-success-primary, #2f9e44); }
  .nce-paper-match-row.is-wrong .nce-paper-match-text { color: var(--dsw-alias-state-error-primary, #d6393f); }
  .nce-paper-match-row.is-close .nce-paper-match-text { color: var(--dsw-alias-state-warn-primary, #d97706); }
  .nce-paper-match-num { flex: none; min-width: 18px; font-size: 11px; color: var(--dsw-alias-label-secondary, #8a8f98); font-variant-numeric: tabular-nums; }
  .nce-paper-match-text { flex: 1; min-width: 0; font-size: 12.5px; line-height: 1.6; }
  .nce-paper-match-input {
    flex: none; width: 66px; height: 26px; padding: 0 7px; border-radius: 6px;
    border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.4));
    background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.07));
    color: var(--dsw-alias-label-primary, #1f2328);
    font: 12px/1 var(--dsw-alias-font-mono, ui-monospace, Menlo, monospace);
    letter-spacing: .06em;
  }
  .nce-paper-match-input:focus { outline: none; border-color: var(--dsw-alias-brand-primary, #4c8dff); background: var(--dsw-alias-bg-base, #fff); }
  .nce-paper-match-verdict { flex-basis: 100%; display: flex; flex-wrap: wrap; align-items: center; gap: 5px 8px; padding: 2px 0 2px 24px; }
  .nce-paper-match-ref { font-size: 11.5px; line-height: 1.55; color: var(--dsw-alias-label-secondary, #8a8f98); }
  .nce-paper-match-option { display: flex; gap: 7px; padding: 6px 2px; font-size: 12.5px; line-height: 1.6; border-bottom: 1px dashed var(--dsw-alias-border-l1, rgba(127,127,127,.16)); }
  .nce-paper-match-letter { flex: none; min-width: 16px; color: var(--dsw-alias-brand-primary, #4c8dff); font-weight: 600; font-size: 11.5px; }
  .nce-paper-match-option-text { min-width: 0; }
  .nce-paper-match-note { margin: 8px 0 0; font-size: 11px; color: var(--dsw-alias-label-secondary, #8a8f98); }
  .nce-paper-match-meta { display: flex; gap: 12px; margin-top: 8px; font-size: 10.5px; color: var(--dsw-alias-label-secondary, #8a8f98); }
  .nce-paper-match-meta .is-warn { color: var(--dsw-alias-state-warn-primary, #d97706); }
  .nce-paper-matching { margin: 12px 0 4px; padding-top: 10px; border-top: 1px dashed var(--dsw-alias-border-l1, rgba(127,127,127,.24)); }
  .nce-paper-matching > summary { cursor: pointer; font-size: 11.5px; font-weight: 600; color: var(--dsw-alias-brand-primary, #4c8dff); }
  .nce-paper-matching .nce-paper-ref-lines { margin-top: 7px; }

  @container (max-width: 760px) {
    .nce-paper-match-columns { grid-template-columns: minmax(0, 1fr); gap: 10px; }
  }
  /* The panel can be narrow while the viewport is wide (lesson list on the
     left), so the paper stacks by its own width. */
  @container (max-width: 720px) {
    .nce-paper-line-row, .nce-paper-example-row { display: block; }
    .nce-paper-line-answer { width: 100%; min-width: 0; box-sizing: border-box; margin-top: 4px; }
    .nce-paper-example-a { display: block; margin-top: 2px; }
    .nce-paper-hero { grid-template-columns: minmax(0, 1fr); padding: 16px; }
    .nce-paper-hero-side { align-items: flex-start; }
    .nce-paper-score { align-items: flex-start; }
    .nce-paper-grade-hint { max-width: none; }
    .nce-paper-score-hint { text-align: left; max-width: 360px; }
    .nce-paper-toolbar-utils { margin-left: 0; width: 100%; }
    .nce-paper-q-head { width: 30px; }
    .nce-paper-selfmark { margin-left: 0; }
  }

  @media print {
    @page { size: A4; margin: 13mm 11mm; }
    .nce-subnav, .nce-lesson-head, .nce-paper-toolbar,
    .nce-paper-grade-hint, .nce-paper-score-hint, .nce-paper-score-ai, .nce-paper-ai-error, .nce-paper-ai-notice, .nce-paper-saved, .nce-paper-matching,
    .nce-paper { gap: 8px; }
    /* A whole group can be taller than one A4 page: let it split, but never
       split a question row / table row / matching row across pages. */
    .nce-paper-hero { break-inside: avoid; }
    .nce-paper-group { break-inside: auto; padding-bottom: 10px; }
    .nce-paper-q, .nce-paper-match-row, .nce-paper-table tr, .nce-paper-example { break-inside: avoid; }
    .nce-paper-selfmark { display: none !important; }
    /* The panel is normally an internal scroller; printing needs the whole paper. */
    .nce-root, .nce-scroll, .nce-split-main, .nce-wrap, .nce-lesson-tabpane,
    .nce-home, .nce-split { height: auto !important; max-height: none !important; overflow: visible !important; position: static !important; }
    .nce-scroll { display: block !important; }
    html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }

  /* PDF preview modal (preview uses the same DOM/print styles as the export) */
  .nce-paper-pdf-overlay {
    position: fixed; inset: 0; z-index: 400; display: flex; align-items: center; justify-content: center;
    padding: 22px; background: rgba(20, 24, 31, .55); backdrop-filter: blur(2px);
  }
  .nce-paper-pdf-modal {
    width: min(1180px, 96vw); height: min(92vh, 1100px); display: flex; flex-direction: column;
    border-radius: 14px; overflow: hidden; background: var(--dsw-alias-bg-base, #fff);
    box-shadow: 0 24px 80px rgba(0, 0, 0, .35);
  }
  .nce-paper-pdf-head {
    display: flex; align-items: flex-start; justify-content: space-between; gap: 14px;
    padding: 13px 16px; border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.2));
    background: var(--dsw-alias-bg-layer-1, rgba(127,127,127,.04));
  }
  .nce-paper-pdf-title { font-size: 14px; font-weight: 650; }
  .nce-paper-pdf-sub { margin-top: 2px; font-size: 11px; color: var(--dsw-alias-label-secondary, #8a8f98); }
  .nce-paper-pdf-actions { display: flex; flex-wrap: wrap; gap: 7px; align-items: center; }
  .nce-paper-pdf-saved {
    display: flex; align-items: center; gap: 5px; padding: 7px 16px; font-size: 11.5px;
    color: var(--dsw-alias-state-success-primary, #2f9e44);
    background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #2f9e44) 8%, transparent);
  }
  .nce-paper-pdf-modal > div[class*="nce-error"], .nce-paper-pdf-modal > .nce-errorbox { margin: 8px 16px 0; }
  .nce-paper-pdf-body { flex: 1; min-height: 0; overflow: auto; padding: 16px; background: #e9ebee; }
  .nce-paper-pdf-loading {
    height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
    font-size: 12px; color: var(--dsw-alias-label-secondary, #8a8f98);
  }
  .nce-paper-pdf-spinner {
    width: 22px; height: 22px; border-radius: 50%;
    border: 2px solid color-mix(in srgb, var(--dsw-alias-brand-primary, #4c8dff) 25%, transparent);
    border-top-color: var(--dsw-alias-brand-primary, #4c8dff);
    animation: nce-paper-pdf-spin .8s linear infinite;
  }
  @keyframes nce-paper-pdf-spin { to { transform: rotate(360deg); } }
  .nce-paper-pdf-pages { display: flex; flex-direction: column; align-items: center; gap: 16px; }
  .nce-paper-pdf-page {
    margin: 0; background: #fff; border-radius: 2px; max-width: 100%;
    box-shadow: 0 2px 12px rgba(0, 0, 0, .18);
  }
  .nce-paper-pdf-page img { display: block; width: 100%; max-width: 794px; height: auto; }
  .nce-paper-pdf-page figcaption { padding: 5px 8px; font-size: 10px; text-align: center; color: var(--dsw-alias-label-secondary, #8a8f98); }
  .nce-paper-pdf-foot {
    padding: 8px 16px; font-size: 10.5px; color: var(--dsw-alias-label-secondary, #8a8f98);
    border-top: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.2));
  }
`)
