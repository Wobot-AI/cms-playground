import { camera, type Frame } from '../camera/feed'
import type { CmsAdapter, CmsMedia, CmsScreen, Screenshot } from '../cms/types'
import { createStore, log, now, secs } from '../lib/store'
import { plannedReleaseOffsetSec, type MarkSource, type Run, type StrategyKind } from './model'

const RUNS_KEY = 'cms-playground.runs'
/** Stop recording this long after the "gone" mark, to keep some post-roll. */
const POSTROLL_MS = 3000
/** Give up waiting for a "gone" mark this long after the release was sent. */
const RELEASE_TIMEOUT_MS = 30_000
const KEEP_FRAMES_FOR_RUNS = 6

function loadRuns(): Run[] {
  try {
    const runs = JSON.parse(localStorage.getItem(RUNS_KEY) ?? '[]') as Run[]
    // Anything still "in flight" belongs to a page that was closed mid-run.
    return runs.map((r) =>
      ['starting', 'waiting-release', 'released'].includes(r.status) ? { ...r, status: 'aborted', hasFrames: false } : { ...r, hasFrames: false },
    )
  } catch {
    return []
  }
}

export const runsStore = createStore<Run[]>(loadRuns())
export const activeRunId = createStore<string | null>(null)

runsStore.subscribe(() => {
  try {
    localStorage.setItem(RUNS_KEY, JSON.stringify(runsStore.get()))
  } catch {
    /* storage full or unavailable; runs still live in memory */
  }
})

/** Recorded camera frames per run. Memory only. */
export const runFrames = new Map<string, Frame[]>()

export function updateRun(id: string, patch: Partial<Run> | ((r: Run) => Partial<Run>)) {
  runsStore.set((runs) => runs.map((r) => (r.id === id ? { ...r, ...(typeof patch === 'function' ? patch(r) : patch) } : r)))
}

export function getRun(id: string | null) {
  return runsStore.get().find((r) => r.id === id)
}

export function deleteRun(id: string) {
  runFrames.delete(id)
  runsStore.set((runs) => runs.filter((r) => r.id !== id))
}

export function clearRuns() {
  runFrames.clear()
  runsStore.set([])
}

export function setMark(runId: string, type: 'visible' | 'gone', at: number, source: MarkSource) {
  const r = getRun(runId)
  if (!r) return
  updateRun(runId, type === 'visible' ? { visibleAt: at, visibleSource: source } : { goneAt: at, goneSource: source })
  const t0 = r.start?.sentAt
  log('mark', `Ad ${type} (${source})${t0 ? ` at T0 ${secs(at - t0)}` : ''}`)
  if (type === 'gone' && r.status === 'released') controller?.finishSoon(POSTROLL_MS)
}

/**
 * Biggest picture change inside the ROI between T0 and the release is the
 * best guess for "ad appeared"; biggest after the release for "ad gone".
 * Only a suggestion: normal content has its own cuts. Verify in frame review.
 */
export function suggestMarks(run: Run, frames: Frame[]): { visible?: number; gone?: number } {
  const t0 = run.start?.sentAt
  const rel = run.release?.sentAt
  if (t0 == null || rel == null) return {}
  const peak = (from: number, to: number) => {
    let best: Frame | undefined
    for (const f of frames) if (f.at > from && f.at <= to && f.diff != null && (!best || f.diff > best.diff!)) best = f
    return best?.at
  }
  return { visible: peak(t0, rel), gone: peak(rel, Infinity) }
}

export interface RunConfig {
  adapter: CmsAdapter
  screens: CmsScreen[]
  media: CmsMedia
  adSec: number
  strategy: StrategyKind
  leadEstSec: number
  releaseEstSec: number
  customOffsetSec: number
  backstop: number | null
  screenshotEverySec: number
}

class RunController {
  private releaseTimer: ReturnType<typeof setTimeout> | null = null
  private finishTimer: ReturnType<typeof setTimeout> | null = null
  private screenshotsOn = false
  private finished = false

  constructor(
    readonly run: Run,
    private cfg: RunConfig,
  ) {}

  async start() {
    const { run, cfg } = this
    camera.startRecording(now())

    log('run', `Run started: ${run.mediaName} (${run.adSec} s) on ${run.screenName}, revert planned at T0 + ${run.releaseOffsetSec.toFixed(2)} s`)
    const start = await cfg.adapter.startTakeover(run.screenIds, run.mediaId, { backstop: run.backstop })
    updateRun(run.id, { start })
    if (this.finished) {
      // Aborted while the takeover request was in flight: undo it right away.
      if (start.ok) updateRun(run.id, { release: await cfg.adapter.stopTakeover(run.screenIds) })
      return
    }
    if (!start.ok) {
      updateRun(run.id, { status: 'failed', error: `Takeover failed: ${start.error}` })
      return this.finish()
    }
    updateRun(run.id, { status: 'waiting-release' })

    const releaseAt = start.sentAt + run.releaseOffsetSec * 1000
    this.releaseTimer = setTimeout(() => void this.release(), Math.max(0, releaseAt - now()))

    if (cfg.screenshotEverySec > 0 && cfg.adapter.captureScreenshot) void this.screenshotLoop()
  }

