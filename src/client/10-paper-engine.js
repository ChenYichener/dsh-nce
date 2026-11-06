// Layer: 10 paper-engine — pure domain; depends on: nothing (no React, DOM, storage, network or host API).
// The fillable 练习卷 engine: grammar-workbook answers → question model (`PaperBuildModel`), answer
// parsing/comparing/judging, scoring and AI-verdict mapping. `scripts/test-paper.mjs` runs it standalone.

const PAPER_STORAGE_PREFIX = 'dsh-nce/paper/v1/lesson-'
const PAPER_STATE_VERSION = 1
const PAPER_BLANK_RE = /_{2,}/g
const PAPER_NUMBER_RE = /^(\d+)\s*[.、)）]\s*(.*)$/
const PAPER_SUB_RE = /^([a-z])\s*[.、)）]\s*(.*)$/
/** Common contractions, expanded on both sides before comparing two answers. */
const PAPER_CONTRACTIONS = [
  ['cannot', 'can not'],
  ["i'm", 'i am'],
  ["you're", 'you are'],
  ["he's", 'he is'],
  ["she's", 'she is'],
  ["it's", 'it is'],
  ["we're", 'we are'],
  ["they're", 'they are'],
  ["isn't", 'is not'],
  ["aren't", 'are not'],
  ["wasn't", 'was not'],
  ["weren't", 'were not'],
  ["don't", 'do not'],
  ["doesn't", 'does not'],
  ["didn't", 'did not'],
  ["can't", 'can not'],
  ["couldn't", 'could not'],
  ["wouldn't", 'would not'],
  ["shouldn't", 'should not'],
  ["mustn't", 'must not'],
  ["won't", 'will not'],
  ["shan't", 'shall not'],
  ["haven't", 'have not'],
  ["hasn't", 'has not'],
  ["hadn't", 'had not'],
  ["i've", 'i have'],
  ["you've", 'you have'],
  ["we've", 'we have'],
  ["they've", 'they have'],
  ["i'll", 'i will'],
  ["you'll", 'you will'],
  ["he'll", 'he will'],
  ["she'll", 'she will'],
  ["we'll", 'we will'],
  ["they'll", 'they will'],
  ["i'd", 'i would'],
  ["you'd", 'you would'],
  ["he'd", 'he would'],
  ["she'd", 'she would'],
  ["we'd", 'we would'],
  ["they'd", 'they would'],
  ["let's", 'let us'],
  ["what's", 'what is'],
  ["where's", 'where is'],
  ["who's", 'who is'],
  ["how's", 'how is'],
  ["here's", 'here is'],
  ["there's", 'there is'],
  ["that's", 'that is'],
]

const PAPER_STATUS_LABEL = {
  example: '示例',
  blank: '未答',
  open: '待批改',
  unrated: '自评',
  correct: '正确',
  wrong: '错误',
  close: '近似',
}

/** Verdict wording of the AI teacher (correct / close / wrong). */
const PAPER_AI_VERDICT_LABEL = {
  correct: '正确',
  close: '近似',
  wrong: '错误',
}

function PaperList(value) {
  return Array.isArray(value) ? value : []
}

function PaperText(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n')
}

function PaperEscapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** OCR reads "10." as "I0." and "11." as "II."; repair before parsing answers. */
function PaperRepairNumber(line) {
  return String(line)
    .replace(/^I(?=\d)/, '1')
    .replace(/^II(?=\s*[.、)）])/, '11')
    .replace(/^I(?=\s*[.、)）])/, '1')
}

/** Flatten answer lines (some entries embed newlines) into trimmed lines. */
function PaperAnswerLines(values) {
  const lines = []
  for (const value of PaperList(values)) {
    for (const part of PaperText(value).split('\n')) {
      const line = part.trim()
      if (line !== '') lines.push(PaperRepairNumber(line))
    }
  }
  return lines
}

/**
 * Parse the grammar workbook answer block of one section.
 * "2. My name is Ann Scott."        → item 2, plain segment
 * "2. b. No, they aren't."          → item 2, sub-answer b
 * "c. Yes, I am."                   → sub-answer c of the current item
 * Continuation lines join the current segment.
 * Returns Map<itemNumber, { segments: string[], letters: Map<letter, string[]> }>.
 */
function PaperParseAnswers(values) {
  const result = new Map()
  const push = (num, letter, text) => {
    const body = String(text ?? '').trim()
    if (body === '') return
    if (!result.has(num)) result.set(num, { segments: [], letters: new Map() })
    const entry = result.get(num)
    if (letter === '') entry.segments.push(body)
    else {
      if (!entry.letters.has(letter)) entry.letters.set(letter, [])
      entry.letters.get(letter).push(body)
    }
  }
  let item = null
  let letter = ''
  for (const line of PaperAnswerLines(values)) {
    let match = line.match(PAPER_NUMBER_RE)
    if (match !== null) {
      item = Number(match[1])
      letter = ''
      const rest = match[2]
      const sub = rest.match(PAPER_SUB_RE)
      if (sub !== null) {
        letter = sub[1]
        push(item, letter, sub[2])
      } else {
        push(item, '', rest)
      }
      continue
    }
    match = line.match(PAPER_SUB_RE)
    if (match !== null && item !== null) {
      letter = match[1]
      push(item, letter, match[2])
      continue
    }
    if (item !== null) push(item, letter, line)
  }
  return result
}

