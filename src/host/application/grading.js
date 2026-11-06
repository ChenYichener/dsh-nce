/**
 * Exercise-paper grading use case: "AI teacher grades the whole sheet".
 *
 * `批改整卷` sends every answered question (textbook written exercises and
 * grammar-workbook questions) to the profile's default model: the client sends
 * the prompt, the printed example, the answer-book key (when the question has
 * one) and the learner's answer, and the model returns one verdict
 * (correct/close/wrong) plus a short comment and a reference wording per
 * question. That single channel produces the paper's unified score; the
 * deterministic grader in the browser is only the offline fallback.
 *
 * The LLM is behind the injected `LlmGateway`; the deterministic parsing lives
 * in `domain/ai-grade.js`.
 *
 * @module host/application/grading
 */

import {
  cleanAiGradeItems,
  parseAiGrades,
  aiGradeSystemPrompt,
  aiRepairSystemPrompt,
  aiGradeUserPrompt,
} from '../domain/ai-grade.js'

const AI_GRADE_TIMEOUT_MS = 90_000
const AI_GRADE_CACHE_TTL_MS = 10 * 60_000

/**
 * @param {{
 *   dataRepository: import('../ports.js').DataRepository,
 *   llmGateway: import('../ports.js').LlmGateway,
 *   RouteError: new (status: number, message: string) => Error,
 * }} deps
 */
export function createGradingOperations({ dataRepository, llmGateway, RouteError }) {
  /** Last result only; a repeated click on the same paper should not re-bill. */
  let aiGradeCache = { key: '', at: 0, payload: null }

  /** Ask the profile's default model to grade one batch of answered questions. */
  async function llmGradePaper(ctx, lesson, items) {
    const available = llmGateway.isAvailable(ctx)
    const { provider, model } = llmGateway.currentSelection(ctx)
    if (!available || provider === '' || model === '') {
      throw new RouteError(503, '当前 profile 没有可用的默认模型，无法让 AI 老师批改（先用「判对 / 判错」自评）')
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), AI_GRADE_TIMEOUT_MS)
    const baseOptions = { provider, model, reasoningEffort: 'off', temperature: 0, signal: controller.signal }
    const messages = [{ role: 'user', content: [{ type: 'text', text: aiGradeUserPrompt(lesson, items) }] }]
    try {
      const first = await llmGateway.collect(ctx, {
        ...baseOptions,
        system: aiGradeSystemPrompt(),
        messages,
        maxTokens: 6000,
      })
      const output = first.text
      if (String(output).trim() === '') {
        // Tool-call / length / error finishes produce no text at all.
        await llmGateway.saveFailure(Number(lesson?.id) || 0, items, output, '', first.finishReason, '')
        throw new RouteError(502, `AI 没有返回批改内容（finish: ${first.finishReason || 'unknown'}），请重试`)
      }
      const graded = parseAiGrades(output, items)
      if (graded !== null) return { model, items: graded }

      // One repair round trip: a model that wrapped/truncated its JSON usually
      // manages a clean "one JSON object per line" conversion.
      const repairPrompt = [
        '下面是你上次批改作业的原始输出，请把它转换成规定的行分隔 JSON。',
        '只输出 JSON 行，不要解释：',
        '--- 原始输出开始 ---',
        String(output ?? '').slice(0, 6000),
        '--- 原始输出结束 ---',
      ].join('\n')
      let repairOutput = ''
      let repairFinishReason = ''
      try {
        const repair = await llmGateway.collect(ctx, {
          ...baseOptions,
          system: aiRepairSystemPrompt(),
          messages: [{ role: 'user', content: [{ type: 'text', text: repairPrompt }] }],
          maxTokens: 4000,
        })
        repairOutput = repair.text
        repairFinishReason = repair.finishReason
      } catch (repairError) {
        if (controller.signal.aborted) throw repairError
      }
      const repaired = parseAiGrades(repairOutput, items)
      if (repaired !== null) return { model, items: repaired, repaired: true }

      await llmGateway.saveFailure(Number(lesson?.id) || 0, items, output, repairOutput, first.finishReason, repairFinishReason)
      console.error('[dsh-nce] AI grading parse failed; raw output saved to', llmGateway.debugFile)
      throw new RouteError(502, `AI 返回的批改结果无法解析（模型输出开头：${llmGateway.snippet(output)}），请重试`)
    } catch (error) {
      if (error instanceof RouteError) throw error
      if (controller.signal.aborted) throw new RouteError(504, 'AI 批改超时了，请重试（题多时可以少选几题）')
      throw new RouteError(502, `AI 批改失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    async paperGrade(payload, { ctx }) {
      const lessonId = Number(payload?.lessonId)
      if (!Number.isInteger(lessonId) || lessonId < 1 || lessonId > 144) throw new RouteError(400, '课程 id 不合法')
      const items = cleanAiGradeItems(payload?.items, (status, message) => new RouteError(status, message))
      // The cache key only needs to identify the request; it stays in memory.
      const cacheKey = JSON.stringify([lessonId, items])
      if (aiGradeCache.key === cacheKey && Date.now() - aiGradeCache.at < AI_GRADE_CACHE_TTL_MS) {
        return { ok: true, ...aiGradeCache.payload, cached: true }
      }
      const lesson = await dataRepository.loadLesson(lessonId)
      const result = await llmGradePaper(ctx, lesson, items)
      aiGradeCache = { key: cacheKey, at: Date.now(), payload: result }
      return { ok: true, ...result }
    },
  }
}
