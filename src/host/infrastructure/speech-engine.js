/**
 * Local text-to-speech adapter: macOS `say`.
 *
 * Voice detection and rendered WAVs are cached for the lifetime of the process;
 * rendered files live under `ttsCacheDir` so repeated playback is free.
 *
 * @module host/infrastructure/speech-engine
 */

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/**
 * @param {{ sayBin: string, voicePreference: string[], ttsCacheDir: string }} config runtime config from `host/config.js`
 * @returns {import('../ports.js').SpeechEngine} speech adapter
 */
export function createSpeechEngine(config) {
  const sayBin = config.sayBin
  const voicePreference = config.voicePreference
  const ttsCacheDir = config.ttsCacheDir

  let sayAvailable
  async function detectSay() {
    if (sayAvailable !== undefined) return sayAvailable
    try {
      await fs.access(sayBin)
      sayAvailable = true
    } catch {
      sayAvailable = false
    }
    return sayAvailable
  }

  let voiceCache
  async function pickVoice() {
    if (voiceCache !== undefined) return voiceCache
    voiceCache = ''
    try {
      const { stdout } = await execFileAsync(sayBin, ['-v', '?'], { timeout: 8000, maxBuffer: 1 << 20 })
      const names = []
      for (const line of String(stdout).split('\n')) {
        const match = /^(.+?)\s{2,}en[_-][A-Z]{2}\s+#/.exec(line)
        if (match !== null) names.push(match[1].trim())
      }
      for (const preferred of voicePreference) {
        const found = names.find((name) => name.toLowerCase() === preferred.toLowerCase())
        if (found !== undefined) {
          voiceCache = found
          break
        }
      }
      if (voiceCache === '') voiceCache = names[0] ?? ''
    } catch {
      // Fall back to the system default voice.
    }
    return voiceCache
  }

  async function renderSpeech(text, rate) {
    await fs.mkdir(ttsCacheDir, { recursive: true })
    const voice = await pickVoice()
    const key = createHash('sha256').update(`${voice}\u0000${rate}\u0000${text}`).digest('hex').slice(0, 32)
    const file = path.join(ttsCacheDir, `${key}.wav`)
    try {
      const stat = await fs.stat(file)
      if (stat.size > 1024) return file
    } catch {
      // Render it below.
    }
    const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp.wav`
    const args = []
    if (voice !== '') args.push('-v', voice)
    args.push('-r', String(rate), '-o', tmp, '--data-format=LEF32@22050', text)
    try {
      await execFileAsync(sayBin, args, { timeout: 15000, maxBuffer: 1 << 20 })
      await fs.rename(tmp, file)
    } catch (error) {
      await fs.rm(tmp, { force: true })
      throw error
    }
    return file
  }

  /** Render (or reuse a cached) WAV and return its bytes, ready for the HTTP response. */
  async function synthesize(text, rate) {
    const file = await renderSpeech(text, rate)
    return fs.readFile(file)
  }

  return { available: detectSay, synthesize }
}