  async release(reason?: string) {
    if (this.releaseTimer) clearTimeout(this.releaseTimer)
    this.releaseTimer = null
    const r = getRun(this.run.id)
    if (!r || r.release || !r.start?.ok) return
    if (reason) log('run', reason)
    const release = await this.cfg.adapter.stopTakeover(this.run.screenIds)
    updateRun(this.run.id, { release, status: 'released', ...(release.ok ? {} : { error: `Release failed: ${release.error}` }) })
    const after = getRun(this.run.id)
    if (after?.goneAt != null) this.finishSoon(POSTROLL_MS)
    else this.finishSoon(RELEASE_TIMEOUT_MS)
  }

  finishSoon(ms: number) {
    if (this.finishTimer) clearTimeout(this.finishTimer)
    this.finishTimer = setTimeout(() => this.finish(), ms)
  }

  async abort() {
    log('run', 'Run aborted by user', { level: 'warn' })
    await this.release('Releasing takeover now (abort)')
    this.finish('aborted')
  }

  finish(status?: 'aborted') {
    if (this.finished) return
    this.finished = true
    if (this.releaseTimer) clearTimeout(this.releaseTimer)
    if (this.finishTimer) clearTimeout(this.finishTimer)
    this.screenshotsOn = false

    const frames = camera.stopRecording()
    if (frames.length) {
      runFrames.set(this.run.id, frames)
      for (const id of [...runFrames.keys()].slice(0, -KEEP_FRAMES_FOR_RUNS)) {
        runFrames.delete(id)
        updateRun(id, { hasFrames: false })
      }
    }

    const r = getRun(this.run.id)!
    const patch: Partial<Run> = { hasFrames: frames.length > 0 }
    if (r.status !== 'failed') patch.status = status ?? 'done'
    const guess = suggestMarks(r, frames)
    if (r.visibleAt == null && guess.visible) Object.assign(patch, { visibleAt: guess.visible, visibleSource: 'auto' })
    if (r.goneAt == null && guess.gone) Object.assign(patch, { goneAt: guess.gone, goneSource: 'auto' })
    updateRun(this.run.id, patch)
    log('run', `Run finished (${patch.status ?? r.status}), ${frames.length} camera frames kept`)
    activeRunId.set(null)
    controller = null
  }

  private async screenshotLoop() {
    this.screenshotsOn = true
    let prev: Screenshot | undefined
    while (this.screenshotsOn) {
      const startedAt = now()
      const shot = await this.cfg.adapter.captureScreenshot!(this.run.screenIds[0], prev).catch(() => null)
      if (shot && this.screenshotsOn) {
        prev = shot
        updateRun(this.run.id, (r) => ({ screenshots: [...r.screenshots, shot] }))
      }
      const wait = this.cfg.screenshotEverySec * 1000 - (now() - startedAt)
      if (wait > 0) await new Promise((res) => setTimeout(res, wait))
    }
  }
}

let controller: RunController | null = null

export function startRun(cfg: RunConfig): string | null {
  if (controller) return null
  const screen = cfg.screens[0]
  const run: Run = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    cms: cfg.adapter.id,
    cmsLabel: cfg.adapter.label,
    screenIds: cfg.screens.map((s) => s.id),
    screenName: cfg.screens.map((s) => s.name).join(', '),
    playerType: screen.playerType,
    mediaId: cfg.media.id,
    mediaName: cfg.media.name,
    adSec: cfg.adSec,
    strategy: cfg.strategy,
    leadEstSec: cfg.leadEstSec,
    releaseEstSec: cfg.releaseEstSec,
    releaseOffsetSec: plannedReleaseOffsetSec(cfg.strategy, cfg.adSec, cfg.leadEstSec, cfg.releaseEstSec, cfg.customOffsetSec),
    backstop: cfg.backstop,
    status: 'starting',
    screenshots: [],
  }
  runsStore.set((runs) => [...runs, run])
  activeRunId.set(run.id)
  controller = new RunController(run, cfg)
  void controller.start()
  return run.id
}

export const releaseNow = () => controller?.release('Manual release requested')
export const abortRun = () => controller?.abort()
export const finishRun = () => controller?.finish()
export const isRunning = () => controller != null
