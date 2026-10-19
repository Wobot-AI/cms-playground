import type { ApiCall, Screenshot } from '../cms/types'
import { median } from '../lib/store'

/**
 * When to send the revert (release) request, measured from the moment the
 * takeover request was sent (T0). D = ad length, L = lead-in, R = release delay.
 */
export type StrategyKind = 'naive' | 'after-lead-in' | 'compensated' | 'custom'

export const STRATEGIES: Record<StrategyKind, { label: string; formula: string; help: string }> = {
  naive: {
    label: 'At ad length',
    formula: 'T0 + D',
    help: 'Revert when the ad would end if it had started instantly (10:00:20 in the sheet). Ignores both delays, so the ad gets cut short.',
  },
  'after-lead-in': {
    label: 'After lead-in',
    formula: 'T0 + L + D',
    help: 'Revert when the ad actually should end (10:00:25 in the sheet). Ignores the release delay, so the ad overruns by about R.',
  },
  compensated: {
    label: 'Compensated',
    formula: 'T0 + L + D − R',
    help: 'Revert early by the release delay, so the ad leaves the screen right on time.',
  },
  custom: {
    label: 'Custom offset',
    formula: 'T0 + X',
    help: 'Send the revert a fixed number of seconds after the takeover request.',
  },
}

export function plannedReleaseOffsetSec(
  kind: StrategyKind,
  adSec: number,
  leadSec: number,
  releaseSec: number,
  customSec: number,
): number {
  switch (kind) {
    case 'naive':
      return adSec
    case 'after-lead-in':
      return leadSec + adSec
    case 'compensated':
      return Math.max(0, leadSec + adSec - releaseSec)
    case 'custom':
      return customSec
  }
}

export type MarkSource = 'live' | 'frame' | 'auto'

export type RunStatus = 'starting' | 'waiting-release' | 'released' | 'done' | 'failed' | 'aborted'

export interface Run {
  id: string
  createdAt: number
  cms: string
  cmsLabel: string
  screenIds: string[]
  screenName: string
  playerType: string
  mediaId: string
  mediaName: string
  adSec: number
  strategy: StrategyKind
  leadEstSec: number
  releaseEstSec: number
  releaseOffsetSec: number
  backstop: number | null
  start?: ApiCall
  release?: ApiCall
  visibleAt?: number
  goneAt?: number
  visibleSource?: MarkSource
  goneSource?: MarkSource
  status: RunStatus
  error?: string
  screenshots: Screenshot[]
  hasFrames?: boolean
  note?: string
}

export interface RunMetrics {
  /** Takeover request sent → ad visible. */
  leadIn: number | null
  /** Revert request sent → ad gone. */
  releaseDelay: number | null
  /** How long the ad was actually visible. */
  onScreen: number | null
  /** onScreen − D. Negative = cut short, positive = overran. */
  delta: number | null
  /** Revert offset actually used (from T0). */
  usedOffset: number | null
  /** Revert offset that would have made this run exactly D: L + D − R. */
  idealOffset: number | null
  startRtt: number | null
  releaseRtt: number | null
}

export function metrics(r: Run): RunMetrics {
  const t0 = r.start?.sentAt
  const rel = r.release?.sentAt
  const D = r.adSec * 1000
  const leadIn = t0 != null && r.visibleAt != null ? r.visibleAt - t0 : null
  const releaseDelay = rel != null && r.goneAt != null ? r.goneAt - rel : null
  const onScreen = r.visibleAt != null && r.goneAt != null ? r.goneAt - r.visibleAt : null
  return {
    leadIn,
    releaseDelay,
    onScreen,
    delta: onScreen != null ? onScreen - D : null,
    usedOffset: t0 != null && rel != null ? rel - t0 : null,
    idealOffset: leadIn != null && releaseDelay != null ? leadIn + D - releaseDelay : null,
    startRtt: r.start ? r.start.respondedAt - r.start.sentAt : null,
    releaseRtt: r.release ? r.release.respondedAt - r.release.sentAt : null,
  }
}

export interface Profile {
  cms: string
  cmsLabel: string
  playerType: string
  runs: number
  leadIn: number | null
  releaseDelay: number | null
  leadSpread: [number, number] | null
  releaseSpread: [number, number] | null
}

/** Median lead-in / release delay per CMS + player type, from completed runs. */
export function profiles(runs: Run[]): Profile[] {
  const groups = new Map<string, Run[]>()
  for (const r of runs) {
    if (r.status !== 'done') continue
    const k = `${r.cms}|${r.playerType}`
    groups.set(k, [...(groups.get(k) ?? []), r])
  }
  return [...groups.values()].map((rs) => {
    const ms = rs.map(metrics)
    const leads = ms.map((m) => m.leadIn).filter((x): x is number => x != null)
    const rels = ms.map((m) => m.releaseDelay).filter((x): x is number => x != null)
    const spread = (xs: number[]): [number, number] | null => (xs.length ? [Math.min(...xs), Math.max(...xs)] : null)
    return {
      cms: rs[0].cms,
      cmsLabel: rs[0].cmsLabel,
      playerType: rs[0].playerType,
      runs: rs.length,
      leadIn: median(leads),
      releaseDelay: median(rels),
      leadSpread: spread(leads),
      releaseSpread: spread(rels),
    }
  })
}
