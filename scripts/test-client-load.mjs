/**
 * Client-bundle load + render smoke test.
 *
 * The browser half has no build step of its own and no DOM test environment,
 * so this harness executes the generated `client.js` in a `node:vm` sandbox:
 *
 *   1. the ModuleLoader factory registers and evaluates every fragment
 *      (catches top-level ReferenceError/SyntaxError, duplicate declarations,
 *      missing symbols used by top-level initialisers);
 *   2. `apply(ctx)` mounts the CSS + the two slots (catches a broken entry);
 *   3. a minimal React renderer renders the panel for every page with fake
 *      hooks (catches undefined symbols and typos on the render path).
 *
 * It is intentionally dependency-free and does not touch the network, disk
 * state or the DOM of a real browser. Run `node scripts/build-client.mjs` first
 * (or `npm test`, which rebuilds) so the bundle reflects the fragments.
 *
 * Usage: node scripts/test-client-load.mjs
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let checks = 0
let renderedComponents = 0

function ok(name, condition, detail) {
  checks += 1
  if (!condition) throw new Error(`${name}${detail === undefined ? '' : ` — ${detail}`}`)
}

// ---------------------------------------------------------------------------
// Fake browser + fake React (hooks are inert; render is a single pass)
// ---------------------------------------------------------------------------

const NAV_KEY = 'dsh-nce/nav/v1'
const PREFS_KEY = 'dsh-nce/prefs/v1'

function createStorage() {
  const values = new Map()
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
    _values: values,
  }
}

function createReact() {
  let contextSeq = 0
  const contexts = []
  const React = {
    createElement(type, props, ...children) { return { $$el: true, type, props: props ?? {}, children } },
    Fragment: Symbol('Fragment'),
    createContext(defaultValue) {
      const context = { $$context: true, id: ++contextSeq, defaultValue }
      context.Provider = { $$provider: true, context }
      contexts.push(context)
      return context
    },
    useContext(context) {
      for (let index = React.__providerStack.length - 1; index >= 0; index -= 1) {
        const frame = React.__providerStack[index]
        if (frame.context === context) return frame.value
      }
      return context?.defaultValue ?? null
    },
    useState(initial) { return [typeof initial === 'function' ? initial() : initial, () => {}] },
    useEffect() {},
    useLayoutEffect() {},
    useMemo(factory) { return factory() },
    useCallback(callback) { return callback },
    useRef() { return { current: null } },
    Component: class Component {
      constructor(props) { this.props = props }
      setState() {}
      forceUpdate() {}
    },
    memo(component) { return component },
    __providerStack: contexts ? [] : [],
    __contexts: contexts,
  }
  return React
}

const React = createReact()

/** One A4 of the real page, only good enough to evaluate component bodies. */
const renderedTexts = []
function renderTree(node, depth = 0) {
  if (depth > 200) throw new Error('render recursion deeper than 200 levels')
  if (node === null || node === undefined || node === false || node === true) return
  if (typeof node === 'string' || typeof node === 'number') {
    renderedTexts.push(String(node))
    return
  }
  if (Array.isArray(node)) {
    for (const child of node) renderTree(child, depth + 1)
    return
  }
  if (node.$$el !== true) return
  const { type, props, children } = node
  if (type !== null && typeof type === 'object' && type.$$provider === true) {
    React.__providerStack.push({ context: type.context, value: props.value })
    renderTree(children, depth + 1)
    React.__providerStack.pop()
    return
  }
  if (typeof type === 'function') {
    renderedComponents += 1
    if (type.prototype !== undefined && typeof type.prototype.render === 'function') {
      const instance = new type({ ...props, children: children.length === 1 ? children[0] : children })
      return renderTree(instance.render(), depth + 1)
    }
    return renderTree(type({ ...props, children: children.length === 1 ? children[0] : children }), depth + 1)
  }
  for (const child of children) renderTree(child, depth + 1)
}

function createDocument() {
  const styleTags = []
  return {
    styleTags,
    createElement(tag) { return { tag, dataset: {}, textContent: '', remove() {} } },
    head: { appendChild(node) { styleTags.push(node) } },
    addEventListener() {},
    removeEventListener() {},
    querySelector() { return null },
    body: { appendChild() {} },
  }
}

// ---------------------------------------------------------------------------
// Sandbox + bundle evaluation
// ---------------------------------------------------------------------------

const bundle = await readFile(path.join(root, 'client.js'), 'utf8')
ok('client.js is a ModuleLoader bundle', bundle.includes('window.__ModuleLoader__.load('))

