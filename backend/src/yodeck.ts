import { Hono } from 'hono'
import { config } from './config.js'

/**
 * Pass-through to the Yodeck API that attaches the token. Only the calls the
 * playground needs are allowed, so the access key cannot be used to, say,
 * delete media.
 */
const ALLOWED: [method: string, path: RegExp][] = [
  ['GET', /^\/screens\/$/],
  ['GET', /^\/screens\/\d+\/$/],
  ['GET', /^\/media\/$/],
  ['PUT', /^\/screens\/\d+\/takeover$/],
  ['PUT', /^\/screens\/takeover$/],
  ['POST', /^\/screens\/\d+\/refresh-screenshot$/],
]

// Yodeck screenshots are public S3 objects; we only read their timestamps.
const SCREENSHOT_HOST = 'dsbackend.s3.amazonaws.com'

export const yodeck = new Hono()

/**
 * Last-Modified of a screenshot image. The browser cannot read this header
 * cross-origin, and it tells us when the player uploaded a fresh screenshot.
 */
yodeck.get('/screenshot-info', async (c) => {
  let url: URL
  try {
    url = new URL(c.req.query('url') ?? '')
  } catch {
    return c.json({ error: 'url query parameter required' }, 400)
  }
  if (url.protocol !== 'https:' || url.hostname !== SCREENSHOT_HOST) {
    return c.json({ error: 'not a Yodeck screenshot URL' }, 400)
  }
  url.search = ''
  const res = await fetch(url, { method: 'HEAD' })
  const lm = res.headers.get('last-modified')
  return c.json({ lastModified: res.ok && lm ? Date.parse(lm) : null })
})

yodeck.all('/*', async (c) => {
  const url = new URL(c.req.url)
  const path = url.pathname.replace(/^\/api\/yodeck/, '')
  const method = c.req.method
  if (!ALLOWED.some(([m, re]) => m === method && re.test(path))) {
    return c.json({ error: `${method} ${path} is not allowed through this proxy` }, 403)
  }
  if (!config.yodeck.token) return c.json({ error: 'YODECK_API_TOKEN is not set on the backend' }, 500)

  const hasBody = method !== 'GET' && method !== 'HEAD'
  const upstream = await fetch(`${config.yodeck.baseUrl}${path}${url.search}`, {
    method,
    headers: {
      Authorization: `Token ${config.yodeck.token}`,
      Accept: 'application/json',
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
    },
    body: hasBody ? await c.req.text() : undefined,
  })

  const headers = new Headers({ 'Content-Type': upstream.headers.get('content-type') ?? 'application/json' })
  const retryAfter = upstream.headers.get('retry-after')
  if (retryAfter) headers.set('Retry-After', retryAfter)
  return new Response(upstream.body, { status: upstream.status, headers })
})
