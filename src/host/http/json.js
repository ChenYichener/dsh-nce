/**
 * JSON transport helpers: bounded request-body reader and the uniform response
 * envelope writer.
 *
 * @module host/http/json
 */

import { RouteError } from './errors.js'

export function writeJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

/**
 * Read and parse one JSON object body, bounded by `maxBodyBytes`.
 *
 * @param {object} req node request
 * @param {number} maxBodyBytes request-body cap (runtime config)
 */
export async function readJsonBody(req, maxBodyBytes) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > maxBodyBytes) throw new RouteError(413, '请求体过大')
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text === '') return {}
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new RouteError(400, '请求体不是合法 JSON')
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new RouteError(400, '请求体必须是 JSON 对象')
  }
  return parsed
}
