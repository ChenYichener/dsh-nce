/**
 * Runtime configuration for the dsh-nce host half.
 *
 * Every path and limit the adapters need lives here so the rest of the host
 * code never derives one from `import.meta.url` itself. Values are fixed when
 * the composition root calls `createConfig()`, exactly like the original
 * module-level constants.
 *
 * @module host/config
 */

import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Preferred English voices, most natural first; only used when installed. */
const VOICE_PREFERENCE = ['Samantha', 'Ava', 'Karen', 'Allison', 'Susan', 'Tessa', 'Fiona', 'Moira', 'Serena', 'Daniel', 'Alex']

/**
 * Build the runtime configuration object.
 *
 * @returns {{
 *   pluginDir: string,
 *   dataDir: string,
 *   stateDir: string,
 *   progressFile: string,
 *   dbFile: string,
 *   translateHistoryFile: string,
 *   ttsCacheDir: string,
 *   routePrefix: string,
 *   maxBodyBytes: number,
 *   sayBin: string,
 *   voicePreference: string[],
 * }} runtime config
 */
export function createConfig() {
  const pluginDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
  const dataDir = path.join(pluginDir, 'data')
  const stateDir = path.join(os.homedir(), '.dsh', 'dsh-nce')
  return {
    pluginDir,
    dataDir,
    stateDir,
    progressFile: path.join(stateDir, 'progress.json'),
    dbFile: path.join(stateDir, 'nce.sqlite'),
    /** Translation plugin history (read-only); used to build sentence cards. */
    translateHistoryFile: path.join(os.homedir(), '.dsh', 'dsh-translate', 'history.json'),
    ttsCacheDir: path.join(stateDir, 'tts-cache'),
    routePrefix: '/dsh-nce/api',
    /** One JSON request body bound (defense against unbounded reads). */
    maxBodyBytes: 1 << 16,
    sayBin: '/usr/bin/say',
    voicePreference: VOICE_PREFERENCE,
  }
}
