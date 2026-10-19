import { apiFetch } from '../lib/api'
import { log, now } from '../lib/store'
import { getJson, timedFetch } from './http'
import type { CmsAdapter, CmsMedia, CmsScreen, Screenshot } from './types'

// Backend route (backend/src/yodeck.ts), which attaches the API token.
const API = '/api/yodeck'

interface Page<T> {
  next: string | null
  results: T[]
}

interface YScreen {
  id: number
  name: string
  player_type: string
  state?: { online?: boolean }
  screen_content?: { source_type?: string; source_name?: string } | null
  takeover_content?: unknown
  screenshot_url?: string
}

interface YMedia {
  id: number
  name: string
  media_origin?: { type?: string }
  default_duration?: number
  arguments?: { duration?: number }
  thumbnail_url?: string
}

async function listAll<T>(path: string): Promise<T[]> {
  const out: T[] = []
  let offset = 0
  for (;;) {
    const page = await getJson<Page<T>>('Yodeck', `${API}${path}?limit=100&offset=${offset}`)
    out.push(...page.results)
    if (!page.next || !page.results.length) return out
    offset += page.results.length
  }
}

function toScreen(s: YScreen): CmsScreen {
  return {
    id: String(s.id),
    name: s.name,
    playerType: s.player_type || 'unknown',
    online: Boolean(s.state?.online),
    normalContent: s.screen_content
      ? `${s.screen_content.source_type}: ${s.screen_content.source_name}`
      : undefined,
    takeoverActive: s.takeover_content != null,
  }
}

/** When the screenshot image was last uploaded. Read by the backend: browsers can't see this header cross-origin. */
async function lastModified(imageUrl: string): Promise<number | null> {
  try {
    const res = await apiFetch(`${API}/screenshot-info?url=${encodeURIComponent(imageUrl)}`, { cache: 'no-store' })
    return res.ok ? ((await res.json()) as { lastModified: number | null }).lastModified : null
  } catch {
    return null
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const screenshotUrls = new Map<string, string>()

export const yodeck: CmsAdapter = {
  id: 'yodeck',
  label: 'Yodeck',
  notes: [
    'Takeover = PUT /screens/{id}/takeover (one screen) or PUT /screens/takeover (several). Release = same call with takeover_content: null.',
    'Yodeck’s own takeover duration is whole minutes, documented minimum 5. It is only a backstop; this page sends the release itself.',
    'Rate limit (standard): 21 requests / 10 s per token. Keep screenshot polling ≥ 3 s.',
  ],
  backstop: { label: 'Yodeck backstop (min)', default: 5, min: 5 },

  async listScreens() {
    const screens = await listAll<YScreen>('/screens/')
    for (const s of screens) if (s.screenshot_url) screenshotUrls.set(String(s.id), s.screenshot_url)
    return screens.map(toScreen)
  },

  async listMedia() {
    const media = await listAll<YMedia>('/media/')
    return media.map(
      (m): CmsMedia => ({
        id: String(m.id),
        name: m.name,
        kind: m.media_origin?.type ?? 'media',
        // Videos carry their real length in arguments.duration; images only have default_duration.
        durationSec: m.arguments?.duration ?? m.default_duration ?? null,
        thumbnailUrl: m.thumbnail_url,
      }),
    )
  },

  startTakeover(screenIds, mediaId, { backstop }) {
    const takeover_content = {
      source_id: Number(mediaId),
      source_type: 'media',
      ...(backstop ? { duration: backstop } : {}),
    }
    if (screenIds.length === 1) {
      return timedFetch('Yodeck', 'PUT', `${API}/screens/${screenIds[0]}/takeover`, { takeover_content })
    }
    return timedFetch('Yodeck', 'PUT', `${API}/screens/takeover`, {
      screens: screenIds.map((id) => ({ id: Number(id), takeover_content })),
    })
  },

  stopTakeover(screenIds) {
    if (screenIds.length === 1) {
      return timedFetch('Yodeck', 'PUT', `${API}/screens/${screenIds[0]}/takeover`, { takeover_content: null })
    }
    return timedFetch('Yodeck', 'PUT', `${API}/screens/takeover`, {
      screens: screenIds.map((id) => ({ id: Number(id), takeover_content: null })),
    })
  },

  async captureScreenshot(screenId, previous) {
    let imageUrl = screenshotUrls.get(screenId)
    if (!imageUrl) {
      const s = await getJson<YScreen>('Yodeck', `${API}/screens/${screenId}/`)
      if (!s.screenshot_url) return null
      imageUrl = s.screenshot_url
      screenshotUrls.set(screenId, imageUrl)
    }
    const before = previous?.imageAt ?? (await lastModified(imageUrl))
    const requestedAt = now()
    const call = await timedFetch('Yodeck', 'POST', `${API}/screens/${screenId}/refresh-screenshot`)
    if (!call.ok) return null
    // The player uploads asynchronously; poll S3 until the object changes.
    for (let i = 0; i < 12; i++) {
      await sleep(1000)
      const lm = await lastModified(imageUrl)
      if (lm && lm !== before) {
        return { requestedAt, imageAt: lm, url: `${imageUrl}?t=${lm}` } satisfies Screenshot
      }
    }
    log('screenshot', `No new screenshot from screen ${screenId} within 12 s`, { level: 'warn' })
    return null
  },
}
