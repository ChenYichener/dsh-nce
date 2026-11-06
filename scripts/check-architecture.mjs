/**
 * Architecture fitness checks for dsh-nce.
 *
 * This script is the executable form of `docs/PLUGIN-ARCH.md`: it fails when a
 * refactor breaks the layering contract, so the clean architecture cannot rot
 * silently.
 *
 * Host half (`src/host/`):
 *   - domain/*         may import only other domain modules (no `node:*`)
 *   - application/*    may import domain modules and `ports.js` only
 *   - infrastructure/* may import domain modules, `ports.js`, `config.js`, and node builtins
 *   - http/*           may import only other http modules (transport only)
 *   - config.js / ports.js are leaf modules; root `index.js` is the composition root
 *   - the import graph must be acyclic; the composition root must stay small and
 *     export `inject` + `apply`.
 *
 * Client half (`src/client/`):
 *   - fragments in `src/client/` and `src/client/generated/` are concatenated by
 *     `scripts/build-client.mjs` in ascending two-digit layer-prefix order
 *   - a fragment may only reference symbols declared by an earlier fragment
 *   - every declared symbol must be referenced somewhere (no dead declarations)
 *   - pure fragments must stay free of React/DOM/network/storage
 *   - generated fragments carry the GENERATED banner and are exempt from size limits
 *   - `99-entry.js` is the last fragment and registers the ModuleLoader factory
 *
 * Repository hygiene:
 *   - docs/README/scripts must not reference the old flat file layout
 *   - every `src/client/...`, `src/host/...` and `scripts/...` path mentioned in
 *     README/docs must exist
 *
 * Usage: node scripts/check-architecture.mjs
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const failures = []
let checks = 0

function fail(message) {
  failures.push(message)
}

function check(condition, message) {
  checks += 1
  if (!condition) fail(message)
}

async function readIfExists(file) {
  try {
    return await fs.readFile(file, 'utf8')
  } catch {
    return null
  }
}

async function listFiles(dir, filter) {
  let names
  try {
    names = await fs.readdir(dir)
  } catch {
    return []
  }
  return names.filter(filter).map((name) => path.join(dir, name)).sort()
}

// ---------------------------------------------------------------------------
// Source scanning: code-only view (comments, strings and regex bodies blanked;
// `${...}` template expressions kept as code). Used for symbol analysis.
// ---------------------------------------------------------------------------

const REGEX_PREFIX_CHARS = new Set(['(', '[', '{', ',', ';', ':', '=', '!', '&', '|', '?', '+', '-', '*', '%', '^', '~', '<', '>'])
const REGEX_PREFIX_KEYWORDS = /\b(?:return|typeof|instanceof|case|delete|void|in|of|new|do|else|yield|await)$/

function regexAllowedAt(code) {
  const trimmed = code.replace(/\s+$/, '')
  if (trimmed === '') return true
  const last = trimmed[trimmed.length - 1]
  if (REGEX_PREFIX_CHARS.has(last)) return true
  return REGEX_PREFIX_KEYWORDS.test(trimmed)
}

/**
 * Return a copy of `source` where comments, string contents and regex bodies are
 * blanked out (newlines preserved) so identifier scans do not match prose.
 */
