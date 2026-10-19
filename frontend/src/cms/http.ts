import { apiFetch } from '../lib/api'
import { log, now } from '../lib/store'
import type { ApiCall } from './types'

/** Backend call that timestamps the request and writes it to the event log. */
export async function timedFetch(
  cms: string,
  method: string,
  url: string,
  body?: unknown,
): Promise<ApiCall> {
  const sentAt = now()
  try {
    const res = await apiFetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const respondedAt = now()
    const text = await res.text()
    let parsed: unknown = text
    try {
      parsed = text ? JSON.parse(text) : undefined
    } catch {
      /* non-JSON body, keep text */
    }
    const call: ApiCall = { sentAt, respondedAt, ok: res.ok, status: res.status, body: parsed }
    if (!res.ok) call.error = `HTTP ${res.status}`
    log('api', `${cms} ${method} ${url.replace(/^\/api\/[^/]+/, '')} → ${res.status} in ${Math.round(respondedAt - sentAt)} ms`, {
      level: res.ok ? 'info' : 'error',
      data: { request: body, response: parsed },
    })
    return call
  } catch (e) {
    const respondedAt = now()
    const error = e instanceof Error ? e.message : String(e)
    log('api', `${cms} ${method} ${url} failed: ${error}`, { level: 'error' })
    return { sentAt, respondedAt, ok: false, status: 0, error }
  }
}

export async function getJson<T>(cms: string, url: string): Promise<T> {
  const call = await timedFetch(cms, 'GET', url)
  if (!call.ok) throw new Error(`${cms}: GET ${url} failed (${call.error})`)
  return call.body as T
}
