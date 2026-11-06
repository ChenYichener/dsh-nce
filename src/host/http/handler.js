/**
 * The single HTTP entry point for the plugin: trust fence, POST-only, bounded
 * body parsing, dispatch to the operation map and uniform error→status mapping.
 *
 * It knows no business operation: everything specific lives in the operations
 * the composition root wires in.
 *
 * @module host/http/handler
 */

import { RouteError } from './errors.js'
import { readJsonBody, writeJson } from './json.js'
import { isTrusted } from './security.js'

/**
 * @param {{
 *   operations: Record<string, (payload: object, context: { ctx: object, res: object }) => Promise<unknown>>,
 *   ctx: object,
 *   routePrefix: string,
 *   maxBodyBytes: number,
 * }} deps
 * @returns {(req: object, res: object) => Promise<void>} route handler
 */
export function createHandler({ operations, ctx, routePrefix, maxBodyBytes }) {
  return async function handle(req, res) {
    if (!isTrusted(req)) {
      writeJson(res, 403, { ok: false, error: 'forbidden' })
      return
    }
    if (req.method !== 'POST') {
      writeJson(res, 405, { ok: false, error: 'method not allowed' })
      return
    }
    const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
    const operation = pathname.startsWith(`${routePrefix}/`)
      ? pathname.slice(routePrefix.length + 1)
      : ''
    let payload
    try {
      payload = await readJsonBody(req, maxBodyBytes)
    } catch (error) {
      writeJson(res, error instanceof RouteError ? error.status : 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })
      return
    }
    try {
      const operationHandler = operations[operation]
      if (operationHandler === undefined) {
        writeJson(res, 404, { ok: false, error: 'unknown dsh-nce API path' })
        return
      }
      const result = await operationHandler(payload, { ctx, res })
      // A `undefined` result means the operation wrote the response itself
      // (e.g. raw WAV bytes for /tts).
      if (result !== undefined) writeJson(res, 200, result)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const status = error instanceof RouteError ? error.status : 500
      if (!res.writableEnded && !res.headersSent) writeJson(res, status, { ok: false, error: message })
    }
  }
}
