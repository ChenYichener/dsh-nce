/**
 * Exercise-paper engine tests.
 *
 * The pure paper logic lives in `src/client/10-paper-engine.js`, with no React
 * or browser dependency. This script evaluates that whole fragment in a plain
 * function and checks the parser / grader against the real 144-lesson data plus
 * hand-written cases.
 *
 * Usage: node scripts/test-paper.mjs
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const domainPath = path.join(root, 'src/client/01-domain.js')
const enginePath = path.join(root, 'src/client/10-paper-engine.js')
const dataDir = path.join(root, 'data')

const failures = []
let checks = 0

function check(name, condition, detail) {
  checks += 1
  if (!condition) failures.push(`${name}${detail === undefined ? '' : ` — ${detail}`}`)
}

function equal(name, actual, expected) {
  check(name, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

const domainCode = await fs.readFile(domainPath, 'utf8')
const engineCode = await fs.readFile(enginePath, 'utf8')
const core = new Function(`${domainCode}\n${engineCode}
  return {
    PaperBuildModel,
    PaperBuildParts,
    PaperEvaluate,
    PaperJudge,
    PaperNorm,
    PaperParseAnswers,
    PaperQuestionAnswered,
    PaperQuestionAnswerKeys,
    PaperQuestionHasReference,
    PaperScoreHint,
    PaperAiCandidates,
    PaperAiRows,
    PaperApplyAi,
    PaperAiAppliedCount,
  }
`)()
const {
  PaperBuildModel,
  PaperBuildParts,
  PaperEvaluate,
  PaperJudge,
  PaperNorm,
  PaperParseAnswers,
  PaperQuestionAnswered,
  PaperQuestionHasReference,
  PaperScoreHint,
  PaperAiCandidates,
  PaperAiRows,
  PaperApplyAi,
  PaperAiAppliedCount,
} = core

// ---------------------------------------------------------------------------
// 1. Answer parser
// ---------------------------------------------------------------------------
{
  const parsed = PaperParseAnswers([
    '1. b. No, they aren\'t. They\'re German.',
    'c. No, we aren\'t. We\'re Italian.',
    '2. It is not my umbrella. / It isn\'t my umbrella.',
    'I0. is, comes, speaks, is',
  ])
  equal('parse: item 1 has sub b', (parsed.get(1)?.letters.get('b') ?? []).length, 1)
  equal('parse: item 1 has sub c', (parsed.get(1)?.letters.get('c') ?? []).length, 1)
  equal('parse: item 2 plain segments', (parsed.get(2)?.segments ?? []).length, 1)
  equal('parse: OCR I0 repaired to 10', parsed.has(10), true)
  const embedded = PaperParseAnswers(['3. first line\n4. second item'])
  equal('parse: embedded newlines split items', embedded.has(4), true)
}

// ---------------------------------------------------------------------------
// 2. Normalisation / contraction handling
// ---------------------------------------------------------------------------
{
  equal('norm: contractions', PaperNorm('It isn\'t my umbrella.'), PaperNorm('It is not my umbrella'))
  equal('norm: case + punctuation', PaperNorm('HELLO, world!'), 'hello world')
  equal('norm: curly quotes', PaperNorm('It\u2019s a school.'), PaperNorm("It's a school."))
  equal('norm: cannot', PaperNorm('I cannot go'), PaperNorm('I can not go'))
  equal('norm: empty', PaperNorm('  ...  '), '')
}

// ---------------------------------------------------------------------------
// 3. Model over all real lessons
// ---------------------------------------------------------------------------
const index = JSON.parse(await fs.readFile(path.join(dataDir, 'index.json'), 'utf8'))
const lessonCount = Number(index?.book?.lessonCount) || 144
const totals = { groups: 0, questions: 0, examples: 0, gradable: 0, blanks: 0, lettered: 0 }
const allModels = []
for (let id = 1; id <= lessonCount; id += 1) {
  const file = path.join(dataDir, 'lessons', `lesson-${String(id).padStart(3, '0')}.json`)
  const lesson = JSON.parse(await fs.readFile(file, 'utf8'))
  const model = PaperBuildModel(lesson)
  allModels.push(model)
  equal(`lesson ${id}: id`, model.lessonId, lesson.id)
  const expectedGroups = (lesson.exercises?.length ?? 0) + (lesson.gwb?.sections?.length ?? 0)
  equal(`lesson ${id}: group count`, model.groups.length, expectedGroups)
  const ids = new Set()
  let expectedQuestions = 0
  let expectedGradable = 0
  let expectedExamples = 0
  for (const group of model.groups) {
    check(`lesson ${id}/${group.key}: has title`, group.titleZh !== '' || group.titleEn !== '', 'empty titles')
    for (const question of group.questions) {
      check(`lesson ${id}: unique id ${question.id}`, !ids.has(question.id), 'duplicate question id')
      ids.add(question.id)
      if (question.isExample) {
        expectedExamples += 1
        continue
      }
      expectedQuestions += 1
      if (question.kind === 'blank') {
        check(`lesson ${id}/${question.id}: blank count`, question.blankCount > 0 && question.lineTokens !== null)
        totals.blanks += 1
      }
      if (question.letter !== '') totals.lettered += 1
      if (question.referenceSource !== 'none') {
        expectedGradable += 1
        if (question.kind === 'match') {
          check(`lesson ${id}/${question.id}: match letters`, (question.matchLetters ?? []).length > 0, 'no matchLetters')
          check(`lesson ${id}/${question.id}: match options`, (question.matchOptions ?? []).length > 1, 'no matchOptions')
        } else {
          check(`lesson ${id}/${question.id}: has parts`, question.parts.length > 0)
          for (const part of question.parts) {
            check(`lesson ${id}/${question.id}: part raw`, part.raws.length > 0 && part.raws.every((raw) => raw.trim() !== ''))
          }
        }
      }
      // Blank keys must line up with the recorded blank count; stacked
      // multi-question items get one answer key per question row.
      const keys = core.PaperQuestionAnswerKeys(question)
      const lineCount = Array.isArray(question.lineParts) ? question.lineParts.length : 0
      const expectedKeys = question.kind === 'blank'
        ? question.blankCount
        : (lineCount > 1 ? lineCount : 1)
      equal(`lesson ${id}/${question.id}: answer keys`, keys.length, expectedKeys)
    }
  }
  equal(`lesson ${id}: question stats`, model.stats.questions, expectedQuestions)
  equal(`lesson ${id}: example stats`, model.stats.examples, expectedExamples)
  equal(`lesson ${id}: gradable stats`, model.stats.gradable, expectedGradable)
  totals.groups += model.groups.length
  totals.questions += expectedQuestions
  totals.examples += expectedExamples
  totals.gradable += expectedGradable
}

console.log('data coverage:', JSON.stringify(totals))
check('coverage: enough questions', totals.questions >= 4000, `only ${totals.questions}`)
check('coverage: enough gradable', totals.gradable >= 2800, `only ${totals.gradable}`)
check('coverage: examples detected', totals.examples >= 55, `only ${totals.examples}`)
check('coverage: blanks detected', totals.blanks >= 800, `only ${totals.blanks}`)

// ---------------------------------------------------------------------------
// 4. Targeted grading cases on real lesson data
// ---------------------------------------------------------------------------
const lessons = new Map()
async function lesson(id) {
  if (!lessons.has(id)) {
    const file = path.join(dataDir, 'lessons', `lesson-${String(id).padStart(3, '0')}.json`)
    lessons.set(id, JSON.parse(await fs.readFile(file, 'utf8')))
  }
  return lessons.get(id)
}

function findGroup(model, label) {
  return model.groups.find((group) => group.label === label) ?? null
}
function findQuestion(group, num, letter) {
  if (group === null) return null
  return group.questions.find((question) => question.num === num && (letter === undefined || question.letter === letter)) ?? null
}
function answersFor(question, values) {
  const keys = core.PaperQuestionAnswerKeys(question)
  const map = {}
  keys.forEach((key, index) => { map[key] = values[index] ?? '' })
  return map
}
function answersForKindText(question, text) {
  return answersFor(question, [text])
}

{
  // Lesson 1 · workbook II: word-bank fill in the blank, answer "pencil".
  const model = PaperBuildModel(await lesson(1))
  const group = findGroup(model, 'II.')
  const question = findQuestion(group, 2)
  check('lesson 1 II.2 is a blank question', question !== null && question.kind === 'blank')
  equal('lesson 1 II.2 reference', question.referenceLines[0], 'pencil')
  equal('grade: correct word', PaperJudge(question, answersFor(question, ['pencil'])), 'correct')
  equal('grade: case/punct insensitive', PaperJudge(question, answersFor(question, ['Pencil.'])), 'correct')
  equal('grade: wrong word', PaperJudge(question, answersFor(question, ['book'])), 'wrong')
  equal('grade: empty blank', PaperJudge(question, answersFor(question, [''])), 'blank')

  // Lesson 1 · workbook I: dialogue blank, full-sentence reference.
  const groupOne = findGroup(model, 'I.')
  const questionOne = findQuestion(groupOne, 2)
  equal('lesson 1 I.2 reference', questionOne.referenceLines[0], 'My name is Ann Scott.')
  equal('grade: full sentence in blank', PaperJudge(questionOne, answersFor(questionOne, ['My name is Ann Scott.'])), 'correct')

  // Lesson 1 · workbook III: rewrite as a question (free answer).
  const groupThree = findGroup(model, 'III.')
  const questionThree = findQuestion(groupThree, 2)
  check('lesson 1 III.2 is a text question', questionThree !== null && questionThree.kind === 'text')
  equal('grade: free answer exact', PaperJudge(questionThree, answersFor(questionThree, ['Is this your chair?'])), 'correct')
  equal('grade: free answer no punctuation', PaperJudge(questionThree, answersFor(questionThree, ['is this your chair'])), 'correct')
  check('grade: nearby wrong answer not correct', PaperJudge(questionThree, answersFor(questionThree, ['Is this your car?'])) !== 'correct')
}

{
  // Lesson 3 · workbook II: two acceptable contracted / full forms.
  const model = PaperBuildModel(await lesson(3))
  const group = findGroup(model, 'II.')
  const question = findQuestion(group, 2)
  check('lesson 3 II.2 shows both forms in the reference', question !== null && question.referenceLines[0].includes('/'))
  equal('grade: alternative contracted form', PaperJudge(question, answersFor(question, ["This isn't my umbrella."])), 'correct')
  equal('grade: alternative full form', PaperJudge(question, answersFor(question, ['This is not my umbrella.'])), 'correct')
  equal('grade: missed not', PaperJudge(question, answersFor(question, ['This is my umbrella.'])), 'wrong')
  // Worked example embedded in the item text must not become an input question.
  const example = findQuestion(group, 2)
  check('lesson 3 II.2 keeps parsed reference', example !== null)
  const exampleGroup = findGroup(model, 'III.')
  const exampleQuestion = findQuestion(exampleGroup, 2)
  check('lesson 3 III.2 detected as worked example', exampleQuestion !== null && exampleQuestion.isExample === true)
}

{
  // Lesson 4 · textbook copy exercise: the prompt itself is the reference.
  const model = PaperBuildModel(await lesson(4))
  const copyGroup = model.groups.find((group) => group.source === 'ex' && group.label === 'A')
  const question = findQuestion(copyGroup, 1)
  check('lesson 4 copy question is gradable', question !== null && question.referenceSource === 'prompt')
  equal('grade: copy exact', PaperJudge(question, answersFor(question, ['This is not my umbrella.'])), 'correct')
  equal('grade: copy case-insensitive', PaperJudge(question, answersFor(question, ['this is not my umbrella'])), 'correct')
  equal('grade: copy wrong', PaperJudge(question, answersFor(question, ['This is my umbrella.'])), 'wrong')
  // Textbook "answer these questions" has no stored answer → self-assessed.
  const answerGroup = model.groups.find((group) => group.source === 'ex' && group.label === 'B')
  const noReference = findQuestion(answerGroup, 1)
  check('lesson 4 B.1 has no reference', noReference !== null && noReference.referenceSource === 'none')
  equal('grade: no reference stays self-assessed', PaperJudge(noReference, answersFor(noReference, ['Yes, it is.'])), 'unrated')
}

{
  // Lesson 16 · lettered sub-questions (a., b., …) with lettered references.
  const model = PaperBuildModel(await lesson(16))
  const group = findGroup(model, 'I.')
  check('lesson 16 I. has lettered sub-questions', group !== null && group.questions.some((question) => question.letter === 'b'))
  const b = findQuestion(group, 1, 'b')
  check('lesson 16 I.1b exists', b !== null)
  equal('lesson 16 I.1b reference', (b?.referenceLines ?? [])[0], "No, they aren't. They're German.")
  equal('grade: lettered answer', PaperJudge(b, answersFor(b, ["No, they aren't. They're German."])), 'correct')
  equal('grade: lettered contraction', PaperJudge(b, answersFor(b, ['No they are not they are German'])), 'correct')
}

{
  // Lesson 10 workbook I: two questions per number, one answer line each.
  const model = PaperBuildModel(await lesson(10))
  const group = findGroup(model, 'I.')
  const question = findQuestion(group, 2)
  check('lesson 10 I.2 has two stacked question rows', question !== null && question.lines.length === 2, JSON.stringify(question?.lines))
  equal('lesson 10 I.2 row 1 prompt', question?.lines[0], 'Is that pencil long?')
  equal('lesson 10 I.2 row 2 prompt', question?.lines[1], 'Is it short?')
  equal('lesson 10 I.2 has two answer keys', core.PaperQuestionAnswerKeys(question).length, 2)
  equal('lesson 10 I.2 reference row 1', question?.referenceLines[0], "No, it isn't.")
  equal('lesson 10 I.2 reference row 2', question?.referenceLines[1], 'Yes, it is.')
  equal('grade: both stacked answers', PaperJudge(question, answersFor(question, ["No, it isn't.", 'Yes, it is.'])), 'correct')
  equal('grade: stacked answers reversed', PaperJudge(question, answersFor(question, ['Yes, it is.', "No, it isn't."])), 'wrong')
  equal('grade: one stacked row missing', PaperJudge(question, answersFor(question, ["No, it isn't.", ''])), 'blank')
  const example = findQuestion(group, 1)
  check('lesson 10 I.1 is static example', example !== null && example.isExample === true)
  equal('lesson 10 I.1 intro row count', example?.lines.length, 2)
  equal('lesson 10 I.1 example answers', (example?.exampleAnswers ?? []).length, 2)
  equal('lesson 10 I.1 example answer row 1', example?.exampleAnswers?.[0], "No, I'm not.")
}

{
  // Lesson 5 workbook II: cue questions, each own answer row.
  const model = PaperBuildModel(await lesson(5))
  const group = findGroup(model, 'II.')
  const question = findQuestion(group, 2)
  check('lesson 5 II.2 has two stacked rows', question !== null && question.lineParts.length === 2)
  equal('grade: cue answers by row', PaperJudge(question, answersFor(question, ['Yes, she is.', "No, she isn't. She is English."])), 'correct')
}

{
  // Lesson 71 workbook III: Yes/No answers must be split per question, not merged.
  const model = PaperBuildModel(await lesson(71))
  const group = findGroup(model, 'III.')
  const question = findQuestion(group, 2)
  check('lesson 71 III.2 keeps two ordered answers', question !== null && question.lineParts.length === 2)
  equal('grade: ordered yes/no answers', PaperJudge(question, answersFor(question, ['Yes, she did. She washed them.', "No, he didn't. He didn't wash them."])), 'correct')
}

{
  // Workbook sections may print several worked examples before the answer key.
  const model = PaperBuildModel(await lesson(7))
  const group = findGroup(model, 'III.')
  equal('lesson 7 III. prints four examples', group?.questions.filter((question) => question.isExample).length, 4)
  check('lesson 7 III.2 example', findQuestion(group, 2)?.isExample === true)
  check('lesson 7 III.4 example', findQuestion(group, 4)?.isExample === true)
  check('lesson 7 III.5 is a real question', findQuestion(group, 5)?.isExample === false)
  equal('lesson 7 III.5 reference', (findQuestion(group, 5)?.referenceLines ?? [])[0], "No, I'm not. I'm a mechanic.")
}

{
  // Self-assessed multi-line questions must keep their input (not become examples).
  const model = PaperBuildModel(await lesson(51))
  const question = findQuestion(findGroup(model, 'III.'), 4)
  check('lesson 51 III.4 stays fillable', question !== null && question.isExample === false)
  equal('lesson 51 III.4 prompt rows', question?.lines.length, 2)
  // A printed example in the middle of a section (answer key skips it) is static.
  const mixed = PaperBuildModel(await lesson(133))
  check('lesson 133 III.7 printed example', findQuestion(findGroup(mixed, 'III.'), 7)?.isExample === true)
}

{
  // Answers printed inside the prompt must not be shown twice.
  const five = findGroup(PaperBuildModel(await lesson(5)), 'III.')
  equal('lesson 5 III.4 prompt is the printed answer', findQuestion(five, 4)?.lines[0], "It's a Toyota.")
  equal('lesson 5 III.4 reference is the question', findQuestion(five, 4)?.referenceLines[0], 'What make is your car?')
  const twelve = findGroup(PaperBuildModel(await lesson(12)), 'I.')
  equal('lesson 12 I.2 prompt keeps only the source sentence', findQuestion(twelve, 2)?.lines[0], 'Whose pencil is this?')
  equal('lesson 12 I.2 reference keeps the rewrite', findQuestion(twelve, 2)?.referenceLines[0], 'Whose is this pencil?')
}

{
  // Unnumbered answer blocks map one reference line per blank.
  for (const [id, label, blanks] of [[55, 'II.', 19], [73, 'II.', 15], [78, 'II.', 25], [75, 'III.', 12]]) {
    const question = findQuestion(findGroup(PaperBuildModel(await lesson(id)), label), 1)
    equal(`lesson ${id} ${label} slot references`, question?.slotReference?.length ?? 0, blanks)
    check(`lesson ${id} ${label} has reference`, question?.referenceSource === 'answer')
  }
}

{
  // "Ask and answer" exercises rule one line for the question, one for the answer.
  const ask19 = findQuestion(findGroup(PaperBuildModel(await lesson(19)), 'I.'), 3)
  equal('lesson 19 I.3 has question + answer rows', ask19?.lineParts?.length, 2)
  equal('lesson 19 I.3 row 1', ask19?.lineParts?.[0]?.raws?.[0], 'Are you tired?')
  equal('lesson 19 I.3 row 2', ask19?.lineParts?.[1]?.raws?.[0], 'Yes, we are.')
  equal('lesson 19 I.3 row 2 prompt blank', ask19?.lines?.[1], '')
  equal('lesson 19 I.3 both rows correct', PaperJudge(ask19, answersFor(ask19, ['Are you tired?', 'Yes, we are.'])), 'correct')
  equal('lesson 19 I.3 answer row missing', PaperJudge(ask19, answersFor(ask19, ['Are you tired?', ''])), 'blank')
  const ask42 = findQuestion(findGroup(PaperBuildModel(await lesson(42)), 'I.'), 2)
  equal('lesson 42 I.2 has two Q/A pairs', ask42?.lineParts?.length, 4)
  equal('lesson 42 I.2 row 3 question', ask42?.lineParts?.[2]?.raws?.[0], 'Is there a picture in that book, too?')
  equal('lesson 42 I.2 row 4 answer', ask42?.lineParts?.[3]?.raws?.[0], "No, there isn't. There isn't a picture there.")
  const ask93 = findQuestion(findGroup(PaperBuildModel(await lesson(93)), 'I.'), 2)
  equal('lesson 93 I.2 slash answer split into rows', ask93?.lineParts?.length, 2)
  equal('lesson 93 I.2 row 2', ask93?.lineParts?.[1]?.raws?.[0], "No, she won't. She cleaned the kitchen yesterday morning.")
}

{
  // Merged item numbers are split into separate questions.
  const model = PaperBuildModel(await lesson(88))
  const group = findGroup(model, 'II.')
  equal('lesson 88 II. has ten items', group?.questions.length, 10)
  check('lesson 88 II.9 prompt is clean', !/\b10\./.test(findQuestion(group, 9)?.promptText ?? ''))
  equal('lesson 88 II.10 prompt', findQuestion(group, 10)?.lines[0], 'Has she typed a letter to her parents and one to her teacher yet?')
}

{
  // Printed dialogues rule one line per spoken sentence (question / answer).
  const call = findQuestion(findGroup(PaperBuildModel(await lesson(32)), 'II.'), 1, 'b')
  equal('lesson 32 II.1b has six dialogue lines', call?.lineParts?.length, 6)
  equal('lesson 32 II.1b line 1', call?.lineParts?.[0]?.raws?.[0], 'Is Sam sitting on a chair?')
  equal('lesson 32 II.1b line 6', call?.lineParts?.[5]?.raws?.[0], "He's standing near the door.")
  const two = findQuestion(findGroup(PaperBuildModel(await lesson(35)), 'II.'), 1, 'b')
  equal('lesson 35 II.1b asks two questions', two?.lineParts?.length, 2)
  equal('lesson 35 II.1b prompt row 1', two?.lines?.[0], 'Are you walking across the street? (along)')
  equal('lesson 35 II.1b answer row 2', two?.lineParts?.[1]?.raws?.[0], "I'm looking at the shop windows.")
  const soup = findQuestion(findGroup(PaperBuildModel(await lesson(109)), 'II.'), 1, 'b')
  equal('lesson 109 II.1b asks two questions', soup?.lineParts?.length, 2)
  equal('lesson 109 II.1b row 2 prompt', soup?.lines?.[1], 'Would you like some soup?')
  const dialogue = findQuestion(findGroup(PaperBuildModel(await lesson(44)), 'I.'), 2)
  equal('lesson 44 I.2 has six dialogue lines', dialogue?.lineParts?.length, 6)
  // Missing sub-items i/j were restored from the book and answer key.
  const gap = PaperBuildModel(await lesson(54))
  check('lesson 54 I.1j exists', findQuestion(findGroup(gap, 'I.'), 1, 'j') !== null)
  check('lesson 54 I.2i has a reference', findQuestion(findGroup(gap, 'I.'), 2, 'i')?.referenceSource === 'answer')
}

{
  // "No, it isn't ours/yours." is one answer line with two accepted variants.
  const question = findQuestion(findGroup(PaperBuildModel(await lesson(98)), 'I.'), 1, 'e')
  equal('lesson 98 I.1e is one answer line', question?.lineParts?.length ?? 0, 0)
  equal('lesson 98 I.1e accepted variants', question?.parts?.[0]?.norms?.length ?? 0, 2)
}

{
  // Workbook tables must line up: header cells == data row cells.
  const tableModel = PaperBuildModel(await lesson(110))
  const tableGroup = findGroup(tableModel, 'I.')
  equal('lesson 110 I. table header', (tableGroup?.table?.[0] ?? []).join('|'), 'Jane|Mary|Ann')
  check('lesson 110 I. table rows stay aligned', (tableGroup?.table ?? []).every((row) => row.length === 3))
  // Matching column A keeps the book's wording (no ellipsis added from a blank marker).
  const matching = findGroup(PaperBuildModel(await lesson(41)), 'I.')
  equal('lesson 41 I. matching left 1', matching?.matchingData?.left?.[0]?.text, 'a piece of')
  // Printed examples keep the book's Q/A rows.
  const three = findGroup(PaperBuildModel(await lesson(3)), 'IV.')
  equal('lesson 3 IV. example rows', findQuestion(three, 1)?.lines.length, 2)
  equal('lesson 3 IV. example answer row', findQuestion(three, 1)?.lines[1], "No, it isn't. It isn't my umbrella. It's your umbrella.")
  const twelve = findGroup(PaperBuildModel(await lesson(12)), 'II.')
  equal('lesson 12 II. example rows', findQuestion(twelve, 1)?.lines.length, 2)
  // NCE written exercise: two printed question lines stay two lines.
  const nce90 = PaperBuildModel(await lesson(90))
  const exB = nce90.groups.find((group) => group.source === 'ex' && group.label === 'B')
  equal('lesson 90 B.1 printed lines', findQuestion(exB, 1)?.lines.length, 2)
  equal('lesson 90 B.1 second line', findQuestion(exB, 1)?.lines[1], 'What about Tom?')
}

// ---------------------------------------------------------------------------
// 4b. Self-consistency: the reference itself must always be graded correct
// ---------------------------------------------------------------------------
{
  let accepted = 0
  const rejected = []
  for (const model of allModels) {
    for (const group of model.groups) {
      for (const question of group.questions) {
        if (question.isExample || question.referenceSource === 'none' || question.parts.length === 0) continue
        if (question.kind === 'blank' && question.blankCount !== 1) continue
        const keys = core.PaperQuestionAnswerKeys(question)
        const lineParts = Array.isArray(question.lineParts) ? question.lineParts : []
        const answer = question.parts.map((part) => part.raws[0]).join(' ')
        const answers = {}
        if (lineParts.length > 1) {
          keys.forEach((key, index) => { answers[key] = (lineParts[index]?.raws[0] ?? '') })
        } else {
          keys.forEach((key, index) => { answers[key] = index === 0 ? answer : '' })
        }
        const verdict = PaperJudge(question, answers)
        if (verdict === 'correct') accepted += 1
        else rejected.push({ lesson: model.lessonId, question: question.id, answer, verdict })
      }
    }
  }
  check('self-consistency: enough covered questions', accepted >= 3000, `only ${accepted}`)
  equal('self-consistency: every reference accepted', rejected.length, 0)
  if (rejected.length > 0) console.error('  first rejected references:', rejected.slice(0, 5))
}

// ---------------------------------------------------------------------------
// 4c. Table / dictation exercises without items get free-write lines
// ---------------------------------------------------------------------------
{
  const model = PaperBuildModel(await lesson(30))
  const group = model.groups.find((candidate) => candidate.source === 'ex' && candidate.label === 'B')
  check('lesson 30 table exercise detected as free-write', group !== null && group.freeWrite === true)
  equal('lesson 30 free-write line count', group?.questions.length, 11)
  check('lesson 30 free-write questions are self-assessed', (group?.questions ?? []).every((question) => question.kind === 'text' && question.referenceSource === 'none' && question.isExample === false))
  equal('lesson 30 free-write answers accepted as unrated', PaperJudge(group.questions[0], { [`${group.questions[0].id}#a`]: 'Shut the window!' }), 'unrated')

  const dictation = PaperBuildModel(await lesson(72)).groups.find((candidate) => candidate.source === 'ex' && /dictation/i.test(candidate.titleEn))
  check('lesson 72 dictation detected', dictation !== null && dictation.freeWrite === true)
  equal('lesson 72 dictation line count', dictation?.questions.length, 5)
}

// ---------------------------------------------------------------------------
// 4d. Review-regression cases: OCR pairing, alternative vs required parts,
//     annotation lines, fragment gating, duplicate sub-letters
// ---------------------------------------------------------------------------
{
  // Duplicate sub-letter inside an item must not reuse the first letter's answer.
  // (The source data was corrected, so build a synthetic lesson to keep the guard tested.)
  const dupModel = PaperBuildModel({
    id: 999,
    titleEn: 'duplicate letters',
    titleZh: '',
    exercises: [],
    gwb: {
      sections: [{ label: 'I.', titleEn: 'T', titleZh: '', items: [{ num: 1, text: 'a. one\nb. two\nc. three\nc. four' }] }],
      answers: [{ label: 'I.', lines: ['1. a. ONE', '1. b. TWO', '1. c. THREE'] }],
    },
  })
  const dupGroup = dupModel.groups.find((candidate) => candidate.key === 'gwb:0')
  const duplicate = dupGroup?.questions.find((question) => question.id === 'gwb:0:0:c2')
  check('duplicate letter question exists', duplicate !== undefined)
  equal('duplicate letter stays self-assessed', duplicate?.referenceSource, 'none')
  equal('duplicate letter gets a primed label', duplicate?.letterLabel, 'c′')
  const original = dupGroup?.questions.find((question) => question.id === 'gwb:0:0:c')
  check('first letter keeps its reference', original?.referenceSource === 'answer')

  // Multi-line answers that are rephrasings of one answer → either is accepted.
  const altModel = PaperBuildModel(await lesson(113))
  const altQuestion = findQuestion(findGroup(altModel, 'III.'), 2)
  equal('lesson 113 alternative form 1', PaperJudge(altQuestion, answersForKindText(altQuestion, "I don't want to go, and she doesn't want to go, either.")), 'correct')
  equal('lesson 113 alternative form 2', PaperJudge(altQuestion, answersForKindText(altQuestion, "I don't want to go, and neither does she.")), 'correct')

  // Ask-and-answer items rule one line for the question and one for the answer.
  const pairModel = PaperBuildModel(await lesson(50))
  const pair = findQuestion(findGroup(pairModel, 'II.'), 2)
  check('lesson 50 II.2 has a reference', pair !== null && pair.parts.length >= 1)
  equal('lesson 50 II.2 has two answer rows', pair?.lineParts?.length, 2)
  equal('lesson 50 II.2 row 1', pair?.lineParts?.[0]?.raws?.[0], 'Does he like jam or honey?')
  equal('lesson 50 II.2 full answer', PaperJudge(pair, answersFor(pair, ['Does he like jam or honey?', "He likes jam, but his brother doesn't. He likes honey."])), 'correct')
  equal('lesson 50 II.2 question only', PaperJudge(pair, answersFor(pair, ['Does he like jam or honey?', ''])), 'blank')

  // A pure-Chinese note inside the answer block is displayed but not required.
  const noteModel = PaperBuildModel(await lesson(112))
  const noteQuestion = findQuestion(findGroup(noteModel, 'III.'), 10)
  equal('lesson 112 annotation excluded from grading', noteQuestion?.parts.length, 1)
  equal('lesson 112 main answer accepted', PaperJudge(noteQuestion, answersForKindText(noteQuestion, 'not as tall as Marie')), 'correct')

  // Fragment gating: an embedded blank accepts the missing clause, not a word
  // that is already visible in the prompt.
  const fragmentModel = PaperBuildModel(await lesson(119))
  const fragment = findQuestion(findGroup(fragmentModel, 'II.'), 1, 'b')
  check('lesson 119 II.1b is an embedded blank', fragment !== null && fragment.kind === 'blank' && fragment.blankStandalone === false)
  equal('lesson 119 missing clause accepted', PaperJudge(fragment, { [`${fragment.id}#b0`]: 'he had his breakfast' }), 'correct')
  equal('lesson 119 single content word rejected', PaperJudge(fragment, { [`${fragment.id}#b0`]: 'breakfast' }), 'wrong')
  equal('lesson 119 prompt word rejected', PaperJudge(fragment, { [`${fragment.id}#b0`]: 'after' }), 'wrong')

  // Multi-blank answer lines with slashes: one reference answer per blank,
  // in order (lesson 4 workbook I: "it is / it isn't").
  const slotModel = PaperBuildModel(await lesson(4))
  const slotQuestion = findQuestion(slotModel.groups.find((group) => group.key === 'gwb:0'), 2)
  check('lesson 4 I.2 has two blanks', slotQuestion !== null && slotQuestion.blankCount === 2)
  equal('lesson 4 per-blank slots built', slotQuestion?.slotReference?.length, 2)
  equal('lesson 4 in-order blanks accepted', PaperJudge(slotQuestion, answersFor(slotQuestion, ['it is', "it isn't"])), 'correct')
  equal('lesson 4 swapped blanks rejected', PaperJudge(slotQuestion, answersFor(slotQuestion, ["it isn't", 'it is'])), 'wrong')
  equal('lesson 4 repeated blank rejected', PaperJudge(slotQuestion, answersFor(slotQuestion, ['it is', 'it is'])), 'wrong')
  const slotQuestionTwo = findQuestion(slotModel.groups.find((group) => group.key === 'gwb:0'), 3)
  equal('lesson 4 opposite order accepted', PaperJudge(slotQuestionTwo, answersFor(slotQuestionTwo, ["it isn't", 'it is'])), 'correct')
  // Same shape with full questions: lesson 49 workbook II asks two questions.
  const slotQuestions = PaperBuildModel(await lesson(49))
  const twoQuestion = findQuestion(slotQuestions.groups.find((group) => group.key === 'gwb:1'), 2)
  check('lesson 49 II.2 has two question blanks', twoQuestion !== null && twoQuestion.blankCount === 2 && twoQuestion.slotReference?.length === 2)
  equal('lesson 49 two-question blanks accepted', PaperJudge(twoQuestion, answersFor(twoQuestion, ['Does she like garden beans?', 'What about cabbages?'])), 'correct')
  equal('lesson 49 two-question blanks swapped', PaperJudge(twoQuestion, answersFor(twoQuestion, ['What about cabbages?', 'Does she like garden beans?'])), 'wrong')

  // Direct-speech → reported-speech completion: the missing clause (not a
  // single visible verb) is required.
  const reportedModel = PaperBuildModel(await lesson(133))
  const reported = findQuestion(reportedModel.groups[0], 2)
  check('lesson 133 II.2 is an embedded blank', reported !== null && reported.kind === 'blank' && reported.blankStandalone === false)
  equal('lesson 133 missing clause accepted', PaperJudge(reported, { [`${reported.id}#b0`]: 'she was too young to go to school' }), 'correct')
  equal('lesson 133 partial clause rejected', PaperJudge(reported, { [`${reported.id}#b0`]: 'she was too young' }), 'wrong')
  equal('lesson 133 single verb rejected', PaperJudge(reported, { [`${reported.id}#b0`]: 'was' }), 'wrong')

  // Blank answers that sit on their own line must be the whole answer.
  const standaloneModel = PaperBuildModel(await lesson(1))
  const standalone = findQuestion(findGroup(standaloneModel, 'I.'), 2)
  check('lesson 1 I.2 is a standalone blank', standalone !== null && standalone.blankStandalone === true)
  equal('standalone blank rejects single word', PaperJudge(standalone, { [`${standalone.id}#b0`]: 'my' }), 'wrong')
  equal('standalone blank accepts full sentence', PaperJudge(standalone, { [`${standalone.id}#b0`]: 'My name is Ann Scott.' }), 'correct')
}

// ---------------------------------------------------------------------------
// 4e. Answer-block slashes: line breaks vs alternatives, word pairs,
//     Yes/No pairs, question+answer parts, matching sections
// ---------------------------------------------------------------------------
{
  // Bare/one-sided slash = line break: every sentence is required.
  const model31 = PaperBuildModel(await lesson(31))
  const q31 = findQuestion(findGroup(model31, 'I.'), 2)
  equal('lesson 31 full spoken answer',
    PaperJudge(q31, answersFor(q31, ["No, she isn't.", "She's in the kitchen. She's busy.", "She's cooking a meal."])), 'correct')
  equal('lesson 31 first sentence only',
    PaperJudge(q31, answersFor(q31, ["No, she isn't.", '', ''])), 'blank')

  // Leading cue word must be dropped, the dialogue answers are required.
  const model22 = PaperBuildModel(await lesson(22))
  const q22 = findQuestion(findGroup(model22, 'II.'), 2)
  equal('lesson 22 full dialogue',
    PaperJudge(q22, answersForKindText(q22, 'Which is your umbrella? This one? No, not that one. My umbrella is the green one.')), 'correct')
  equal('lesson 22 cue word only', PaperJudge(q22, answersForKindText(q22, 'umbrellas')), 'wrong')

  // Inline word alternatives "He/She" and "1/We".
  const model6 = PaperBuildModel(await lesson(6))
  const q6 = findQuestion(findGroup(model6, 'I.'), 2)
  equal('lesson 6 He variant', PaperJudge(q6, answersForKindText(q6, 'He is an English teacher.')), 'correct')
  equal('lesson 6 She variant', PaperJudge(q6, answersForKindText(q6, 'She is an English teacher.')), 'correct')
  equal('lesson 6 bare pronoun only', PaperJudge(q6, answersForKindText(q6, 'He')), 'wrong')
  const model46 = PaperBuildModel(await lesson(46))
  const q46 = findQuestion(findGroup(model46, 'II.'), 4)
  equal('lesson 46 I variant', PaperJudge(q46, answersForKindText(q46, 'I can read the thick one.')), 'correct')
  equal('lesson 46 We variant', PaperJudge(q46, answersForKindText(q46, 'We can read the thick one.')), 'correct')

  // "Yes…/No…" replies are alternatives; both full replies are accepted.
  const model7 = PaperBuildModel(await lesson(7))
  const q7 = findQuestion(findGroup(model7, 'II.'), 1, 'c')
  equal('lesson 7 yes reply', PaperJudge(q7, answersForKindText(q7, 'Yes, I am.')), 'correct')
  equal('lesson 7 no reply', PaperJudge(q7, answersForKindText(q7, "No, I'm not. I'm a boy.")), 'correct')
  equal('lesson 7 fragment rejected', PaperJudge(q7, answersForKindText(q7, 'an')), 'wrong')

  // Required question+answer pieces from one converted answer line.
  const model14 = PaperBuildModel(await lesson(14))
  const q14 = findQuestion(findGroup(model14, 'II.'), 2)
  equal('lesson 14 all required sentences',
    PaperJudge(q14, answersFor(q14, ["It's brown.", "It's the same colour. It's brown, too."])), 'correct')
  equal('lesson 14 first sentence only', PaperJudge(q14, answersFor(q14, ["It's brown.", ''])), 'blank')

  // Three dialogue answers joined with slashes are all required.
  const model76 = PaperBuildModel(await lesson(76))
  const q76 = findQuestion(findGroup(model76, 'II.'), 5)
  equal('lesson 76 full dialogue',
    PaperJudge(q76, answersFor(q76, ['Yes, they did.', 'They went to see a doctor a week ago.', "No, they didn't."])), 'correct')
  equal('lesson 76 first reply only', PaperJudge(q76, answersFor(q76, ['Yes, they did.', '', ''])), 'blank')

  // Matching sections are rebuilt into real two-column data by build-data.mjs
  // (left rows / right lettered options / number→letter key), so they now
  // render as two columns and are graded by letter.
  const model41 = PaperBuildModel(await lesson(41))
  const matching41 = model41.groups.find((group) => group.key === 'gwb:0')
  check('lesson 41 matching section detected', matching41 !== undefined && matching41.matching === true)
  check('lesson 41 matching has structured data', matching41?.matchingData !== null && matching41?.matchingData !== undefined)
  equal('lesson 41 matching left rows', matching41?.matchingData?.left.length, 10)
  equal('lesson 41 matching right options', matching41?.matchingData?.right.length, 12)
  check('lesson 41 matching key kept for display', (matching41?.matchingKey ?? []).length >= 1)
  check('lesson 41 matching questions gradable', (matching41?.questions ?? []).every((question) => question.referenceSource === 'answer'))
  const q41 = matching41.questions[2] // 3. a bar of … → i. chocolate
  equal('lesson 41 single match accepted', PaperJudge(q41, { [`${q41.id}#m`]: 'i' }), 'correct')
  equal('lesson 41 repeated match needs all letters', PaperJudge(matching41.questions[0], { [`${matching41.questions[0].id}#m`]: 'e, f, i, j' }), 'correct')
  equal('lesson 41 partial match is close', PaperJudge(matching41.questions[0], { [`${matching41.questions[0].id}#m`]: 'e' }), 'close')
  equal('lesson 41 wrong match', PaperJudge(matching41.questions[0], { [`${matching41.questions[0].id}#m`]: 'b' }), 'wrong')
  equal('lesson 41 B-column word accepted', PaperJudge(q41, { [`${q41.id}#m`]: 'chocolate' }), 'correct')

  const model9 = PaperBuildModel(await lesson(9))
  const matching9 = model9.groups.find((group) => group.key === 'gwb:2')
  equal('lesson 9 matching rows stay fillable', matching9?.questions.length, 10)
  check('lesson 9 matching rows are not examples', (matching9?.questions ?? []).every((question) => question.isExample === false))
  check('lesson 9 matching prompt has no column-B option glued in', (matching9?.questions ?? []).every((question) => !/\n\s*[a-j]\./.test(question.promptText)))
  equal('lesson 9 matching right options', matching9?.matchingData?.right.length, 10)
  equal('lesson 9 matching first pair', PaperJudge(matching9.questions[0], { [`${matching9.questions[0].id}#m`]: 'e' }), 'correct')
  equal('lesson 9 matching wrong letter', PaperJudge(matching9.questions[0], { [`${matching9.questions[0].id}#m`]: 'a' }), 'wrong')
  equal('lesson 9 matching blank stays blank', PaperJudge(matching9.questions[0], {}), 'blank')

  const matching30 = PaperBuildModel(await lesson(30)).groups.find((group) => group.key === 'gwb:0')
  equal('lesson 30 matching left rows', matching30?.matchingData?.left.length, 10)
  check('lesson 30 matching key note kept', (matching30?.matchingData?.keyNote ?? []).some((line) => line.includes('不唯一')))

  const matching81 = PaperBuildModel(await lesson(81)).groups.find((group) => group.key === 'gwb:2')
  equal('lesson 81 matching left rows', matching81?.matchingData?.left.length, 12)
  equal('lesson 81 matching right options from example', matching81?.matchingData?.right.length, 12)
  // "对应句" (rewrite as a corresponding sentence) is NOT a matching exercise.
  const model23 = PaperBuildModel(await lesson(23))
  const rewrite23 = model23.groups.find((group) => group.key === 'gwb:1')
  check('lesson 23 corresponding-sentence section still auto-graded', rewrite23 !== undefined && rewrite23.matching !== true && rewrite23.questions.some((question) => question.referenceSource !== 'none'))
}

// ---------------------------------------------------------------------------
// 5. Paper evaluation: score, marks, self-assessment
// ---------------------------------------------------------------------------
{
  const parts = PaperBuildParts(['Yes, it is.'])
  const question = {
    id: 'q1',
    isExample: false,
    kind: 'text',
    blankCount: 0,
    referenceSource: 'answer',
    referenceLines: ['Yes, it is.'],
    parts,
  }
  const openQuestion = {
    id: 'q2',
    isExample: false,
    kind: 'text',
    blankCount: 0,
    referenceSource: 'none',
    referenceLines: [],
    parts: [],
  }
  const model = { groups: [{ key: 'g1', questions: [question, openQuestion] }] }

  const ungraded = PaperEvaluate(model, { answers: { 'q1#a': 'Yes, it is.' }, marks: {}, graded: false, revealed: {} })
  equal('evaluate: answered before grading', ungraded.answered, 1)
  equal('evaluate: no score before grading', ungraded.autoCorrect, 0)
  equal('evaluate: open status', ungraded.statuses['q1'], 'open')

  const graded = PaperEvaluate(model, { answers: { 'q1#a': 'Yes, it is.' }, marks: {}, graded: true, revealed: {} })
  equal('evaluate: graded correct', graded.autoCorrect, 1)
  equal('evaluate: scoreable count', graded.gradable, 1)
  equal('evaluate: score percent', graded.score, 100)

  const wrong = PaperEvaluate(model, { answers: { 'q1#a': 'No, it is not.' }, marks: {}, graded: true, revealed: {} })
  equal('evaluate: graded wrong', wrong.autoWrong, 1)
  equal('evaluate: score zero', wrong.score, 0)

  const overridden = PaperEvaluate(model, { answers: { 'q1#a': 'No, it is not.' }, marks: { q1: 'right' }, graded: true, revealed: {} })
  equal('evaluate: manual override wins', overridden.autoCorrect, 1)

  const selfMarked = PaperEvaluate(model, { answers: { 'q2#a': 'anything' }, marks: { q2: 'right' }, graded: true, revealed: {} })
  equal('evaluate: self mark counted separately', selfMarked.selfRight, 1)
  equal('evaluate: self mark not in auto score', selfMarked.autoCorrect, 0)
  equal('evaluate: self mark counted as self-assessed', selfMarked.selfRight, 1)

  const unanswered = PaperEvaluate(model, { answers: {}, marks: {}, graded: true, revealed: {} })
  equal('evaluate: unanswered gradable counted', unanswered.blankGradable, 1)
  equal('evaluate: unanswered score zero', unanswered.score, 0)

  // A manual 判对 on an unanswered question must stay 未答 and not raise 得分.
  const emptyOverride = PaperEvaluate(model, { answers: {}, marks: { q1: 'right' }, graded: true, revealed: {} })
  equal('evaluate: unanswered override ignored', emptyOverride.autoCorrect, 0)
  equal('evaluate: unanswered override stays blank', emptyOverride.statuses['q1'], 'blank')
  equal('evaluate: unanswered override keeps score', emptyOverride.score, 0)
}

// ---------------------------------------------------------------------------
// 5b. Score hint: explain 0/20 when the answered questions have no answer key
// ---------------------------------------------------------------------------
{
  // Lesson 10 (screenshot case): 18 textbook written-exercise questions have no
  // answer key (self-assessed only), while the 20 scoreable grammar-workbook
  // questions are still unanswered — 得分 is legitimately 0/20.
  const model10 = PaperBuildModel(await lesson(10))
  equal('hint: lesson 10 questions', model10.stats.questions, 38)
  equal('hint: lesson 10 scoreable', model10.stats.gradable, 20)
  const selfAnswers = {}
  for (const group of model10.groups.filter((entry) => entry.source === 'ex')) {
    for (const question of group.questions) {
      for (const key of core.PaperQuestionAnswerKeys(question)) {
        selfAnswers[key] = question.kind === 'blank' ? "He's" : "Look at the man. He's very fat."
      }
    }
  }
  const selfPaper = { graded: true, answers: selfAnswers }
  const selfStats = PaperEvaluate(model10, selfPaper)
  equal('hint: self answers score nothing', selfStats.autoCorrect, 0)
  equal('hint: self answers counted as unrated', selfStats.unrated, 18)
  equal('hint: scoreable questions still blank', selfStats.blankGradable, 20)
  const selfHint = PaperScoreHint(model10, selfStats, selfPaper)
  check('hint: names the answered self-assessed count', selfHint.includes('18'), selfHint)
  check('hint: says self-assessed answers do not score', selfHint.includes('不计入得分'), selfHint)
  check('hint: points at the scoreable groups', selfHint.includes('语法练习册') && selfHint.includes('20'), selfHint)

  const emptyPaper = { graded: true, answers: {} }
  equal('hint: empty paper needs no explanation', PaperScoreHint(model10, PaperEvaluate(model10, emptyPaper), emptyPaper), '')

  // A scoreable paper that is fully answered needs no explanation either.
  const model11 = PaperBuildModel(await lesson(11))
  const questions11 = model11.groups.reduce((all, group) => all.concat(group.questions), [])
  const filledAnswers = {}
  for (const question of questions11) {
    if (question.isExample || !PaperQuestionHasReference(question)) continue
    for (const key of core.PaperQuestionAnswerKeys(question)) filledAnswers[key] = 'x'
  }
  const filledPaper = { graded: true, answers: filledAnswers }
  const filledStats = PaperEvaluate(model11, filledPaper)
  check('hint: fully answered scoreable paper is graded', filledStats.autoWrong + filledStats.autoCorrect + filledStats.autoClose > 0)
  equal('hint: fully answered scoreable paper needs no explanation', PaperScoreHint(model11, filledStats, filledPaper), '')

  // Partial scoreable answers: say how many are still blank.
  const firstGradable = questions11.find((question) => !question.isExample && PaperQuestionHasReference(question))
  const partialAnswers = { [core.PaperQuestionAnswerKeys(firstGradable)[0]]: 'x' }
  const partialPaper = { graded: true, answers: partialAnswers }
  const partialStats = PaperEvaluate(model11, partialPaper)
  const partialHint = PaperScoreHint(model11, partialStats, partialPaper)
  check('hint: names remaining scoreable questions', partialStats.blankGradable > 0 && partialHint.includes(String(partialStats.blankGradable)), partialHint)
}

// ---------------------------------------------------------------------------
// 5c. AI teacher: whole-sheet candidates, unified verdicts and score
// ---------------------------------------------------------------------------
{
  // Lesson 10: the AI teacher gets EVERY answered question — the 18 textbook
  // questions (no key) and any answer-book questions the learner filled in.
  const model10 = PaperBuildModel(await lesson(10))
  const exAnswers = {}
  for (const group of model10.groups.filter((entry) => entry.source === 'ex')) {
    for (const question of group.questions) {
      for (const key of core.PaperQuestionAnswerKeys(question)) {
        exAnswers[key] = question.kind === 'blank' ? "He's" : "Look at the man. He's very fat."
      }
    }
  }
  const basePaper = { version: 1, graded: true, answers: exAnswers, marks: {}, revealed: {}, ai: {} }
  const candidates = PaperAiCandidates(model10, basePaper)
  equal('ai candidates: every answered question', candidates.length, 18)
  check('ai candidates: textbook questions have no key', candidates.every((item) => item.reference === ''))
  check('ai candidates: carry prompt + answer + group', candidates.every((item) => item.prompt !== '' && item.answer !== '' && item.group !== ''))
  check('ai candidates: carry the printed example', candidates.some((item) => item.example !== ''))

  // Answer two grammar-workbook questions too: they are candidates as well, and
  // the answer-book key travels with them so teacher and book cannot disagree.
  const keyed = model10.groups
    .flatMap((group) => group.questions)
    .filter((question) => !question.isExample && PaperQuestionHasReference(question))
  const allAnswers = { ...exAnswers }
  for (const question of keyed.slice(0, 2)) {
    for (const key of core.PaperQuestionAnswerKeys(question)) allAnswers[key] = 'x'
  }
  const fullPaper = { ...basePaper, answers: allAnswers }
  const fullCandidates = PaperAiCandidates(model10, fullPaper)
  equal('ai candidates: includes answer-book questions', fullCandidates.length, 20)
  equal('ai candidates: sends the answer-book reference', fullCandidates.filter((item) => item.reference !== '').length, 2)
  equal('ai candidates: reference is the answer key', fullCandidates.find((item) => item.id === keyed[0].id).reference,
    keyed[0].referenceLines.map((line, index) => `第${index + 1}句：${line}`).join('；'))

  const oneMissing = { ...exAnswers }
  delete oneMissing[core.PaperQuestionAnswerKeys(model10.groups[0].questions[0])[0]]
  equal('ai candidates: unanswered excluded', PaperAiCandidates(model10, { answers: oneMissing }).length, 17)

  // Model reply → 16 correct, 1 close, 1 wrong; unknown ids are dropped.
  const ids = fullCandidates.map((item) => item.id)
  const rows = ids.slice(0, 16).map((id) => ({ id, verdict: 'correct', comment: '很好', answer: "He's" }))
  rows.push({ id: ids[16], verdict: 'close', comment: '差一点', answer: 'He is' })
  rows.push({ id: ids[17], verdict: 'wrong', comment: '主谓不一致', answer: 'She is' })
  rows.push({ id: 'made-up-id', verdict: 'wrong', comment: '编造', answer: 'x' })
  const applied = PaperApplyAi(model10, fullPaper, rows)
  equal('ai apply: turns on grading', applied.graded, true)
  equal('ai apply: stores verdict/comment/answer', applied.ai[ids[0]].comment, '很好')
  equal('ai apply: drops unknown ids', applied.ai['made-up-id'], undefined)
  equal('ai apply: keeps the answered rows', Object.keys(applied.ai).length, 18)
  equal('ai apply: does not write marks', Object.keys(applied.marks).length, 0)
  equal('ai applied count: counts accepted rows', PaperAiAppliedCount(model10, fullPaper, rows), 18)

  // Unified evaluation: AI verdicts drive the statuses and the score.
  const evaluation = PaperEvaluate(model10, applied)
  equal('ai evaluate: judged count', evaluation.aiJudged, 18)
  equal('ai evaluate: status from AI', evaluation.statuses[ids[0]], 'correct')
  equal('ai evaluate: close status', evaluation.statuses[ids[16]], 'close')
  equal('ai evaluate: wrong status', evaluation.statuses[ids[17]], 'wrong')
  equal('ai evaluate: answered keyed questions without an AI row stay pending', evaluation.statuses[keyed[0].id], 'open')
  equal('ai evaluate: unanswered keyed questions stay blank', evaluation.statuses[keyed[2].id], 'blank')
  equal('ai evaluate: status counts', evaluation.statusCounts.correct, 16)
  equal('ai evaluate: close count', evaluation.statusCounts.close, 1)
  equal('ai evaluate: wrong count', evaluation.statusCounts.wrong, 1)
  equal('ai evaluate: answered-but-unjudged are pending', evaluation.statusCounts.open, 2)
  equal('ai evaluate: unified score over the whole sheet', evaluation.aiScore, Math.round((16 / 38) * 100))
  equal('ai evaluate: total answerable', evaluation.total, 38)

  // A manual 判对/判错 overrides the teacher (and moves the unified score).
  const overridden = PaperEvaluate(model10, { ...applied, marks: { [ids[17]]: 'right' } })
  equal('ai evaluate: manual override wins', overridden.statuses[ids[17]], 'correct')
  equal('ai evaluate: override changes unified score', overridden.aiScore, Math.round((17 / 38) * 100))
  equal('ai evaluate: override is not double counted', overridden.statusCounts.correct, 17)

  // Editing an answer invalidates only that verdict (the component drops it on edit).
  const aiRows = PaperAiRows(applied)
  equal('ai rows: populated', Object.keys(aiRows).length, 18)
  const sanitized = PaperAiRows({ ai: { [ids[0]]: { verdict: 'maybe', comment: 'x' }, [ids[1]]: { verdict: 'close', comment: 'ok' } } })
  equal('ai rows: invalid verdict dropped', sanitized[ids[0]], undefined)
  equal('ai rows: valid verdict kept', sanitized[ids[1]].verdict, 'close')

  // Matching questions travel with the whole B column so the teacher can judge
  // the letter set instead of guessing from one word.
  const lesson41 = PaperBuildModel(await lesson(41))
  const matchQuestion = lesson41.groups.flatMap((group) => group.questions).find((question) => question.kind === 'match')
  check('ai candidates: matching question exists', matchQuestion !== undefined)
  const matchItem = PaperAiCandidates(lesson41, { answers: { [`${matchQuestion.id}#m`]: 'e' } })[0]
  check('ai candidates: matching prompt carries the B column', matchItem.example.includes('栏选项：') && matchItem.example.includes('e.'), matchItem.example)
  check('ai candidates: matching reference carries the answer key', matchItem.reference.includes('e.'), matchItem.reference)

  // Table tasks keep both the printed example and the table in the context.
  const model30 = PaperBuildModel(await lesson(30))
  const tableQuestion = model30.groups
    .flatMap((group) => group.questions)
    .find((question) => !question.isExample && !String(question.promptText ?? '').trim())
  check('ai candidates: generated-answer row exists', tableQuestion !== undefined)
  const tableItem = PaperAiCandidates(model30, { answers: { [core.PaperQuestionAnswerKeys(tableQuestion)[0]]: 'He is fat.' } })[0]
  check('ai candidates: generated-answer row gets a prompt', String(tableItem.prompt ?? '') !== '', tableItem.prompt)
  check('ai candidates: table task carries the table', String(tableItem.example ?? '').includes('表格：'), String(tableItem.example).slice(0, 120))

  // A stale row for a question the learner cleared must not score it.
  const cleared = { ...fullPaper }
  delete cleared.answers[core.PaperQuestionAnswerKeys(model10.groups[0].questions[0])[0]]
  equal('ai apply: stale row for a cleared answer is dropped', PaperApplyAi(model10, cleared, rows).ai[ids[0]], undefined)
}

// ---------------------------------------------------------------------------
// 6. Answered helper
// ---------------------------------------------------------------------------
{
  const parts = PaperBuildParts(['x'])
  const blank = { id: 'b1', isExample: false, kind: 'blank', blankCount: 2, parts, referenceSource: 'answer', referenceLines: ['x'] }
  equal('answered: partial blanks incomplete', PaperQuestionAnswered(blank, { 'b1#b0': 'a' }), false)
  equal('answered: all blanks complete', PaperQuestionAnswered(blank, { 'b1#b0': 'a', 'b1#b1': 'b' }), true)
}

// ---------------------------------------------------------------------------
// 6. Data hygiene / fill-in format scan (reported, not fatal)
// ---------------------------------------------------------------------------
{
  const BAD_PATTERNS = [/\[object/i, /\bundefined\b/, /\bNaN\b/, /Les\.cn/, /\uFFFD/, /\?\?\?/]
  const suspicious = []
  let blankItems = 0
  let answerRows = 0
  let multiBlank = 0
  let multiBlankCombined = 0
  let blankNoReference = 0
  for (const model of allModels) {
    for (const group of model.groups) {
      for (const question of group.questions) {
        if (question.isExample) continue
        if (question.kind === 'blank') {
          blankItems += 1
          const blankCount = Number(question.blankCount) || 0
          const hasReference = question.referenceSource !== 'none' && question.parts.length > 0
          if (blankCount >= 2) {
            multiBlank += 1
            const slotCount = Array.isArray(question.slotReference) ? question.slotReference.length : 0
            if (hasReference && slotCount !== blankCount) multiBlankCombined += 1
          }
          if (!hasReference) blankNoReference += 1
        }
        const text = [question.promptText, ...question.referenceLines].join('\n')
        if (BAD_PATTERNS.some((pattern) => pattern.test(text))) {
          suspicious.push({ lesson: model.lessonId, id: question.id })
        }
        answerRows += question.referenceLines.length
      }
    }
  }
  console.log(`hygiene: blank questions ${blankItems} (multi-blank ${multiBlank}, of which combined-answer ${multiBlankCombined}, no-reference ${blankNoReference}), reference lines ${answerRows}, suspicious text ${suspicious.length}`)
  if (suspicious.length > 0) console.log('  suspicious:', JSON.stringify(suspicious.slice(0, 10)))
  check('hygiene: no broken object/NaN text', suspicious.length === 0, `${suspicious.length} questions`)
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
if (failures.length > 0) {
  console.error(`\ntest-paper: ${failures.length} failure(s) out of ${checks} checks`)
  for (const failure of failures.slice(0, 40)) console.error(`  ✗ ${failure}`)
  if (failures.length > 40) console.error(`  … and ${failures.length - 40} more`)
  process.exit(1)
}
console.log(`test-paper: ok — ${checks} checks passed`)