function codeOnly(source) {
  const stack = [{ type: 'code', braceDepth: 0, templateExpr: false }]
  let out = ''
  let i = 0
  const push = (text) => { out += text }
  const blank = (text) => { push(text.replace(/[^\n]/g, ' ')) }
  while (i < source.length) {
    const frame = stack[stack.length - 1]
    const ch = source[i]
    if (frame.type === 'template') {
      if (ch === '\\') { blank(source.slice(i, i + 2)); i += 2; continue }
      if (ch === '`') { stack.pop(); blank('`'); i += 1; continue }
      if (ch === '$' && source[i + 1] === '{') {
        blank('${'); i += 2
        stack.push({ type: 'code', braceDepth: 0, templateExpr: true })
        continue
      }
      blank(ch); i += 1; continue
    }
    if (ch === '/' && source[i + 1] === '/') {
      let end = source.indexOf('\n', i)
      if (end === -1) end = source.length
      blank(source.slice(i, end)); i = end; continue
    }
    if (ch === '/' && source[i + 1] === '*') {
      const close = source.indexOf('*/', i + 2)
      const end = close === -1 ? source.length : close + 2
      blank(source.slice(i, end)); i = end; continue
    }
    if (ch === "'" || ch === '"') {
      let cursor = i + 1
      while (cursor < source.length) {
        const current = source[cursor]
        if (current === '\\') { cursor += 2; continue }
        if (current === ch) { cursor += 1; break }
        cursor += 1
      }
      blank(source.slice(i, cursor)); i = cursor; continue
    }
    if (ch === '`') { stack.push({ type: 'template' }); blank('`'); i += 1; continue }
    if (ch === '/') {
      if (!regexAllowedAt(out)) { push(ch); i += 1; continue }
      let cursor = i + 1
      let inClass = false
      let closed = false
      while (cursor < source.length) {
        const current = source[cursor]
        if (current === '\\') { cursor += 2; continue }
        if (current === '[') { inClass = true; cursor += 1; continue }
        if (current === ']') { inClass = false; cursor += 1; continue }
        if (current === '/' && !inClass) { cursor += 1; closed = true; break }
        if (current === '\n') break
        cursor += 1
      }
      if (!closed) { push(ch); i += 1; continue }
      blank(source.slice(i, cursor)); i = cursor; continue
    }
    if (ch === '{') {
      if (frame.templateExpr) frame.braceDepth += 1
      push(ch); i += 1; continue
    }
    if (ch === '}') {
      if (frame.templateExpr && frame.braceDepth === 0) {
        stack.pop(); push(' '); i += 1; continue
      }
      if (frame.templateExpr) frame.braceDepth -= 1
      push(ch); i += 1; continue
    }
    push(ch); i += 1
  }
  return out
}

// ---------------------------------------------------------------------------
// Client fragments
// ---------------------------------------------------------------------------