/** Case / punctuation / contraction-insensitive comparison form. */
function PaperNorm(value) {
  let text = String(value ?? '')
    .replace(/[\u2018\u2019\u02bc`\u00b4]/g, "'")
    .toLowerCase()
  for (const [from, to] of PAPER_CONTRACTIONS) {
    const pattern = new RegExp(`(^|[^a-z])${PaperEscapeRegExp(from)}(?=$|[^a-z])`, 'g')
    text = text.replace(pattern, (matched, prefix) => `${prefix}${to}`)
  }
  text = text.replace(/[^a-z0-9]+/g, ' ')
  return text.replace(/\s+/g, ' ').trim()
}

function PaperSequenceContains(haystack, needle) {
  if (needle.length === 0 || needle.length > haystack.length) return false
  const hay = haystack.join(' ')
  const target = needle.join(' ')
  return hay === target || hay.startsWith(`${target} `) || hay.endsWith(` ${target}`) || hay.includes(` ${target} `)
}

/** Sørensen–Dice overlap over token sets, 0…1. */
function PaperOverlapScore(left, right) {
  if (left.length === 0 || right.length === 0) return 0
  const a = new Set(left)
  const b = new Set(right)
  let shared = 0
  for (const token of a) if (b.has(token)) shared += 1
  return (2 * shared) / (a.size + b.size)
}

/**
 * Protect bare word alternatives like "He/She", "I/We", "a/an" so the general
 * slash split does not tear them apart. Each group is [left, right].
 */
const PAPER_ALTERNATIVE_WORDS = new Set([
  'he', 'she', 'it', 'they', 'we', 'you', 'i', 'him', 'her', 'his', 'hers', 'their', 'our', 'your', 'my', 'me', 'us', 'them', 'ours', 'yours', 'mine', 'theirs',
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'am', 'do', 'does', 'did', 'can', 'could', 'will', 'would', 'shall', 'should',
  'has', 'have', 'had', 'not', 'no', 'yes', 'much', 'many', 'some', 'any', 'this', 'that', 'these', 'those', 'there',
])

/**
 * "He/She", "1/We", "a/an" are inline alternatives. A cue followed by a whole
 * sentence ("umbrellas/Which is your umbrella?") is a line break instead, so
 * only short/function words (or either side of length ≤ 3) are protected.
 */
function PaperIsWordAlternative(left, right) {
  const lowerLeft = left.toLowerCase()
  const lowerRight = right.toLowerCase()
  if (lowerLeft === '1') return true
  if (Math.min(lowerLeft.length, lowerRight.length) <= 3) return true
  return PAPER_ALTERNATIVE_WORDS.has(lowerLeft) && PAPER_ALTERNATIVE_WORDS.has(lowerRight)
}

function PaperProtectWordSlashes(text) {
  const groups = []
  const protectedText = String(text ?? '').replace(/([A-Za-z0-9][A-Za-z0-9']*)\/([A-Za-z][A-Za-z0-9']*)(?![A-Za-z0-9])/g, (match, left, right) => {
    if (!PaperIsWordAlternative(left, right)) return match
    const key = `\u0000${groups.length}\u0000`
    groups.push([left, right])
    return key
  })
  return { protectedText, groups }
}

/** Expand protected word alternatives into every rendering variant (capped). */
function PaperExpandPlaceholders(text, groups, limit) {
  const cap = Number(limit) > 0 ? Number(limit) : 8
  let variants = [String(text ?? '')]
  for (let index = 0; index < groups.length; index += 1) {
    const token = `\u0000${index}\u0000`
    if (!variants.some((variant) => variant.includes(token))) continue
    const next = []
    for (const variant of variants) {
      for (const word of groups[index]) {
        // OCR often reads the pronoun "I" as the digit "1" in "1/We".
        next.push(variant.split(token).join(word === '1' ? 'I' : word))
      }
    }
    variants = next.slice(0, cap)
  }
  return variants
    .map((variant) => variant.replace(/\u0000\d+\u0000/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((variant) => variant !== '')
}

/** Split on "/" and report whether every slash had spaces on both sides. */
function PaperSplitSlashText(text) {
  const pieces = []
  let spacedBoth = true
  let slashCount = 0
  let cursor = 0
  const regex = /(\s*)\/(\s*)/g
  let match
  while ((match = regex.exec(String(text ?? ''))) !== null) {
    pieces.push(String(text).slice(cursor, match.index))
    slashCount += 1
    if (!(match[1].length > 0 && match[2].length > 0)) spacedBoth = false
    cursor = match.index + match[0].length
  }
  pieces.push(String(text ?? '').slice(cursor))
  return {
    pieces: pieces.map((piece) => piece.trim()).filter((piece) => piece !== ''),
    spacedBoth: slashCount > 0 && spacedBoth,
    slashCount,
  }
}

/** Dedupe answer texts by their literal wording (keeps contracted vs full forms
 * in the reference display; grading normalises them anyway). */
function PaperUniqueByNorm(texts) {
  const seen = new Set()
  const out = []
  for (const text of PaperList(texts)) {
    const raw = String(text ?? '').trim()
    if (raw === '') continue
    if (PaperNorm(raw) === '' || seen.has(raw)) continue
    seen.add(raw)
    out.push(raw)
  }
  return out
}

/** "Yes, …" + "No, …" are alternative replies to one cue, not two answers. */
function PaperYesNoPair(pieces) {
  if (pieces.length !== 2) return false
  const first = String(pieces[0] ?? '').trim()
  const second = String(pieces[1] ?? '').trim()
  return /^yes\b/i.test(first) && /^no\b/i.test(second)
}

/**
 * Drop short cue fragments like the leading "umbrellas" in
 * "umbrellas/Which is your umbrella? …" — only when a much longer answer follows.
 */
function PaperKeepPieceMask(pieces) {
  const mask = pieces.map(() => true)
  if (pieces.length < 2) return mask
  const longest = Math.max(...pieces.map((piece) => piece.length))
  if (longest < 20) return mask
  let kept = 0
  for (let index = 0; index < pieces.length; index += 1) {
    if (pieces[index].length <= 12 && pieces[index].length < longest * 0.25) mask[index] = false
    else kept += 1
  }
  return kept > 0 ? mask : pieces.map(() => true)
}

function PaperUnitsSimilar(left, right) {
  for (const a of left.raws) {
    const aTokens = PaperNorm(a).split(' ')
    for (const b of right.raws) {
      if (PaperOverlapScore(aTokens, PaperNorm(b).split(' ')) >= 0.6) return true
    }
  }
  return false
}

/**
 * Split a multi-line answer block into gradeable parts.
 *
 * - Pure-Chinese lines are notes ("答案不唯一…"), not answers: shown but not required.
 * - "He/She", "I/We", "a/an" — word alternatives expand to full variants.
 * - " / " with spaces on both sides usually lists alternative renderings of one
 *   answer (long form / contracted form): any one is accepted.
 * - A bare or one-sided slash is mostly an OCR line break: the pieces are
 *   required parts (with leading cue fragments such as "umbrellas/" dropped).
 * - "Yes …" / "No …" pairs are alternative replies.
 * - Lines that are near-identical alternatives of each other are merged.
 */
function PaperBuildParts(segments) {
  const cleaned = PaperList(segments).map((segment) => String(segment ?? '').trim()).filter((segment) => segment !== '')
  const content = cleaned.filter((segment) => PaperNorm(segment) !== '')
  const usable = content.length > 0 ? content : cleaned
  if (usable.length === 0) return []
  const units = []
  for (const segment of usable) {
    const protectedAnswer = PaperProtectWordSlashes(segment)
    const split = PaperSplitSlashText(protectedAnswer.protectedText)
    if (split.slashCount === 0) {
      const variants = PaperUniqueByNorm(PaperExpandPlaceholders(protectedAnswer.protectedText, protectedAnswer.groups))
      units.push({ raws: variants.length > 0 ? variants : [segment], mergeable: true })
      continue
    }
    const pieceVariants = split.pieces.map((piece) => PaperUniqueByNorm(PaperExpandPlaceholders(piece, protectedAnswer.groups)))
    const pieceFirsts = pieceVariants.map((variants) => variants[0] ?? '')
    if (split.spacedBoth || PaperYesNoPair(pieceFirsts)) {
      const raws = PaperUniqueByNorm(pieceVariants.flat())
      if (raws.length > 0) units.push({ raws, mergeable: false })
      continue
    }
    const mask = PaperKeepPieceMask(pieceFirsts)
    for (let index = 0; index < pieceVariants.length; index += 1) {
      if (mask[index] !== true) continue
      const raws = pieceVariants[index]
      if (raws.length > 0) units.push({ raws, mergeable: false })
    }
  }
  // Merge separate answer lines that are alternative renderings of one answer
  // (e.g. lesson 113 "…either." / "…neither …").
  let merged = true
  while (merged) {
    merged = false
    outer: for (let i = 0; i < units.length; i += 1) {
      for (let j = i + 1; j < units.length; j += 1) {
        if (units[i].mergeable !== true || units[j].mergeable !== true) continue
        if (!PaperUnitsSimilar(units[i], units[j])) continue
        units[i].raws = PaperUniqueByNorm(units[i].raws.concat(units[j].raws))
        units.splice(j, 1)
        merged = true
        break outer
      }
    }
  }
  const parts = []
  for (const unit of units) {
    const raws = PaperUniqueByNorm(unit.raws)
    if (raws.length === 0) continue
    parts.push({
      raws,
      norms: raws.map((variant) => PaperNorm(variant)),
      tokens: raws.map((variant) => PaperNorm(variant).split(' ')),
      // "I'm a/an..." ends with an ellipsis: the learner may continue the sentence.
      open: raws.map((variant) => /(?:\.\.\.|\u2026)\s*$/.test(variant)),
    })
  }
  return parts
}

function PaperSplitBlanks(line, startIndex) {
  const tokens = []
  let count = startIndex
  let cursor = 0
  let match
  PAPER_BLANK_RE.lastIndex = 0
  while ((match = PAPER_BLANK_RE.exec(line)) !== null) {
    if (match.index > cursor) tokens.push({ kind: 'text', text: line.slice(cursor, match.index) })
    tokens.push({ kind: 'blank', index: count })
    count += 1
    cursor = match.index + match[0].length
  }
  if (cursor < line.length) tokens.push({ kind: 'text', text: line.slice(cursor) })
  if (tokens.length === 0) tokens.push({ kind: 'text', text: line })
  return { tokens, blanks: count - startIndex }
}

/**
 * A multi-blank answer line like "it is / it isn't" separates the answers for
 * the blanks in order, rather than offering alternatives. Build one slot per
 * blank when the slash-separated pieces line up with the blank count.
 */
function PaperBuildSlotReference(segments, blankCount) {
  if (blankCount < 2) return null
  const pieces = []
  for (const segment of PaperList(segments)) {
    const split = PaperSplitSlashText(segment)
    if (split.slashCount > 0 && split.spacedBoth === false) return null
    for (const piece of split.pieces) pieces.push(piece)
  }
  if (pieces.length !== blankCount) return null
  const slots = []
  for (const raw of pieces) {
    const norm = PaperNorm(raw)
    if (norm === '') return null
    slots.push({ raw, norm, tokens: norm.split(' ') })
  }
  return slots
}

/**
 * Words on the same line(s) as a blank; used to decide whether a short answer
 * may be a fragment of a longer reference. Only blank-bearing lines count — a
 * separate "direct speech" prompt line would otherwise look like part of the
 * answer and weaken the check.
 */
function PaperContextTokens(lines) {
  const tokens = []
  for (const line of PaperList(lines)) {
    if (!/_{2,}/.test(line)) continue
    const stripped = String(line)
      .replace(PAPER_BLANK_RE, ' ')
      .replace(/^\s*(?:\d+|[A-Za-z])\s*[.、)）]\s*/, ' ')
      .replace(/^\s*[A-Za-z]\s*:\s*/, ' ')
    for (const token of PaperNorm(stripped).split(' ')) {
      if (token === '' || /^\d+$/.test(token)) continue
      tokens.push(token)
    }
  }
  return tokens
}

/** A blank on a line of its own ("B: ___") expects the whole answer, not a fragment. */
function PaperBlankStandalone(lines) {
  let sawBlank = false
  for (const line of PaperList(lines)) {
    const text = String(line)
    const regex = /_{2,}/g
    let match
    while ((match = regex.exec(text)) !== null) {
      sawBlank = true
      const before = text.slice(0, match.index).replace(/^[A-Za-z]\s*:\s*/, '').replace(/[^A-Za-z0-9]+/g, '')
      const after = text.slice(match.index + match[0].length).replace(/[^A-Za-z0-9]+/g, '')
      if (before !== '' || after !== '') return false
    }
  }
  return sawBlank
}

/** Split a lettered item ("a. … b. …") into sub-questions. */
function PaperSplitLettered(lines) {
  const subs = []
  let current = null
  let leading = null
  for (const line of lines) {
    const match = line.match(PAPER_SUB_RE)
    if (match !== null) {
      current = { letter: match[1], lines: [match[2]] }
      if (leading !== null && subs.length === 0) {
        current.lines = leading.concat(current.lines)
        leading = null
      }
      subs.push(current)
      continue
    }
    if (current !== null) current.lines.push(line)
    else if (leading === null) leading = [line]
    else leading.push(line)
  }
  return subs.filter((sub) => sub.letter !== '')
}

/** Build the question records of one exercise item. */
/** Split a prompt block into the book's separate question rows; cues stay attached. */
function PaperSplitQuestionLines(lines) {
  const out = []
  for (const raw of PaperList(lines)) {
    const text = String(raw ?? '').trim()
    if (text === '') continue
    const regex = /(\?\s*(?:\([^)]*\))?)\s+(?=[A-Z])/g
    let start = 0
    for (let match = regex.exec(text); match !== null; match = regex.exec(text)) {
      out.push(text.slice(start, match.index + match[1].length).trim())
      start = match.index + match[0].length
    }
    out.push(text.slice(start).trim())
  }
  return out.filter((line) => line !== '')
}

/** Answers printed one per question row; each slash piece maps to one question. */
function PaperBuildSequentialParts(segments) {
  const pieces = []
  for (const segment of PaperList(segments)) {
    const raw = String(segment ?? '').trim()
    if (raw === '' || PaperNorm(raw) === '') continue
    const protectedAnswer = PaperProtectWordSlashes(raw)
    const split = PaperSplitSlashText(protectedAnswer.protectedText)
    for (const piece of split.pieces) {
      const variants = PaperUniqueByNorm(PaperExpandPlaceholders(piece, protectedAnswer.groups))
      if (variants.length > 0) pieces.push(variants)
    }
  }
  return pieces.map((raws) => ({ raws, norms: raws.map(PaperNorm), tokens: raws.map((variant) => PaperNorm(variant).split(' ')), open: raws.map((variant) => /(?:\.\.\.|\u2026)\s*$/.test(variant)) }))
}

function PaperBuildItemQuestions(groupKey, item, index, options) {
  const text = PaperText(item?.text)
  const lines = text.split('\n').map((line) => line.trim()).filter((line) => line !== '')
  const rawNum = Number(item?.num)
  const num = Number.isFinite(rawNum) && rawNum > 0 ? rawNum : index + 1
  const reference = options?.reference ?? null
  const copyPrompt = options?.copy === true

  const makeQuestion = (opts) => {
    const questionLines = PaperList(opts.lines)
    let blankCount = 0
    const lineTokens = []
    for (const line of questionLines) {
      const parsed = PaperSplitBlanks(line, blankCount)
      lineTokens.push(parsed.tokens)
      blankCount += parsed.blanks
    }
    const source = opts.referenceSource ?? 'none'
    const rawReferenceLines = PaperList(opts.referenceLines)
    const parts = source === 'none' ? [] : PaperBuildParts(rawReferenceLines)
    const effectiveSource = parts.length > 0 ? source : 'none'
    const noExampleMode = options?.noExample === true
    const printedExample = blankCount === 0
      ? (effectiveSource === 'none' && questionLines.length > 1 && options?.sectionHasReference === true)
      : (effectiveSource === 'none'
        && options?.sectionHasReference === true
        && index === 0
        && questionLines.length >= 3)
    const isExample = noExampleMode !== true && (opts.example === true || printedExample)
    const blankStandalone = blankCount > 0 ? PaperBlankStandalone(questionLines) : false
    const contextTokens = blankCount > 0 && blankStandalone === false ? PaperContextTokens(questionLines) : []
    const slotReference = isExample || blankCount < 2 ? null : PaperBuildSlotReference(rawReferenceLines, blankCount)
    const annotationLines = effectiveSource === 'none' ? [] : rawReferenceLines.filter((line) => PaperNorm(line) === '')
    const displayReferenceLines = effectiveSource === 'none'
      ? []
      : (source === 'prompt'
        ? rawReferenceLines.slice(0, 1)
        : parts.map((part) => part.raws.join(' / ')).concat(annotationLines))
    // A numbered item may stack 2–3 questions, each with its own ruled answer line.
    const promptLines = blankCount === 0 ? PaperSplitQuestionLines(questionLines) : questionLines
    const askRows = blankCount === 0 && isExample !== true && options?.askAnswer === true && effectiveSource === 'answer' && promptLines.length === 1 ? paperAskAnswerRows(rawReferenceLines) : []
    const askParts = askRows.length < 2 ? null : askRows.map((raw) => ({ raws: [raw], norms: [PaperNorm(raw)], tokens: [PaperNorm(raw).split(' ')], open: [false] }))
    const sequentialParts = blankCount === 0 && promptLines.length >= 2 && effectiveSource !== 'none' ? PaperBuildSequentialParts(rawReferenceLines) : []
    const lineInputs = isExample !== true && askParts === null && sequentialParts.length === promptLines.length && promptLines.length >= 2
    const shownLines = askParts !== null ? askRows.map((row, rowIndex) => (rowIndex === 0 ? questionLines[0] ?? '' : '')) : lineInputs ? promptLines : questionLines
    const shownParts = askParts ?? (lineInputs ? sequentialParts : parts)
    const shownReferenceLines = askParts !== null ? askRows : lineInputs ? sequentialParts.map((part) => part.raws.join(' / ')) : displayReferenceLines
    return {
      id: opts.id,
      groupKey,
      num,
      letter: opts.letter ?? '',
      letterLabel: opts.letterLabel ?? opts.letter ?? '',
      kind: isExample ? 'example' : (blankCount > 0 ? 'blank' : 'text'),
      lines: shownLines,
      lineTokens: blankCount > 0 ? lineTokens : null,
      blankCount,
      blankStandalone,
      contextTokens,
      slotReference,
      lineParts: askParts ?? (lineInputs ? sequentialParts : []),
      exampleAnswers: isExample ? PaperList(opts.exampleAnswers) : [],
      promptText: shownLines.join('\n'),
      referenceSource: isExample ? 'none' : effectiveSource,
      referenceLines: isExample ? [] : shownReferenceLines,
      parts: isExample ? [] : shownParts,
      isExample,
    }
  }

  // Some book items print only a number + ruled line (lesson 110 I, 117 II).
  if (lines.length === 0) {
    const refSegments = reference !== null ? PaperList(reference.segments) : []
    if (refSegments.length === 0) return []
    return [makeQuestion({
      id: `${groupKey}:${index}`,
      lines: [],
      referenceSource: 'answer',
      referenceLines: refSegments,
      exampleAnswers: item?.exampleAnswers,
    })]
  }

  const letterSubs = PaperSplitLettered(lines)
  const letterRefs = reference !== null && reference.letters instanceof Map ? reference.letters : null
  const useLetters = letterSubs.length >= 2 || (letterSubs.length === 1 && letterRefs !== null && letterRefs.size > 0)
  if (useLetters) {
    const usedLetters = new Map()
    return letterSubs.map((sub, subIndex) => {
      // OCR data occasionally repeats the same sub-letter inside one item
      // (two task batches merged). Keep the ids unique, and keep the reference
      // only on the first occurrence — reusing it on the duplicate would show
      // the wrong answer, so the duplicate stays self-assessed instead.
      const used = usedLetters.get(sub.letter) ?? 0
      usedLetters.set(sub.letter, used + 1)
      const letterId = used === 0 ? sub.letter : `${sub.letter}${used + 1}`
      const letterLabel = used === 0 ? sub.letter : `${sub.letter}${'\u2032'.repeat(used)}`
      let subSegments = null
      if (used === 0) {
        if (letterRefs !== null && letterRefs.has(sub.letter)) subSegments = letterRefs.get(sub.letter)
        else if (reference !== null && reference.segments.length === letterSubs.length) {
          subSegments = [reference.segments[subIndex]]
        }
      }
      const hasReference = subSegments !== null && subSegments.length > 0
      return makeQuestion({
        id: `${groupKey}:${index}:${letterId}`,
        letter: sub.letter,
        letterLabel,
        lines: sub.lines,
        referenceSource: hasReference ? 'answer' : 'none',
        referenceLines: hasReference ? subSegments : [],
        example: hasReference === false && subIndex === 0 && sub.lines.length > 1,
        exampleAnswers: item?.exampleAnswers,
      })
    })
  }

  const segments = reference !== null ? PaperList(reference.segments) : []
  const hasReference = segments.length > 0
  return [makeQuestion({
    id: `${groupKey}:${index}`,
    lines,
    referenceSource: hasReference ? 'answer' : (copyPrompt ? 'prompt' : 'none'),
    referenceLines: hasReference ? segments : (copyPrompt ? [lines.join(' ')] : []),
    example: Array.isArray(item?.exampleAnswers) && item.exampleAnswers.length > 0,
    exampleAnswers: item?.exampleAnswers,
  })]
}

const PAPER_NUMBER_WORDS = [
  ['twenty', 20], ['fifteen', 15], ['fourteen', 14], ['thirteen', 13], ['twelve', 12],
  ['eleven', 11], ['eight', 8], ['seven', 7], ['three', 3], ['four', 4], ['five', 5],
  ['nine', 9], ['ten', 10], ['six', 6], ['two', 2],
]

/** "Now write eleven sentences." / "写出 9 句话" → 11 / 9; used for table exercises. */
function PaperFreeWriteCount(text, fallback) {
  const source = String(text ?? '')
  const digits = source.match(/(\d{1,2})\s*(?:sentences?|句)/i)
  if (digits !== null) {
    const value = Number(digits[1])
    if (Number.isInteger(value) && value > 0 && value <= 30) return value
  }
  const lower = source.toLowerCase()
  for (const [word, count] of PAPER_NUMBER_WORDS) {
    if (new RegExp(`\\b${word}\\b`).test(lower)) return count
  }
  return fallback
}

/** Strip a real question down to the static 示例 shape (no input/grading). */
function PaperAsExample(question) {
  Object.assign(question, {
    isExample: true, kind: 'example', referenceSource: 'none', referenceLines: [],
    parts: [], lineParts: [], blankCount: 0, blankStandalone: false,
    lineTokens: null, contextTokens: [], slotReference: null,
  })
}

/** Mark the printed worked examples (group prefix + sub-items a, b, …) as static 示例. */
function PaperMarkPrintedExamples(questions) {
  const list = PaperList(questions)
  if (!list.some(PaperQuestionHasReference)) return list
  for (const question of list) {
    if (PaperQuestionHasReference(question)) break
    if (question && typeof question === 'object' && question.isExample !== true) PaperAsExample(question)
  }
  const byNumber = new Map()
  for (const question of list) {
    if (question === null || typeof question !== 'object' || question.letter === '') continue
    if (!byNumber.has(question.num)) byNumber.set(question.num, [])
    byNumber.get(question.num).push(question)
  }
  for (const siblings of byNumber.values()) {
    if (!siblings.some(PaperQuestionHasReference)) continue
    for (const question of siblings) {
      if (PaperQuestionHasReference(question)) break
      if (question.isExample !== true) PaperAsExample(question)
    }
  }
  return list
}

function PaperBuildFreeWriteQuestions(groupKey, count) {
  const questions = []
  for (let index = 0; index < count; index += 1) {
    questions.push({
      id: `${groupKey}:free:${index}`,
      groupKey,
      num: index + 1,
      letter: '',
      letterLabel: '',
      kind: 'text',
      lines: [''],
      lineTokens: null,
      blankCount: 0,
      blankStandalone: false,
      contextTokens: [],
      slotReference: null,
      promptText: '',
      referenceSource: 'none',
      referenceLines: [],
      parts: [],
      isExample: false,
      freeWrite: true,
    })
  }
  return questions
}

/** Whole-paper model: sections, questions and parsed references. */
/**
 * Matching exercises (Match Column A with Column B) are rendered as two real
 * columns with one letter slot per A row; the answer key is number→letter.
 */
function PaperBuildMatchingQuestions(groupKey, matching) {
  const left = PaperList(matching?.left)
  const right = PaperList(matching?.right).map((option) => ({
    letter: String(option?.letter ?? '').toLowerCase(),
    text: String(option?.text ?? ''),
  }))
  const byLetter = new Map(right.map((option) => [option.letter, option.text]))
  const rawKey = matching?.key !== null && typeof matching?.key === 'object' ? matching.key : {}
  return left.map((row, index) => {
    const num = Number(row?.num) || index + 1
    const expected = PaperList(rawKey[String(num)] ?? rawKey[num])
      .map((letter) => String(letter).toLowerCase())
      .filter((letter) => letter !== '')
    const referenceLines = expected.map((letter) => `${letter}. ${byLetter.get(letter) ?? ''}`.trim())
    return {
      id: `${groupKey}:m${num}`,
      groupKey,
      num,
      letter: '',
      letterLabel: '',
      kind: 'match',
      lines: [String(row?.text ?? '')],
      promptText: String(row?.text ?? ''),
      lineTokens: [],
      blankCount: 0,
      blankStandalone: false,
      contextTokens: [],
      matchLetters: expected,
      matchOptions: right,
      referenceSource: expected.length > 0 ? 'answer' : 'none',
      referenceLines,
      parts: [],
      isExample: false,
    }
  })
}

function PaperBuildModel(lesson) {
  const safeLesson = lesson !== null && typeof lesson === 'object' ? lesson : {}
  const groups = []
  const exercises = PaperList(safeLesson.exercises)
  for (let index = 0; index < exercises.length; index += 1) {
    const raw = exercises[index] !== null && typeof exercises[index] === 'object' ? exercises[index] : {}
    const groupKey = `ex:${index}`
    const titleEn = String(raw.titleEn ?? '').trim()
    const titleZh = String(raw.titleZh ?? '').trim()
    // Only true "Copy these sentences." tasks use the prompt as the answer key;
    // Chinese titles such as "抄写以下句子，用 am/is/are 填空" are fill-in tasks.
    const copy = /^copy\b/i.test(titleEn)
      || (/抄写/.test(titleZh) && !/填空|补全|完成|用所给|选词|选择/.test(titleZh))
    const questions = []
    const items = PaperList(raw.items)
    for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
      questions.push(...PaperBuildItemQuestions(groupKey, items[itemIndex], itemIndex, { copy }))
    }
    const freeWrite = items.length === 0
    if (freeWrite) {
      const dictation = /dictation|听写/i.test(`${titleEn} ${titleZh}`)
      const count = PaperFreeWriteCount(`${titleEn} ${titleZh}`, dictation ? 5 : 3)
      questions.push(...PaperBuildFreeWriteQuestions(groupKey, count))
    }
    groups.push({
      key: groupKey,
      source: 'ex',
      index: groups.length,
      label: String(raw.label ?? '').trim(),
      titleEn,
      titleZh,
      note: PaperList(raw.note).map((line) => String(line ?? '')).filter((line) => line.trim() !== ''),
      example: PaperList(raw.example),
      table: PaperList(raw.table),
      freeWrite,
      questions,
    })
  }

  const gwb = safeLesson.gwb !== null && typeof safeLesson.gwb === 'object' ? safeLesson.gwb : {}
  const answerByLabel = new Map()
  for (const answer of PaperList(gwb.answers)) {
    const label = String(answer?.label ?? '').trim()
    answerByLabel.set(label, PaperParseAnswers(answer?.lines))
  }
  const usedLabels = new Set()
  const sections = PaperList(gwb.sections)
  for (let index = 0; index < sections.length; index += 1) {
    const raw = sections[index] !== null && typeof sections[index] === 'object' ? sections[index] : {}
    const groupKey = `gwb:${index}`
    const label = String(raw.label ?? '').trim()
    usedLabels.add(label)
    const titleEn = String(raw.titleEn ?? '').trim()
    const titleZh = String(raw.titleZh ?? '').trim()
    // Matching exercises ("Match Column A with Column B", 搭配/连线) have an
    // answer key of number→letter pairs, not sentence answers; keep the key as
    // a reference panel and let the learner self-assess.
    // Build-time data may carry the reconstructed two-column structure
    // (scripts/build-data.mjs → section.matching). Prefer it; fall back to the
    // old title heuristic for older data.
    const structuredMatching = raw.matching !== null && typeof raw.matching === 'object'
      && PaperList(raw.matching.left).length > 0 && PaperList(raw.matching.right).length > 0
      ? raw.matching
      : null
    const matching = structuredMatching !== null
      || /^match\b/i.test(titleEn)
      || /搭配|连线|左右两边|(?:栏.*(?:找出|连接|连起来|连在一起))|(?:(?:找出|连接|连起来|连在一起).*栏)/.test(titleZh)
    let matchingData = null
    let matchingKey = []
    const questions = []
    if (structuredMatching !== null) {
      matchingData = {
        leftTitle: String(structuredMatching.leftTitle ?? 'A').trim() || 'A',
        rightTitle: String(structuredMatching.rightTitle ?? 'B').trim() || 'B',
        left: PaperList(structuredMatching.left).map((row) => ({ num: Number(row?.num) || 0, text: String(row?.text ?? '') })),
        right: PaperList(structuredMatching.right).map((row) => ({ letter: String(row?.letter ?? '').toLowerCase(), text: String(row?.text ?? '') })),
        key: structuredMatching.key !== null && typeof structuredMatching.key === 'object' ? structuredMatching.key : {},
        keyNote: PaperList(structuredMatching.keyNote).map((line) => String(line ?? '')).filter((line) => line.trim() !== ''),
      }
      matchingKey = PaperList(structuredMatching.keyLines).map((line) => String(line ?? '')).filter((line) => line.trim() !== '')
      questions.push(...PaperBuildMatchingQuestions(groupKey, structuredMatching))
    } else {
      if (matching) {
        for (const answer of PaperList(gwb.answers)) {
          if (String(answer?.label ?? '').trim() !== label) continue
          for (const line of PaperList(answer?.lines)) {
            const text = String(line ?? '').trim()
            if (text !== '') matchingKey.push(text)
          }
        }
      }
      const referenceMap = answerByLabel.get(label) ?? new Map()
      const items = PaperList(raw.items)
      for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
        const item = items[itemIndex] !== null && typeof items[itemIndex] === 'object' ? items[itemIndex] : {}
        const num = Number(item.num)
        const reference = matching ? null : (Number.isFinite(num) ? referenceMap.get(num) ?? null : null)
        const options = matching
          ? { noExample: true }
          : { reference, sectionHasReference: referenceMap.size > 0, askAnswer: /ask and answer|make dialogues/i.test(titleEn) }
        questions.push(...PaperBuildItemQuestions(groupKey, item, itemIndex, options))
      }
      PaperMarkPrintedExamples(questions)
    }
    groups.push({
      key: groupKey,
      source: 'gwb',
      index: groups.length,
      label,
      titleEn,
      titleZh,
      note: PaperList(raw.note).map((line) => String(line ?? '')).filter((line) => line.trim() !== ''),
      example: matchingData !== null ? [] : PaperList(raw.example),
      table: PaperList(raw.table),
      wordBox: matchingData !== null ? [] : PaperList(raw.wordBox).map((line) => String(line ?? '')).filter((line) => line.trim() !== ''),
      matching,
      matchingData,
      matchingKey,
      questions,
    })
  }

  const stray = []
  for (const [label, referenceMap] of answerByLabel) {
    if (usedLabels.has(label)) continue
    const lines = []
    for (const [num, entry] of referenceMap) {
      for (const segment of entry.segments) lines.push(`${num}. ${segment}`)
      for (const [letter, segments] of entry.letters) {
        for (const segment of segments) lines.push(`${num}${letter}. ${segment}`)
      }
    }
    if (lines.length > 0) stray.push({ label, lines })
  }

  const stats = { groups: groups.length, questions: 0, examples: 0, gradable: 0 }
  for (const group of groups) {
    for (const question of group.questions) {
      if (question.isExample) stats.examples += 1
      else {
        stats.questions += 1
        if (PaperQuestionHasReference(question)) stats.gradable += 1
      }
    }
  }

  return {
    lessonId: Number(safeLesson.id) || 0,
    titleEn: String(safeLesson.titleEn ?? '').trim(),
    titleZh: String(safeLesson.titleZh ?? '').trim(),
    groups,
    stray,
    stats,
  }
}

function PaperQuestionAnswerKeys(question) {
  if (question.kind === 'match') return [`${question.id}#m`]
  if (question.kind === 'blank') {
    const keys = []
    for (let index = 0; index < question.blankCount; index += 1) keys.push(`${question.id}#b${index}`)
    return keys
  }
  const lineParts = PaperList(question.lineParts)
  if (lineParts.length > 1) return lineParts.map((part, index) => `${question.id}#l${index}`)
  return [`${question.id}#a`]
}

function PaperQuestionAnswered(question, answers) {
  if (question.isExample) return false
  const map = answers !== null && typeof answers === 'object' ? answers : {}
  const keys = PaperQuestionAnswerKeys(question)
  if (keys.length === 0) return false
  for (const key of keys) {
    if (String(map[key] ?? '').trim() === '') return false
  }
  return true
}

/** Whether an answered question can be auto-graded (match questions use matchLetters). */
function PaperQuestionHasReference(question) {
  if (question === null || typeof question !== 'object' || question.isExample === true) return false
  if (question.kind === 'match') return PaperList(question.matchLetters).length > 0
  return question.referenceSource !== 'none' && PaperList(question.parts).length > 0
}

/** Per-row verdicts for a stacked-question item. */
function PaperJudgeLines(question, answers) {
  const parts = PaperList(question.lineParts)
  if (parts.length < 2) return []
  const map = answers !== null && typeof answers === 'object' ? answers : {}
  const keys = PaperQuestionAnswerKeys(question)
  return keys.map((key, index) => {
    const tokens = PaperNorm(map[key]).split(' ').filter((token) => token !== '')
    if (tokens.length === 0) return 'blank'
    const rank = PaperPartRank(tokens, parts[index], [], false)
    if (rank === 2) return 'correct'
    if (rank === 1) return 'close'
    return 'wrong'
  })
}

/**
 * Match (Column A ↔ Column B) answer forms: letters ("e", "e, f", "e/f") or
 * the actual B-column words ("cake"). Returns the letters the learner matched.
 */
function PaperMatchLetters(text, options) {
  const raw = String(text ?? '').trim()
  if (raw === '') return []
  const letters = new Set()
  for (const token of raw.toLowerCase().split(/[\s,;、/|]+/)) {
    if (/^[a-l]$/.test(token)) letters.add(token)
  }
  if (letters.size === 0) {
    const norm = PaperNorm(raw)
    if (norm !== '') {
      for (const option of PaperList(options)) {
        const optionNorm = PaperNorm(option?.text)
        if (optionNorm !== '' && norm.includes(optionNorm)) letters.add(String(option?.letter ?? '').toLowerCase())
      }
    }
  }
  return Array.from(letters).filter((letter) => letter !== '')
}

/** Grade one matching row: exact letter set = correct, partial overlap = close. */
function PaperJudgeMatch(question, answers) {
  const map = answers !== null && typeof answers === 'object' ? answers : {}
  if (!PaperQuestionAnswered(question, map)) return 'blank'
  const expected = PaperList(question.matchLetters).map((letter) => String(letter).toLowerCase()).filter((letter) => letter !== '')
  if (expected.length === 0) return 'unrated'
  const keys = PaperQuestionAnswerKeys(question)
  const raw = String(map[keys[0]] ?? '')
  const user = PaperMatchLetters(raw, question.matchOptions)
  if (user.length === 0) return 'wrong'
  const expectedSet = new Set(expected)
  const userSet = new Set(user)
  if (userSet.size === expectedSet.size && Array.from(userSet).every((letter) => expectedSet.has(letter))) return 'correct'
  if (Array.from(userSet).some((letter) => expectedSet.has(letter))) return 'close'
  return 'wrong'
}

/**
 * A blank answer may be a fragment of a full-sentence reference when the
 * prompt supports it: the prompt words must appear in the reference, and the
 * fragment must cover most of what the prompt does NOT already show.
 */
function PaperFragmentAllowed(contextTokens, altTokens, userTokens) {
  if (contextTokens.length < 2 || altTokens.length === 0 || userTokens.length === 0) return false
  // The prompt fragment must actually belong to the reference sentence.
  const altSet = new Set(altTokens)
  const supported = contextTokens.filter((token) => altSet.has(token)).length
  if (supported / contextTokens.length < 0.8) return false
  const budget = new Map()
  for (const token of contextTokens) budget.set(token, (budget.get(token) ?? 0) + 1)
  const missing = []
  for (const token of altTokens) {
    const left = budget.get(token) ?? 0
    if (left > 0) budget.set(token, left - 1)
    else missing.push(token)
  }
  if (missing.length === 0) return false
  const userBudget = new Map()
  for (const token of userTokens) userBudget.set(token, (userBudget.get(token) ?? 0) + 1)
  let covered = 0
  for (const token of missing) {
    const left = userBudget.get(token) ?? 0
    if (left > 0) {
      covered += 1
      userBudget.set(token, left - 1)
    }
  }
  return covered / missing.length >= 0.6
}

/**
 * Rank one reference part against the learner's tokens: 2 match, 1 close, 0 miss.
 * `allowContains` is used when a question needs several parts written in one
 * answer box: the learner's whole text must contain each part.
 */
function PaperPartRank(tokens, part, contextTokens, allowContains) {
  let best = 0
  for (let index = 0; index < part.norms.length; index += 1) {
    const altTokens = part.tokens[index]
    const altNorm = part.norms[index]
    if (tokens.join(' ') === altNorm) return 2
    if (part.open !== undefined && part.open[index] === true && tokens.length > altTokens.length) {
      // "I'm a/an..." style placeholders accept any continuation of the phrase.
      if (PaperSequenceContains(tokens.slice(0, altTokens.length), altTokens) && tokens.slice(0, altTokens.length).join(' ') === altNorm) return 2
    }
    if (allowContains && altTokens.length > 0 && tokens.length > altTokens.length && PaperSequenceContains(tokens, altTokens)) return 2
    if (altTokens.length > tokens.length && PaperSequenceContains(altTokens, tokens)) {
      const fragment = tokens.join(' ')
      if ((tokens.length >= 2 || fragment.length >= 2) && PaperFragmentAllowed(contextTokens, altTokens, tokens)) return 2
    }
    const overlap = PaperOverlapScore(tokens, altTokens)
    if (overlap >= 0.9) best = Math.max(best, 1)
  }
  return best
}

/** Grade one question from the answer map; returns correct/close/wrong/blank/unrated. */
function PaperJudge(question, answers) {
  if (question === null || typeof question !== 'object' || question.isExample === true) return 'unrated'
  if (question.kind === 'match') return PaperJudgeMatch(question, answers)
  if (question.referenceSource === 'none' || question.parts.length === 0) {
    return PaperQuestionAnswered(question, answers) ? 'unrated' : 'blank'
  }
  if (!PaperQuestionAnswered(question, answers)) return 'blank'
  if (PaperList(question.lineParts).length > 1) {
    const lineStatuses = PaperJudgeLines(question, answers)
    if (lineStatuses.length === 0 || lineStatuses.includes('blank')) return 'blank'
    if (lineStatuses.every((status) => status === 'correct')) return 'correct'
    if (lineStatuses.every((status) => status === 'correct' || status === 'close')) return 'close'
    return 'wrong'
  }
  const map = answers !== null && typeof answers === 'object' ? answers : {}
  const keys = PaperQuestionAnswerKeys(question)
  const values = keys.map((key) => String(map[key] ?? ''))
  // Multi-blank answer lines like "it is / it isn't" give one answer per blank.
  if (question.kind === 'blank' && PaperList(question.slotReference).length === values.length) {
    let slotsCorrect = 0
    let slotsClose = 0
    for (let index = 0; index < values.length; index += 1) {
      const valueTokens = PaperNorm(values[index]).split(' ').filter((token) => token !== '')
      const slot = question.slotReference[index]
      if (valueTokens.length === 0) continue
      if (valueTokens.join(' ') === slot.norm) {
        slotsCorrect += 1
        slotsClose += 1
      } else if (PaperOverlapScore(valueTokens, slot.tokens) >= 0.9) {
        slotsClose += 1
      }
    }
    if (slotsCorrect === values.length) return 'correct'
    if (slotsClose === values.length) return 'close'
    return 'wrong'
  }
  const userText = question.kind === 'blank' ? values.join(' ') : values[0]
  const norm = PaperNorm(userText)
  if (norm === '') return 'blank'
  const tokens = norm.split(' ')
  const contextTokens = question.kind === 'blank' ? PaperList(question.contextTokens) : []
  const allowContains = question.parts.length > 1
  let allMatch = true
  let allClose = true
  for (const part of question.parts) {
    const rank = PaperPartRank(tokens, part, contextTokens, allowContains)
    if (rank < 2) allMatch = false
    if (rank < 1) allClose = false
  }
  if (allMatch) return 'correct'
  if (allClose) return 'close'
  return 'wrong'
}

/**
 * Evaluate a paper: per-question display status plus score counters.
 * Status vocab: example / blank / open / unrated / correct / wrong / close.
 */
function PaperEvaluate(model, paper) {
  const state = paper !== null && typeof paper === 'object' ? paper : {}
  const answers = state.answers !== null && typeof state.answers === 'object' ? state.answers : {}
  const marks = state.marks !== null && typeof state.marks === 'object' ? state.marks : {}
  const aiRows = PaperAiRows(state)
  // Once any question has a teacher verdict the paper is graded in AI mode: the
  // teacher is the single judge, so answered questions it has not reached yet
  // stay "待批" instead of silently falling back to a second standard.
  const aiMode = Object.keys(aiRows).length > 0
  const graded = state.graded === true
  const result = {
    total: 0,
    examples: 0,
    gradable: 0,
    answered: 0,
    aiJudged: 0,
    autoCorrect: 0,
    autoWrong: 0,
    autoClose: 0,
    blankGradable: 0,
    unrated: 0,
    selfRight: 0,
    selfWrong: 0,
    score: 0,
    aiScore: 0,
    statuses: {},
    statusCounts: { correct: 0, wrong: 0, close: 0, blank: 0, unrated: 0, open: 0 },
    groups: {},
  }
  for (const group of model.groups) {
    const counters = { total: 0, gradable: 0, answered: 0, correct: 0, wrong: 0, close: 0, selfRight: 0, selfWrong: 0 }
    for (const question of group.questions) {
      if (question.isExample) {
        result.examples += 1
        result.statuses[question.id] = 'example'
        continue
      }
      result.total += 1
      counters.total += 1
      const answered = PaperQuestionAnswered(question, answers)
      if (answered) {
        result.answered += 1
        counters.answered += 1
      }
      const hasReference = PaperQuestionHasReference(question)
      if (hasReference) {
        result.gradable += 1
        counters.gradable += 1
      }
      const mark = marks[question.id] === 'right' ? 'right' : marks[question.id] === 'wrong' ? 'wrong' : ''
      const aiRow = aiRows[question.id]
      // One unified order for the whole paper: a manual 判对/判错 wins, then the
      // AI teacher's verdict (it grades every answered question, key or no key),
      // then the deterministic grader for answer-book questions, then self-assess.
      let status
      if (!answered) {
        // An unanswered question stays 未答 even if it was manually marked.
        status = 'blank'
      } else if (mark === 'right') {
        status = 'correct'
      } else if (mark === 'wrong') {
        status = 'wrong'
      } else if (aiRow !== undefined) {
        status = aiRow.verdict
      } else if (hasReference && graded && !aiMode) {
        // Deterministic fallback only when the AI teacher is not grading at all.
        status = PaperJudge(question, answers)
      } else {
        status = hasReference ? 'open' : 'unrated'
      }
      result.statuses[question.id] = status
      if (answered && aiRow !== undefined) result.aiJudged += 1
      const autoCounted = hasReference && graded && answered && aiRow === undefined && !aiMode
      if (status === 'correct') {
        if (autoCounted) {
          result.autoCorrect += 1
          counters.correct += 1
        } else {
          result.selfRight += 1
          counters.selfRight += 1
        }
      } else if (status === 'wrong') {
        if (autoCounted) {
          result.autoWrong += 1
          counters.wrong += 1
        } else {
          result.selfWrong += 1
          counters.selfWrong += 1
        }
      } else if (status === 'close') {
        result.autoClose += 1
        counters.close += 1
      } else if (status === 'blank' && graded && hasReference) {
        result.blankGradable += 1
      } else if (status === 'unrated' && answered) {
        result.unrated += 1
      }
    }
    result.groups[group.key] = counters
  }
  for (const status of Object.values(result.statuses)) {
    if (result.statusCounts[status] !== undefined) result.statusCounts[status] += 1
  }
  result.score = result.gradable > 0 ? Math.round((result.autoCorrect / result.gradable) * 100) : 0
  result.aiScore = result.total > 0 ? Math.round((result.statusCounts.correct / result.total) * 100) : 0
  return result
}

/** Compact label for a set of groups, e.g. "语法练习册 I. / II.". */
function PaperGroupRefLabel(groups) {
  const bySource = new Map()
  for (const group of PaperList(groups)) {
    const source = group?.source === 'gwb' ? '语法练习册' : '课文书面练习'
    const label = String(group?.label ?? '').trim()
    const value = label !== '' ? label : `第 ${(Number(group?.index) || 0) + 1} 组`
    if (!bySource.has(source)) bySource.set(source, [])
    const labels = bySource.get(source)
    if (!labels.includes(value)) labels.push(value)
  }
  const parts = []
  for (const [source, labels] of bySource) parts.push(`${source} ${labels.join(' / ')}`)
  return parts.join('；')
}

/**
 * One-line explanation for a graded paper whose score cannot show what the
 * learner did: the answered questions have no answer key (self-assessed only),
 * or the scoreable questions are still unanswered. Returns '' when there is
 * nothing to explain.
 */
function PaperScoreHint(model, evaluation, paper) {
  const stats = evaluation !== null && typeof evaluation === 'object' ? evaluation : null
  if (stats === null || Number(stats.answered) <= 0) return ''
  const answers = paper !== null && typeof paper === 'object'
    && paper.answers !== null && typeof paper.answers === 'object'
    ? paper.answers
    : {}
  const aiRows = PaperAiRows(paper)
  const autoCounted = stats.autoCorrect + stats.autoWrong + stats.autoClose
  const pendingGroups = []
  const selfGroups = []
  let pending = 0
  let selfAnswered = 0
  let aiJudged = 0
  for (const group of PaperList(model?.groups)) {
    let groupPending = 0
    let groupSelf = 0
    for (const question of PaperList(group.questions)) {
      if (question.isExample) continue
      if (PaperQuestionHasReference(question)) {
        if (stats.statuses[question.id] === 'blank') {
          groupPending += 1
          pending += 1
        }
      } else {
        groupSelf += 1
        if (PaperQuestionAnswered(question, answers)) {
          selfAnswered += 1
          if (aiRows[question.id] !== undefined) aiJudged += 1
        }
      }
    }
    if (groupPending > 0) pendingGroups.push(group)
    if (groupSelf > 0) selfGroups.push(group)
  }
  if (pending === 0 && selfAnswered === 0) return ''
  // A fully answered, fully scoreable paper needs no explanation.
  if (pending === 0 && autoCounted > 0) return ''
  const selfLabel = PaperGroupRefLabel(selfGroups)
  const selfText = selfAnswered > 0
    ? (aiJudged >= selfAnswered
      ? `已答的 ${selfAnswered} 题没有答案册（${selfLabel}），已由 AI 老师批改、单独统计，不计入自动得分`
      : (aiJudged > 0
        ? `已答的 ${selfAnswered} 题没有答案册（${selfLabel}），其中 ${aiJudged} 题已由 AI 老师批改，其余请用「判对 / 判错」自评`
        : `已答的 ${selfAnswered} 题没有参考答案（${selfLabel}），只能自评、不计入得分`))
    : ''
  const pendingText = pending > 0
    ? `可判分的 ${pending} 题（${PaperGroupRefLabel(pendingGroups)}）还没作答`
    : ''
  return `${[selfText, pendingText].filter((part) => part !== '').join('；')}。`
}


// ---------------------------------------------------------------------------
// AI teacher (the model grades every answered question, with or without a key)
// ---------------------------------------------------------------------------

/** Verdict rows the AI teacher returned, sanitized for rendering/persisting. */
function PaperAiRows(paper) {
  const ai = paper !== null && typeof paper === 'object'
    && paper.ai !== null && typeof paper.ai === 'object' && !Array.isArray(paper.ai)
    ? paper.ai
    : {}
  const rows = {}
  for (const [id, value] of Object.entries(ai)) {
    if (value === null || typeof value !== 'object') continue
    const verdict = value.verdict === 'correct' || value.verdict === 'close' || value.verdict === 'wrong'
      ? value.verdict
      : ''
    if (verdict === '') continue
    rows[String(id).slice(0, 120)] = {
      verdict,
      comment: String(value.comment ?? '').slice(0, 160),
      answer: String(value.answer ?? '').slice(0, 300),
    }
  }
  return rows
}

/**
 * Every answered question of the paper — the AI teacher grades the whole sheet,
 * answer-book questions included (their key is sent along as a reference so the
 * teacher and the answer book cannot drift apart).
 */
function PaperAiCandidates(model, paper) {
  const answers = paper !== null && typeof paper === 'object'
    && paper.answers !== null && typeof paper.answers === 'object'
    ? paper.answers
    : {}
  const items = []
  for (const group of PaperList(model?.groups)) {
    const groupLabel = [String(group.label ?? '').trim(), String(group.titleEn ?? '').trim()]
      .filter((part) => part !== '')
      .join(' ')
      .slice(0, 160)
    // One "context" string carries whatever the book prints above the questions:
    // the worked example, a word box and/or a table. The teacher needs all of it
    // for generated answer lines and matching questions.
    const contextParts = []
    const exampleParts = PaperList(group.example)
      .slice(0, 2)
      .map((entry) => {
        if (entry !== null && typeof entry === 'object') {
          const en = String(entry.en ?? '').trim()
          return en !== '' ? en : String(entry.zh ?? '').trim()
        }
        return String(entry ?? '').trim()
      })
      .filter((line) => line !== '')
      .join(' → ')
    const words = PaperList(group.wordBox).map((word) => String(word ?? '').trim()).filter((word) => word !== '')
    const tableRows = PaperList(group.table)
      .slice(0, 8)
      .map((row) => PaperList(row).map((cell) => String(cell ?? '').trim()).join(' | '))
    const matchingData = group.matching === true && group.matchingData !== null && group.matchingData !== undefined
      ? group.matchingData
      : null
    if (exampleParts !== '') contextParts.push(`示范：${exampleParts}`)
    if (words.length > 0) contextParts.push(`词框：${words.join(' / ')}`)
    if (tableRows.length > 0) contextParts.push(`表格：${tableRows.join('；')}`)
    if (matchingData !== null) {
      const right = PaperList(matchingData.right)
        .map((option) => `${String(option?.letter ?? '').trim()}. ${String(option?.text ?? '').trim()}`)
        .filter((line) => line !== '.')
        .join('；')
      if (right !== '') contextParts.push(`${String(matchingData.rightTitle ?? 'B')} 栏选项：${right}`)
    }
    const example = contextParts.join('；').slice(0, 400)
    for (const question of PaperList(group.questions)) {
      if (question.isExample) continue
      if (!PaperQuestionAnswered(question, answers)) continue
      const keys = PaperQuestionAnswerKeys(question)
      let answer = ''
      if (question.kind === 'blank' && keys.length > 1) {
        // Several blanks: label them so the model maps each value to its ___.
        answer = keys
          .map((key, index) => `第${index + 1}空：${String(answers[key] ?? '').trim()}`)
          .join('；')
      } else if (PaperList(question.lineParts).length > 1) {
        // Stacked questions: one learner answer per question row.
        answer = keys
          .map((key, index) => `第${index + 1}句：${String(answers[key] ?? '').trim()}`)
          .join('；')
      } else {
        answer = String(answers[keys[0]] ?? '').trim()
      }
      answer = answer.slice(0, 500)
      // A few table / dictation / free-write rows only have an answer line; the
      // group instruction is the prompt, so the teacher still gets context.
      const ownPrompt = String(question.promptText ?? '').trim().slice(0, 500)
      const numberLabel = `${question.num}${question.letterLabel !== undefined ? question.letterLabel : question.letter}`
      const prompt = ownPrompt !== ''
        ? ownPrompt
        : `${groupLabel !== '' ? groupLabel : '本组'} · 第 ${numberLabel} 题（按本组要求 / 表格 / 词框作答）`
      if (answer === '') continue
      const referenceLines = PaperList(question.referenceLines)
      const reference = PaperQuestionHasReference(question)
        ? (PaperList(question.lineParts).length > 1
          ? referenceLines.map((line, index) => `第${index + 1}句：${line}`).join('；').slice(0, 400)
          : referenceLines.join(' / ').trim().slice(0, 400))
        : ''
      items.push({ id: question.id, prompt, answer, group: groupLabel, example, reference })
    }
  }
  return items
}

/**
 * Merge AI verdicts into the draft. Verdicts live only in `paper.ai`; they are
 * the paper's single grading channel (the UI can still override one question
 * with 判对 / 判错 via `marks`). Only questions that are still answered are
 * accepted — a stale model reply can never score a question the learner just
 * cleared or changed.
 */
function PaperApplyAi(model, paper, rows) {
  const target = paper !== null && typeof paper === 'object' ? paper : {}
  const candidates = new Set(PaperAiCandidates(model, target).map((item) => item.id))
  const ai = { ...PaperAiRows(target) }
  let applied = 0
  for (const row of PaperList(rows)) {
    if (row === null || typeof row !== 'object') continue
    const id = String(row.id ?? '').trim()
    if (!candidates.has(id)) continue
    const verdict = row.verdict === 'correct' || row.verdict === 'close' || row.verdict === 'wrong' ? row.verdict : ''
    if (verdict === '') continue
    ai[id] = {
      verdict,
      comment: String(row.comment ?? '').trim().slice(0, 160),
      answer: String(row.answer ?? '').trim().slice(0, 300),
    }
    applied += 1
  }
  if (applied === 0) return target
  return { ...target, ai, graded: true }
}

/** How many rows PaperApplyAi would actually accept for the current draft. */
function PaperAiAppliedCount(model, paper, rows) {
  const candidates = new Set(PaperAiCandidates(model, paper).map((item) => item.id))
  const ids = new Set()
  for (const row of PaperList(rows)) {
    if (row === null || typeof row !== 'object') continue
    const id = String(row.id ?? '').trim()
    if (!candidates.has(id) || ids.has(id)) continue
    const verdict = row.verdict === 'correct' || row.verdict === 'close' || row.verdict === 'wrong' ? row.verdict : ''
    if (verdict !== '') ids.add(id)
  }
  return ids.size
}

function PaperRevealedAll(model, paper) {
  const revealed = paper !== null && typeof paper === 'object' && paper.revealed !== null && typeof paper.revealed === 'object'
    ? paper.revealed
    : {}
  const groups = model.groups.filter((group) => group.questions.some((question) => PaperQuestionHasReference(question) || question.referenceSource === 'prompt'))
  if (groups.length === 0) return false
  return groups.every((group) => revealed[group.key] === true)
}

const PAPER_CHINESE_NUMBERS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十']

function PaperChineseIndex(index) {
  if (Number.isInteger(index) && index >= 0 && index < PAPER_CHINESE_NUMBERS.length) return `${PAPER_CHINESE_NUMBERS[index]}、`
  return `${index + 1}.`
}
