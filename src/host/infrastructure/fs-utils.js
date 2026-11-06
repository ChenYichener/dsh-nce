/**
 * Small JSON file helpers shared by the file-backed repositories.
 *
 * @module host/infrastructure/fs-utils
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

export async function readJsonFile(file) {
  const text = await fs.readFile(file, 'utf8')
  return JSON.parse(text)
}

export async function writeAtomic(file, text) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`
  await fs.writeFile(tmp, text, 'utf8')
  await fs.rename(tmp, file)
}

export function safeJson(text, fallback) {
  try {
    const value = JSON.parse(text)
    return value === null || value === undefined ? fallback : value
  } catch {
    return fallback
  }
}
