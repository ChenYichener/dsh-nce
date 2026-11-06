/**
 * Read-aloud use case: validate the text, clamp the rate and stream the raw WAV
 * bytes through the injected speech engine.
 *
 * @module host/application/speech
 */

import { MAX_TEXT, SAY_DEFAULT_RATE, SAY_MAX_RATE, SAY_MIN_RATE } from '../domain/constants.js'
import { readString } from './payload.js'

/**
 * @param {{
 *   speechEngine: import('../ports.js').SpeechEngine,
 *   RouteError: new (status: number, message: string) => Error,
 * }} deps
 */
export function createSpeechOperations({ speechEngine, RouteError }) {
  return {
    async tts(payload, { res }) {
      const text = readString(payload, 'text').trim()
      if (text === '') throw new RouteError(400, '缺少要朗读的文本')
      if (text.length > MAX_TEXT) throw new RouteError(400, `朗读文本最多 ${MAX_TEXT} 字`)
      if (!(await speechEngine.available())) throw new RouteError(503, '当前系统不支持本机语音合成')
      const rawRate = Number(payload.rate)
      const rate = Number.isFinite(rawRate)
        ? Math.min(SAY_MAX_RATE, Math.max(SAY_MIN_RATE, Math.round(rawRate)))
        : SAY_DEFAULT_RATE
      const buffer = await speechEngine.synthesize(text, rate)
      res.writeHead(200, {
        'content-type': 'audio/wav',
        'content-length': buffer.length,
        'cache-control': 'no-store',
      })
      res.end(buffer)
    },
  }
}
