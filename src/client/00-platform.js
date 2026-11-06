// Layer: 00 runtime/platform — depends on: nothing; `require('react')` comes from the host module table.
// React bindings, panel identity, the shared CSS registry and the pure utilities every fragment uses.

const React = require('react')
const h = React.createElement
const Fragment = React.Fragment

const { useState, useEffect, useMemo, useCallback, useContext, useRef } = React

const NS = 'dsh-nce'
const PANEL_ID = 'nce'
/** Sits below "翻译" (22) in the sidebar. */
const PANEL_ORDER = 23

/** Styles contributed by every fragment; the entry joins them into one tag. */
const CSS_PARTS = []
function addCss(text) {
  if (typeof text === 'string' && text.trim() !== '') CSS_PARTS.push(text)
}

// ---- tiny utilities -------------------------------------------------------

function cx() {
  const names = []
  for (let index = 0; index < arguments.length; index += 1) {
    const value = arguments[index]
    if (typeof value === 'string' && value !== '') names.push(value)
    else if (Array.isArray(value)) names.push(cx.apply(null, value))
    else if (value !== null && typeof value === 'object') {
      for (const [key, on] of Object.entries(value)) if (on) names.push(key)
    }
  }
  return names.join(' ')
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function pct(value, total) {
  const size = Number(total)
  if (!Number.isFinite(size) || size <= 0) return 0
  return clamp(Math.round((Number(value) / size) * 100), 0, 100)
}

function dayKey(date) {
  const value = date instanceof Date ? date : new Date(date ?? Date.now())
  const pad = (part) => String(part).padStart(2, '0')
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
}

function todayKey() {
  return dayKey(new Date())
}

function normWord(word) {
  return String(word ?? '').trim().toLowerCase()
}

function errorMessage(error, fallback) {
  if (error instanceof Error && error.message !== '') return error.message
  return fallback ?? '出错了，请稍后再试'
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isAbortError(error) {
  return error !== null && typeof error === 'object' && error.name === 'AbortError'
}