const CLIENT_DIR = path.join(root, 'src', 'client')
const CLIENT_GENERATED_DIR = path.join(CLIENT_DIR, 'generated')
const FRAGMENT_RE = /^(\d{2})-[\w.-]+\.js$/
/** Pure fragments: no React, no DOM, no network, no storage. */
const PURE_FRAGMENTS = ['01-domain.js', '10-paper-engine.js']
const PURE_FORBIDDEN = [
  [/\bdocument\b/, 'DOM (document)'],
  [/\bwindow\b/, 'DOM (window)'],
  [/\bglobalThis\s*\./, 'global object access'],
  [/\blocalStorage\b/, 'localStorage'],
  [/\bfetch\s*\(/, 'network (fetch)'],
  [/\brequire\s*\(/, 'module loading'],
  [/\bReact\b/, 'React'],
  [/\bFragment\b/, 'React (Fragment)'],
  [/\bh\s*\(/, 'React.createElement (h)'],
  [/\baddCss\b/, 'style registration (addCss)'],
  [/\buse(?:State|Effect|Memo|Callback|Context|Ref)\b/, 'React hooks'],
  [/\bapi\s*\(/, 'host API client'],
]
/** Cross-fragment contract: symbols that must keep existing. */
const REQUIRED_CLIENT_SYMBOLS = new Set([
  // platform / persistence / api / tts / data / store / ui
  'h', 'NS', 'PANEL_ID', 'PANEL_ORDER', 'CSS_PARTS', 'addCss', 'cx', 'clamp', 'pct',
  'dayKey', 'todayKey', 'normWord', 'errorMessage', 'sleep', 'isAbortError',
  'LESSON_STEPS', 'GRADES', 'DONE_STEP_KEYS', 'COPY', 'dueLabel',
  'lessonTitle', 'lessonStateOf', 'doneLessonCount', 'startedLessonIds', 'isWordUnlocked',
  'nextUnlockLessonId', 'dueWordCount', 'videoEmbedUrl', 'LessonArray',
  'PREFS_KEY', 'NAV_KEY', 'DEFAULT_PREFS', 'readNav', 'writeNav', 'readPrefs', 'writePrefs',
  'readScrollOffset', 'writeScrollOffset', 'readUiFlag', 'writeUiFlag', 'useScrollMemory',
  'API_BASE', 'api', 'playText', 'useSpeaking', 'useTtsInfo',
  'useRemote', 'useIndex', 'useWordbank', 'usePhonetics', 'useLesson',
  'NceProvider', 'useNce',
  'Icon', 'Btn', 'Chip', 'Section', 'Empty', 'Loading', 'ErrorBox', 'Stat', 'Bar',
  'Speaker', 'VoiceMenu', 'Badge',
  // data / lesson feature / pages / entry
  'BILIBILI_SOURCE', 'bilibiliEpisodes', 'bilibiliEmbedUrl', 'bilibiliPageUrl',
  'PaperBuildModel', 'PaperEvaluate', 'PaperAiRows', 'PaperWrongRows', 'PaperReadState', 'LessonExerciseTab',
  'mistakesList', 'mistakesRemove', 'mistakesSetExplain', 'mistakesSyncLesson', 'mistakesSyncPaper', 'mistakesClearLesson', 'useMistakeCount', 'MistakesPage',
  'LessonAnchorOf', 'LessonVideoSection', 'LessonTextSection', 'LessonWordsSection',
  'LessonGrammarSection', 'LessonHomeworkChecklist', 'LessonPage',
  'HomePage', 'WordsPage', 'ReviewPage', 'PhoneticsPage',
  'PAGES', 'NAV_ITEMS', 'Root', 'Shell', 'App', 'PanelErrorBoundary', 'NceIcon', 'inject', 'apply',
])
const MAX_HAND_WRITTEN_FRAGMENT_LINES = 1500

/** CSS selectors that intentionally override another fragment's rule (keep the reason here). */
const CSS_ORDER_ALLOWLIST = new Map([
  ['.nce-scroll', '30-paper-ui overrides the base scroll container for the paper layout (`display: block !important`)'],
])

/** `addCss(...)` blocks that actually run (a top-level `return` makes later code dead). */
function liveCssBlocks(source) {
  const lastReturn = [...source.matchAll(/^return\b[^\n]*$/gm)].pop()
  const live = lastReturn === undefined ? source : source.slice(0, lastReturn.index)
  const blocks = []
  for (const match of live.matchAll(/addCss\(`([\s\S]*?)`\)/g)) blocks.push(match[1])
  return blocks
}

/** Flat list of `{ selector, body, conditional }` rules; @media/@container/@print rules are conditional. */
function cssRules(css) {
  const rules = []
  const stack = []
  let buffer = ''
  let index = 0
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')
  while (index < clean.length) {
    const ch = clean[index]
    if (ch === '{') {
      const head = buffer.split(/\s+/).filter(Boolean).join(' ')
      buffer = ''
      if (head.startsWith('@')) {
        stack.push(head)
        index += 1
        continue
      }
      const close = clean.indexOf('}', index + 1)
      if (close === -1) break
      rules.push({ selector: head, body: clean.slice(index + 1, close), conditional: stack.length > 0 })
      index = close + 1
      continue
    }
    if (ch === '}') {
      stack.pop()
      buffer = ''
      index += 1
      continue
    }
    buffer += ch
    index += 1
  }
  return rules
}

/** Regex for bare references to `symbol`: not a property access, but spreads (`...SYM`) count. */
function symbolReference(symbol) {
  return new RegExp(`(?:(?<![.\\w$])|(?<=\\.\\.\\.))${symbol.replace(/[$]/g, '\\$')}(?![\\w$])`, 'g')
}

async function checkClient() {
  const entries = [
    ...await listFiles(CLIENT_DIR, (name) => FRAGMENT_RE.test(name)).then((files) => files.map((file) => ({
      file, rel: path.relative(CLIENT_DIR, file), generated: false, prefix: FRAGMENT_RE.exec(path.basename(file))[1],
    }))),
    ...await listFiles(CLIENT_GENERATED_DIR, (name) => FRAGMENT_RE.test(name)).then((files) => files.map((file) => ({
      file, rel: path.relative(CLIENT_DIR, file), generated: true, prefix: FRAGMENT_RE.exec(path.basename(file))[1],
    }))),
  ].sort((left, right) => left.prefix.localeCompare(right.prefix))

  check(entries.length > 0, 'client: no fragments found in src/client')
  const prefixes = new Map()
  for (const entry of entries) {
    const previous = prefixes.get(entry.prefix)
    check(previous === undefined, `client: duplicate layer prefix ${entry.prefix} in ${previous} and ${entry.rel}`)
    prefixes.set(entry.prefix, entry.rel)
  }
  check(entries[entries.length - 1]?.rel === '99-entry.js', 'client: 99-entry.js must be the last fragment')

  const declarations = new Map() // symbol -> fragment rel
  const sources = new Map() // rel -> { code, lines }
  for (const entry of entries) {
    const source = await fs.readFile(entry.file, 'utf8')
    const code = codeOnly(source)
    sources.set(entry.rel, { code, source, lines: source.split('\n').length, generated: entry.generated })
    check(!/^\s*(?:import|export)\s/m.test(source), `client: ${entry.rel} must not use import/export inside the factory scope`)
    if (entry.generated) {
      check(/\/\/ GENERATED by scripts\/[\w.-]+\.mjs/.test(source), `client: ${entry.rel} must carry a "GENERATED by scripts/..." banner`)
    } else {
      const header = /^\/\/ Layer: (\d{2})\b/m.exec(source)
      check(header !== null, `client: ${entry.rel} must start its header with "// Layer: NN ..."`)
      if (header !== null) {
        check(header[1] === entry.prefix, `client: ${entry.rel} header says layer ${header[1]} but its filename prefix is ${entry.prefix}`)
      }
      // Fragments are factory bodies: a top-level `return` must be the last statement,
      // otherwise the code after it is dead (the baseline bundle had such a dead CSS block).
      const lastReturn = [...source.matchAll(/^return\b[^\n]*$/gm)].pop()
      if (lastReturn !== undefined) {
        check(source.slice(lastReturn.index + lastReturn[0].length).trim() === '',
          `client: ${entry.rel} has dead code after its top-level return`)
      }
    }
    if (!entry.generated) {
      check(
        sources.get(entry.rel).lines <= MAX_HAND_WRITTEN_FRAGMENT_LINES,
        `client: ${entry.rel} is ${sources.get(entry.rel).lines} lines; split it below ${MAX_HAND_WRITTEN_FRAGMENT_LINES}`,
      )
    }
    const pattern = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|^(?:const|let|var)\s+([A-Za-z_$][\w$]*)|^class\s+([A-Za-z_$][\w$]*)/gm
    let match
    while ((match = pattern.exec(code)) !== null) {
      const symbol = match[1] ?? match[2] ?? match[3]
      const previous = declarations.get(symbol)
      check(previous === undefined, `client: ${symbol} declared twice (${previous}, ${entry.rel})`)
      if (previous === undefined) declarations.set(symbol, entry.rel)
    }
  }

  // Dependency direction: every reference must point at a same-or-earlier fragment.
  const order = new Map(entries.map((entry, index) => [entry.rel, index]))
  const referenceCount = new Map()
  for (const [rel, { code }] of sources) {
    for (const [symbol, owner] of declarations) {
      const hits = code.match(symbolReference(symbol))
      if (hits === null) continue
      referenceCount.set(symbol, (referenceCount.get(symbol) ?? 0) + hits.length)
      if (owner !== rel && order.get(owner) > order.get(rel)) {
        fail(`client: ${rel} references ${symbol} declared later in ${owner} (fragments must only use earlier symbols)`)
      }
    }
  }
  for (const [symbol, owner] of declarations) {
    // One hit is the declaration itself; every declaration needs at least one real use.
    check((referenceCount.get(symbol) ?? 0) > 1, `client: ${owner} declares ${symbol} but nothing references it (dead declaration)`)
  }
  for (const symbol of REQUIRED_CLIENT_SYMBOLS) {
    check(declarations.has(symbol), `client: required cross-fragment symbol ${symbol} is missing`)
  }
  for (const name of PURE_FRAGMENTS) {
    const entry = entries.find((item) => item.rel === name)
    check(entry !== undefined, `client: required pure fragment ${name} is missing`)
    if (entry === undefined) continue
    const { code } = sources.get(name)
    for (const [pattern, label] of PURE_FORBIDDEN) {
      check(!pattern.test(code), `client: pure fragment ${name} must not use ${label}`)
    }
  }
  // CSS: each selector has a single home. Duplicated definitions in different
  // fragments would make the cascade depend on fragment numbering (a silent
  // visual regression when files are reordered); conditional overrides are fine.
  const selectorRules = new Map()
  for (const [rel, { source }] of sources) {
    for (const block of liveCssBlocks(source)) {
      for (const rule of cssRules(block)) {
        if (rule.selector === '') continue
        if (selectorRules.has(rule.selector) === false) selectorRules.set(rule.selector, [])
        selectorRules.get(rule.selector).push({
          rel,
          body: rule.body.split(/\s+/).filter(Boolean).join(' '),
          conditional: rule.conditional,
        })
      }
    }
  }
  for (const [selector, occurrences] of selectorRules) {
    const bodies = new Set(occurrences.filter((item) => !item.conditional).map((item) => `${item.rel}::${item.body}`))
    if (bodies.size <= 1) continue
    const fragments = new Set(occurrences.filter((item) => !item.conditional).map((item) => item.rel))
    if (fragments.size <= 1) continue
    if (CSS_ORDER_ALLOWLIST.has(selector)) continue
    fail(`client: selector ${selector} is defined differently in ${[...fragments].join(' and ')}; keep one source (or allowlist the intentional override)`)
  }

  const entry = sources.get('99-entry.js')
  check(entry !== undefined && /const inject = \[/.test(entry.code), 'client: 99-entry.js must declare inject')
  check(entry !== undefined && /^function apply\s*\(/m.test(entry.code), 'client: 99-entry.js must declare apply()')
  // The ModuleLoader wrapper is emitted by the build script into the built artifact.
  const built = await readIfExists(path.join(root, 'client.js'))
  check(built !== null && built.includes('window.__ModuleLoader__.load('), 'client: client.js must be a ModuleLoader bundle (run npm run build)')
}

// ---------------------------------------------------------------------------
// Host modules
// ---------------------------------------------------------------------------

const HOST_DIR = path.join(root, 'src', 'host')
const HOST_ENTRY = path.join(root, 'index.js')
const MAX_COMPOSITION_ROOT_LINES = 300
const HOST_LAYERS = ['domain', 'application', 'infrastructure', 'http']
/** Allowed import targets per host layer (relative specifiers are resolved first). */
const HOST_IMPORT_RULES = {
  'domain': ['domain'],
  'application': ['domain', 'application', 'ports'],
  'infrastructure': ['domain', 'infrastructure', 'ports', 'config', 'node'],
  'http': ['http'],
  'config': ['node'],
  'ports': [],
  'root': ['domain', 'application', 'infrastructure', 'http', 'ports', 'config', 'node'],
}

function importsOf(source) {
  const specs = []
  // Imports may span lines (named import lists), so do not restrict the head to one line.
  const patterns = [
    /(?:^|\n)\s*import\s+(?:(?:[^'";]*?)\s+from\s+)?['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*export\s+(?:[^'";]*?)\s+from\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(source)) !== null) specs.push(match[1])
  }
  return specs
}

async function hostModules(dir) {
  const modules = []
  const walk = async (current) => {
    let entries
    try {
      entries = await fs.readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (entry.isFile() && entry.name.endsWith('.js')) modules.push(full)
    }
  }
  await walk(dir)
  return modules.sort()
}

function hostLayerOf(file) {
  if (path.resolve(file) === path.resolve(HOST_ENTRY)) return 'root'
  const relative = path.relative(HOST_DIR, file).split(path.sep).join('/')
  const [head] = relative.split('/')
  if (relative === 'ports.js') return 'ports'
  if (relative === 'config.js') return 'config'
  return HOST_LAYERS.includes(head) ? head : 'unknown'
}

function importTargetLayer(fromFile, specifier) {
  if (!specifier.startsWith('.')) {
    return /^node:/.test(specifier) ? 'node' : 'package'
  }
  const target = path.resolve(path.dirname(fromFile), specifier)
  const relativeToHost = path.relative(HOST_DIR, target).split(path.sep).join('/')
  if (relativeToHost.startsWith('..')) {
    // Root-level import (only the composition root may do that).
    return path.basename(target) === 'ports.js' ? 'ports' : 'outside'
  }
  if (relativeToHost === 'ports.js') return 'ports'
  if (relativeToHost === 'config.js') return 'config'
  const [head] = relativeToHost.split('/')
  if (!HOST_LAYERS.includes(head)) {
    return HOST_LAYERS.includes(path.dirname(relativeToHost)) ? path.dirname(relativeToHost) : 'unknown'
  }
  return head
}

async function checkHost() {
  const files = [HOST_ENTRY, ...await hostModules(HOST_DIR)]
  const graph = new Map()
  for (const file of files) {
    const source = await readIfExists(file)
    if (source === null) continue
    const relative = path.relative(root, file).split(path.sep).join('/')
    const layer = hostLayerOf(file)
    check(layer !== 'unknown', `host: ${relative} is outside the documented layers (domain/application/infrastructure/http/config/ports/root)`)
    if (layer === 'root') {
      check(source.split('\n').length <= MAX_COMPOSITION_ROOT_LINES, `host: index.js must stay a thin composition root (< ${MAX_COMPOSITION_ROOT_LINES} lines)`)
      check(/export const inject = \[/.test(source), 'host: index.js must export `inject`')
      check(/export function apply\s*\(/.test(source), 'host: index.js must export `apply`')
    }
    const imports = importsOf(source)
    graph.set(file, imports
      .filter((specifier) => specifier.startsWith('.'))
      .map((specifier) => path.resolve(path.dirname(file), specifier)))
    const allowed = HOST_IMPORT_RULES[layer] ?? []
    for (const specifier of imports) {
      const targetLayer = importTargetLayer(file, specifier)
      check(
        allowed.includes(targetLayer),
        `host: ${relative} (${layer}) may not import ${specifier} (${targetLayer}); allowed: ${allowed.length === 0 ? 'nothing' : allowed.join(', ')}`,
      )
    }
  }

  // Cycle detection on the relative-import graph.
  const state = new Map()
  const visit = (file, trail) => {
    const current = state.get(file)
    if (current === 'done') return
    if (current === 'active') {
      fail(`host: circular import ${[...trail, file].map((item) => path.relative(root, item)).join(' -> ')}`)
      return
    }
    state.set(file, 'active')
    for (const next of graph.get(file) ?? []) visit(next, [...trail, file])
    state.set(file, 'done')
  }
  for (const file of graph.keys()) visit(file, [])

  // Every relative import must land on a real module, and every module must be used.
  const hostFiles = new Set(graph.keys())
  const importers = new Map()
  for (const [file, targets] of graph) {
    for (const target of targets) {
      if (hostFiles.has(target) === false) continue
      if (importers.has(target) === false) importers.set(target, new Set())
      importers.get(target).add(file)
    }
  }
  for (const [file, targets] of graph) {
    for (const target of targets) {
      const relativeTarget = path.relative(root, target).split(path.sep).join('/')
      check(!target.startsWith(HOST_DIR) || hostFiles.has(target), `host: ${path.relative(root, file)} imports missing module ${relativeTarget}`)
    }
    if (file === HOST_ENTRY) continue
    const relative = path.relative(root, file).split(path.sep).join('/')
    if (relative === 'src/host/ports.js') continue // JSDoc-only ports file, never imported at runtime
    check((importers.get(file)?.size ?? 0) > 0, `host: ${relative} is never imported (orphan module)`)
  }
}

await checkClient()
await checkHost()

// ---------------------------------------------------------------------------
// Repository hygiene: docs and scripts describe the current layout only
// ---------------------------------------------------------------------------

const OLD_CLIENT_PATHS = [
  'src/client/00-core.js', 'src/client/10-home.js', 'src/client/12-plan-data.js',
  'src/client/20-plan.js', 'src/client/30-lesson.js', 'src/client/31-bilibili.js',
  'src/client/35-paper.js', 'src/client/36-flow.js', 'src/client/37-pdf.js',
  'src/client/40-words.js', 'src/client/50-review.js', 'src/client/60-phonetics.js',
]
const REFERENCE_FILES = [path.join(root, 'README.md'), path.join(root, 'README.zh.md')]
const docFiles = await listFiles(path.join(root, 'docs'), (name) => name.endsWith('.md'))
const scriptFiles = await listFiles(path.join(root, 'scripts'), (name) => name.endsWith('.mjs'))
for (const file of [...REFERENCE_FILES, ...docFiles, ...scriptFiles]) {
  const source = await readIfExists(file)
  if (source === null) continue
  const relative = path.relative(root, file).split(path.sep).join('/')
  // This script owns the list of historical paths; it must not flag itself.
  if (relative === 'scripts/check-architecture.mjs') continue
  for (const oldPath of OLD_CLIENT_PATHS) {
    // The full old path is what must disappear; the new generated/ path is fine.
    check(!source.includes(oldPath), `${relative} still references the old fragment ${oldPath}`)
  }
  const referenced = source.match(/(?:src\/(?:client|host)\/[\w./-]+?\.js|scripts\/[\w.-]+?\.mjs)/g) ?? []
  for (const reference of referenced) {
    check(
      await readIfExists(path.join(root, reference)) !== null,
      `${relative} references missing file ${reference}`,
    )
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

if (failures.length > 0) {
  console.error(`check-architecture: ${failures.length} failure(s) out of ${checks} checks`)
  for (const failure of failures.slice(0, 60)) console.error(`  ✗ ${failure}`)
  if (failures.length > 60) console.error(`  … and ${failures.length - 60} more`)
  process.exit(1)
}
console.log(`check-architecture: ok — ${checks} checks passed`)