let capturedFactory = null
let capturedId = null
const document = createDocument()
const window = {
  __ModuleLoader__: {
    load(config) {
      capturedFactory = config.factory
      capturedId = config.id
    },
  },
  addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
  document,
}
const sandbox = {
  window,
  document,
  console,
  localStorage: createStorage(),
  navigator: { language: 'zh-CN' },
  location: { href: 'http://127.0.0.1:50722/', pathname: '/' },
  fetch: () => new Promise(() => {}), // page render must not need real IO
  setTimeout: () => 0,
  clearTimeout: () => {},
  queueMicrotask: () => {},
  requestAnimationFrame: () => 0,
  cancelAnimationFrame: () => {},
  Event: class Event { constructor(type) { this.type = type } },
  AbortController,
  URL,
  URLSearchParams,
  TextEncoder,
  TextDecoder,
  Blob: class Blob {},
  Image: class Image {},
  FileReader: class FileReader {},
  performance: { now: () => 0 },
  crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000000' },
  structuredClone: (value) => JSON.parse(JSON.stringify(value)),
  btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
  atob: (value) => Buffer.from(value, 'base64').toString('binary'),
}
const context = vm.createContext(sandbox)
vm.runInContext(bundle, context, { filename: 'client.js' })
ok('ModuleLoader received the dsh-nce factory', capturedId === 'dsh-nce' && typeof capturedFactory === 'function')

const requireStub = (name) => {
  if (name === 'react') return React
  throw new Error(`unexpected client module: ${name}`)
}

// ---------------------------------------------------------------------------
// 1. Factory evaluation + apply() wiring
// ---------------------------------------------------------------------------

const api = capturedFactory(requireStub)
ok('factory returns { inject, apply }', api !== null && typeof api === 'object' && typeof api.apply === 'function')
ok('inject declares the slots service', Array.isArray(api.inject) && api.inject.includes('slots'))

function mount() {
  const registrations = []
  const effects = []
  const ctx = {
    slots: {
      inject(name, callback) { registrations.push({ kind: 'inject', name }); return callback() },
      register(config, component) {
        registrations.push({ kind: 'register', name: config.name, config, component })
        return () => {}
      },
    },
    effect(callback, label) {
      const cleanup = callback()
      effects.push({ label, cleanup })
      return () => {}
    },
  }
  api.apply(ctx)
  return { registrations, effects }
}

const firstMount = mount()
const registeredSlots = firstMount.registrations.filter((item) => item.kind === 'register').map((item) => item.name)
ok('apply registers the main panel slot', registeredSlots.includes('main'), JSON.stringify(registeredSlots))
ok('apply registers the sidebar entry slot', registeredSlots.includes('sidebar.panellist'), JSON.stringify(registeredSlots))
ok('apply injects the stylesheet once', document.styleTags.length === 1, `${document.styleTags.length} style tags`)
for (const effect of firstMount.effects) if (typeof effect.cleanup === 'function') effect.cleanup()
ok('all registered components are functions', firstMount.registrations
  .filter((item) => item.kind === 'register')
  .every((item) => typeof item.component === 'function'))

// ---------------------------------------------------------------------------
// 2. Render every page once with the fake React (render-path smoke)
// ---------------------------------------------------------------------------

const scenarios = [
  { name: '课程首页', nav: { page: 'home', lessonId: 0, tab: '' } },
  { name: '单课（整课）', nav: { page: 'home', lessonId: 1, tab: '' } },
  { name: '单课（练习锚点）', nav: { page: 'home', lessonId: 1, tab: 'exercise' } },
  { name: '记忆卡', nav: { page: 'words', lessonId: 0, tab: '' } },
  { name: '错题本', nav: { page: 'mistakes', lessonId: 0, tab: '' } },
  { name: '复习', nav: { page: 'review', lessonId: 0, tab: '' } },
  { name: '音标', nav: { page: 'phonetics', lessonId: 0, tab: '' } },
]

for (const scenario of scenarios) {
  const factory = capturedFactory(requireStub)
  const mountResult = (() => {
    const registrations = []
    const ctx = {
      slots: {
        inject(name, callback) { return callback() },
        register(config, component) {
          registrations.push({ name: config.name, component })
          return () => {}
        },
      },
      effect(callback) { callback(); return () => {} },
    }
    factory.apply(ctx)
    return registrations
  })()
  const main = mountResult.find((item) => item.name === 'main')
  ok(`main slot component exists (${scenario.name})`, main !== undefined)
  // Set the page before rendering so the store's initial nav matches the scenario.
  sandbox.localStorage.clear()
  sandbox.localStorage.setItem(NAV_KEY, JSON.stringify(scenario.nav))
  sandbox.localStorage.setItem(PREFS_KEY, JSON.stringify({}))
  const componentsBefore = renderedComponents
  renderedTexts.length = 0
  let error = null
  try {
    renderTree({ $$el: true, type: main.component, props: {}, children: [] })
  } catch (failure) {
    error = failure
  }
  ok(`render ${scenario.name} does not throw`, error === null, error?.stack ?? String(error))
  ok(`render ${scenario.name} evaluates components`, renderedComponents > componentsBefore,
    `${renderedComponents - componentsBefore} components`)
}

ok('client renders every page without an error boundary hit', renderedComponents > scenarios.length, `${renderedComponents} components`)
const navLabels = ['课程', '记忆卡', '错题本', '音标&自然拼读']
ok('panel nav has the three current destinations', navLabels.every((label) => renderedTexts.includes(label)), renderedTexts.join('|'))
ok('removed 计划 nav entry is gone', !renderedTexts.includes('计划'))
ok('语音 is no longer used as a nav label', !renderedTexts.includes('语音'))
console.log(`test-client-load: ok — ${checks} checks passed, ${renderedComponents} component renders`)
