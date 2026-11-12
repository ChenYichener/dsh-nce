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

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

/** Preferred English voices, most natural first; only used when installed. */
const VOICE_PREFERENCE = ['Samantha', 'Ava', 'Karen', 'Allison', 'Susan', 'Tessa', 'Fiona', 'Moira', 'Serena', 'Daniel', 'Alex']

const require = createRequire(import.meta.url)

/**
 * True when `dir` holds a built lesson index, not just an empty directory.
 *
 * @param {string} dir candidate data directory
 * @returns {boolean} whether the directory is usable
 */
function hasLessonIndex(dir) {
  try {
    return fs.statSync(path.join(dir, 'index.json')).isFile()
  } catch {
    return false
  }
}

/**
 * Resolve the lesson dataset, keeping the code package free of textbook data.
 *
 * Order: explicit `DSH_NCE_DATA_DIR`, then a data directory bundled next to the
 * plugin (local builds), then the separate optional `dsh-nce-data` package that
 * ships the dataset on its own release channel.
 *
 * @param {string} pluginDir directory of this plugin package
 * @returns {string} path of the directory holding `index.json`
 */
function resolveDataDir(pluginDir) {
  const fromEnv = process.env.DSH_NCE_DATA_DIR
  if (fromEnv && hasLessonIndex(fromEnv)) return path.resolve(fromEnv)

  const bundled = path.join(pluginDir, 'data')
  if (hasLessonIndex(bundled)) return bundled

  try {
    const dataPkg = path.dirname(require.resolve('dsh-nce-data/package.json'))
    const fromPackage = path.join(dataPkg, 'data')
    if (hasLessonIndex(fromPackage)) return fromPackage
  } catch {
    /* optional package absent: the panel reports an empty course list instead */
  }

  return bundled
}

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
  const dataDir = resolveDataDir(pluginDir)
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
