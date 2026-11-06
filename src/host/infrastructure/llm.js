/**
 * Bridge to the profile's default model: resolves the current selection,
 * drains model streams into text, and keeps the last failed grading output on
 * disk for diagnosis.
 *
 * @module host/infrastructure/llm
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

/** Resolve the default model; '' when the host does not expose one. */
export function currentSelection(ctx) {
  let selection
  try {
    selection = ctx.get('agentDefaultModel')?.currentSelection?.()
  } catch {
    selection = undefined
  }
  return {
    provider: typeof selection?.provider === 'string' ? selection.provider : '',
    model: typeof selection?.model === 'string' ? selection.model : '',
  }
}

/** First line-length excerpt of model output for error messages. */
export function aiSnippet(text) {
  const compact = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (compact === '') return '空输出'
  return compact.length > 160 ? `${compact.slice(0, 160)}…` : compact
}

/**
 * Drain one LLM stream into plain text (reasoning/tool chunks are ignored) and
 * keep the finish reason: `length` / `error` / `tool-calls` explain most empty
 * or truncated grading replies.
 */
export async function collectLlmText(llm, options) {
  let output = ''
  let finishReason = ''
  const stream = llm.stream(options)
  for await (const chunk of stream) {
    if (chunk.type === 'text-delta') output += chunk.text
    else if (chunk.type === 'finish') {
      finishReason = String(chunk.reason ?? '')
      break
    }
  }
  return { text: output, finishReason }
}

/** Keep the last failed model output on disk so a broken parse can be inspected. */
export async function saveAiGradeFailure(debugFile, lessonId, items, output, repairOutput, finishReason, repairFinishReason) {
  try {
    await fs.mkdir(path.dirname(debugFile), { recursive: true })
    await fs.writeFile(debugFile, JSON.stringify({
      at: new Date().toISOString(),
      lessonId,
      itemIds: items.map((item) => item.id),
      finishReason,
      repairFinishReason,
      outputLength: String(output ?? '').length,
      output,
      repairOutput,
    }, null, 2))
  } catch {
    // Diagnostics are best effort; never mask the API error.
  }
}

/**
 * @param {{ stateDir: string }} config runtime config from `host/config.js`
 * @returns {import('../ports.js').LlmGateway} model gateway (ctx is the opaque host context)
 */
export function createLlmGateway(config) {
  const debugFile = path.join(config.stateDir, 'ai-grade-last-failure.json')

  function isAvailable(ctx) {
    return ctx.get('llm') !== undefined
  }

  function stream(ctx, options) {
    return ctx.get('llm').stream(options)
  }

  function collect(ctx, options) {
    return collectLlmText(ctx.get('llm'), options)
  }

  function saveFailure(lessonId, items, output, repairOutput, finishReason, repairFinishReason) {
    return saveAiGradeFailure(debugFile, lessonId, items, output, repairOutput, finishReason, repairFinishReason)
  }

  return {
    debugFile,
    isAvailable,
    currentSelection,
    stream,
    collect,
    saveFailure,
    snippet: aiSnippet,
  }
}
