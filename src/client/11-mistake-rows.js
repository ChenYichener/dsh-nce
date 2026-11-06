// Layer: 11 mistake rows — depends on: 10-paper-engine (`Paper*` helpers only).
// Pure view-model: fetch the wrong / near-miss rows of a graded sheet so the
// 15-mistakes store can persist them. Lives in its own fragment to keep the
// engine under the fragment size budget.

/**
 * Wrong / near-miss questions of the current sheet — the rows the mistake
 * notebook persists. Pure: the caller (paper UI) stores them per lesson.
 *
 * Only questions the learner actually answered and that are judged 判错 / 近似
 * are returned; 未答/待批/判对的题不会进错题本。
 */
function PaperWrongRows(model, paper) {
  const stats = PaperEvaluate(model, paper)
  const aiRows = PaperAiRows(paper)
  const answers = paper !== null && typeof paper === 'object'
    && paper.answers !== null && typeof paper.answers === 'object' && !Array.isArray(paper.answers)
    ? paper.answers
    : {}
  const rows = []
  for (const group of model.groups) {
    for (const question of group.questions) {
      if (question.isExample) continue
      const status = stats.statuses[question.id]
      if (status !== 'wrong' && status !== 'close') continue
      const aiRow = aiRows[question.id]
      const answer = PaperQuestionAnswerKeys(question)
        .map((key) => String(answers[key] ?? '').trim())
        .filter((value) => value !== '')
        .join(' / ')
        .slice(0, 400)
      const reference = (PaperList(question.referenceLines).map((line) => String(line)).filter((line) => line !== '')).slice(0, 6)
      rows.push({
        questionId: question.id,
        num: `${question.num}${question.letterLabel !== undefined && question.letterLabel !== '' ? question.letterLabel : ''}`,
        group: String(group.label !== '' ? group.label : (group.titleZh !== '' ? group.titleZh : group.titleEn)).slice(0, 120),
        source: group.source === 'gwb' ? 'gwb' : 'ex',
        prompt: String(question.promptText ?? '').trim().slice(0, 800),
        answer,
        reference: reference.length > 0 ? reference : (aiRow !== undefined && aiRow.answer !== '' ? [aiRow.answer] : []),
        verdict: status,
        comment: aiRow !== undefined ? String(aiRow.comment ?? '') : '',
      })
    }
  }
  return rows
}

