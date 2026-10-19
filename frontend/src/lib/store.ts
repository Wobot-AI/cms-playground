import { useSyncExternalStore } from 'react'

/** Wall-clock ms with sub-ms precision; monotonic within a page load. */
export const now = () => performance.timeOrigin + performance.now()

/** Minimal external store usable from plain code and React alike. */
export function createStore<T>(initial: T) {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    get: () => state,
    set(next: T | ((prev: T) => T)) {
      state = typeof next === 'function' ? (next as (p: T) => T)(state) : next
      listeners.forEach((l) => l())
    },
    subscribe(l: () => void) {
      listeners.add(l)
      return () => {
        listeners.delete(l)
      }
    },
  }
}

export type Store<T> = ReturnType<typeof createStore<T>>

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get)
}

// ---- event log -------------------------------------------------------------

export type LogSource = 'api' | 'run' | 'camera' | 'mark' | 'screenshot'
export interface LogEntry {
  id: number
  at: number
  source: LogSource
  level: 'info' | 'warn' | 'error'
  msg: string
  data?: unknown
}

let logSeq = 0
export const logStore = createStore<LogEntry[]>([])

export function log(source: LogSource, msg: string, opts: { level?: LogEntry['level']; data?: unknown } = {}) {
  const entry: LogEntry = { id: ++logSeq, at: now(), source, level: opts.level ?? 'info', msg, data: opts.data }
  logStore.set((prev) => [...prev.slice(-499), entry])
}

// ---- formatting --------------------------------------------------------------

export function clock(ms: number | undefined | null): string {
  if (ms == null) return '—'
  const d = new Date(ms)
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
}

export function secs(ms: number | undefined | null, digits = 2): string {
  if (ms == null || Number.isNaN(ms)) return '—'
  return `${(ms / 1000).toFixed(digits)} s`
}

export function signedSecs(ms: number | undefined | null, digits = 2): string {
  if (ms == null || Number.isNaN(ms)) return '—'
  const s = (ms / 1000).toFixed(digits)
  return ms > 0 ? `+${s} s` : `${s} s`
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
