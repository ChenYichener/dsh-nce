// Layer: 03 API — depends on: nothing; uses the global `fetch`.
// Thin JSON-over-HTTP client for the host half of the plugin.

const API_BASE = '/dsh-nce/api'

// ---- API client -----------------------------------------------------------

async function api(operation, payload, options) {
  const response = await fetch(`${API_BASE}/${operation}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
    signal: options?.signal,
  })
  let data = null
  try {
    data = await response.json()
  } catch {
    data = null
  }
  if (!response.ok || data === null || data.ok !== true) {
    const message = data !== null && typeof data.error === 'string' && data.error !== ''
      ? data.error
      : `请求失败 (${response.status})`
    throw new Error(message)
  }
  return data
}
