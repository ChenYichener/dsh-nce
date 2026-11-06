/**
 * 错题讲解 use case: one question per click, plain-text teacher explanation.
 *
 * The browser sends the mistake context (question / student answer / reference
 * / previous comment); the profile's default model answers in Chinese. Results
 * are cached in memory so reopening the same explanation does not re-bill.
 *
 * @module host/application/explain
 */

import {
  aiExplainCleanText,
  aiExplainSystemPrompt,
  aiExplainUserPrompt,
  cleanExplainPayload,
} from '../domain/ai-explain.js'

const EXPLAIN_TIMEOUT_MS = 45_000
const EXPLAIN_CACHE_TTL_MS = 10 * 60_000
const EXPLAIN_CACHE_MAX = 60

/**
 * @param {{
 *   llmGateway: import('../ports.js').LlmGateway,
 *   RouteError: new (status: number, message: string) => Error,
 * }} deps
 */
export function createExplainOperations({ llmGateway, RouteError }) {
  /** content key -> { at, text }; small LRU-ish map, oldest dropped past the cap. */
  const cache = new Map()

  async function llmExplain(ctx, input) {
    const available = llmGateway.isAvailable(ctx)
    const { provider, model } = llmGateway.currentSelection(ctx)
    if (!available || provider === '' || model === '') {
      throw new RouteError(503, '当前 profile 没有可用的默认模型，无法生成 AI 讲解')
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), EXPLAIN_TIMEOUT_MS)
    try {
      const collected = await llmGateway.collect(ctx, {
        provider,
        model,
        reasoningEffort: 'off',
        temperature: 0.2,
        signal: controller.signal,
        system: aiExplainSystemPrompt(),
        messages: [{ role: 'user', content: [{ type: 'text', text: aiExplainUserPrompt(input) }] }],
        maxTokens: 900,
      })
      const text = aiExplainCleanText(collected.text)
      if (text === null) {
        throw new RouteError(502, `AI 没有返回讲解内容（finish: ${collected.finishReason || 'unknown'}），请重试`)
      }
      return { model, text }
    } catch (error) {
      if (error instanceof RouteError) throw error
      if (controller.signal.aborted) throw new RouteError(504, 'AI 讲解超时了，请重试')
      throw new RouteError(502, `AI 讲解失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    async explain(payload, { ctx }) {
      const input = cleanExplainPayload(payload, (status, message) => new RouteError(status, message))
      const cacheKey = JSON.stringify(input)
      const cached = cache.get(cacheKey)
      if (cached !== undefined && Date.now() - cached.at < EXPLAIN_CACHE_TTL_MS) {
        return { ok: true, source: 'ai', model: cached.model, text: cached.text, cached: true }
      }
      const result = await llmExplain(ctx, input)
      cache.set(cacheKey, { at: Date.now(), model: result.model, text: result.text })
      while (cache.size > EXPLAIN_CACHE_MAX) {
        const oldest = cache.keys().next().value
        cache.delete(oldest)
      }
      return { ok: true, source: 'ai', ...result }
    },
  }
}
