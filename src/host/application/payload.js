/**
 * Request-payload accessors shared by the use cases.
 *
 * Kept in the application layer (not `http/`) because the use cases own the
 * meaning of every field; the transport layer only parses the JSON object.
 *
 * @module host/application/payload
 */

export function readString(payload, key) {
  const value = payload === null || typeof payload !== 'object' ? undefined : payload[key]
  return typeof value === 'string' ? value : ''
}
