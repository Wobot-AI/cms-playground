import { createStore } from './store'

/**
 * Backend base URL. Empty in local dev: Vite proxies /api and /camera to the
 * backend. In production (Vercel) set VITE_API_BASE_URL=https://your-vm-domain.
 */
export const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

const KEY = 'cms-playground.access-key'

function loadKey(): string {
  try {
    return localStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

export const accessKey = createStore<string>(loadKey())
/** Set when the backend rejects the key, so the UI can ask for it. */
export const needsAccessKey = createStore(false)

export function setAccessKey(k: string) {
  try {
    localStorage.setItem(KEY, k)
  } catch {
    /* storage unavailable: key lives for this page load only */
  }
  accessKey.set(k)
  needsAccessKey.set(false)
}

/** fetch() against the backend, with base URL and access key applied. */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  const key = accessKey.get()
  if (key) headers.set('Authorization', `Bearer ${key}`)
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers })
  if (res.status === 401) needsAccessKey.set(true)
  return res
}
