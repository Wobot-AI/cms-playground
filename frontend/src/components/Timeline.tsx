import { useEffect, useRef, useState } from 'react'
import { now } from '../lib/store'
import { metrics, type Run } from '../run/model'

const ROW_H = 34
const LABEL_W = 92
const TOP = 22

/** Gantt-style view of one run: plan vs API calls vs what the screen showed. */
export function Timeline({ run }: { run: Run }) {
  const wrap = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(800)
  const [tick, setTick] = useState(now())
  const live = ['starting', 'waiting-release', 'released'].includes(run.status)

  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    if (wrap.current) ro.observe(wrap.current)
    return () => ro.disconnect()
  }, [])
  useEffect(() => {
    if (!live) return
    const t = setInterval(() => setTick(now()), 200)
    return () => clearInterval(t)
  }, [live])

  const t0 = run.start?.sentAt
  if (t0 == null) return <div ref={wrap} className="timeline-empty hint">Waiting for the takeover request…</div>

  const m = metrics(run)
  const D = run.adSec * 1000
  const rel = (at: number) => at - t0
  const plannedRelease = run.releaseOffsetSec * 1000
  const expVisible = run.leadEstSec * 1000
  const expGone = plannedRelease + run.releaseEstSec * 1000

  const ends = [
    D + expVisible,
    expGone,
    plannedRelease,
    run.release ? rel(run.release.respondedAt) : 0,
    run.goneAt ? rel(run.goneAt) : 0,
    run.visibleAt ? rel(run.visibleAt) + D : 0,
    live ? rel(tick) : 0,
  ]
  const maxMs = Math.max(...ends) + 2000
  const minMs = -1000
  const plotW = Math.max(100, width - LABEL_W - 12)
  const x = (ms: number) => LABEL_W + ((ms - minMs) / (maxMs - minMs)) * plotW
  const rowY = (i: number) => TOP + i * ROW_H
  const height = TOP + ROW_H * 3 + 26

  const step = maxMs > 90_000 ? 10_000 : maxMs > 40_000 ? 5000 : 2000
  const ticks: number[] = []
  for (let t = 0; t <= maxMs; t += step) ticks.push(t)

  const bar = (row: number, from: number, to: number, cls: string, label?: string) => (
    <g>
      <rect x={x(from)} y={rowY(row) + 6} width={Math.max(2, x(to) - x(from))} height={ROW_H - 12} rx={3} className={cls} />
      {label && x(to) - x(from) > 60 && (
        <text x={(x(from) + x(to)) / 2} y={rowY(row) + ROW_H / 2 + 4} textAnchor="middle" className="bar-label">
          {label}
        </text>
      )}
    </g>
  )

  const vAt = run.visibleAt != null ? rel(run.visibleAt) : null
  const gAt = run.goneAt != null ? rel(run.goneAt) : null
  const screenEnd = gAt ?? (live && vAt != null ? rel(tick) : null)

  return (
    <div ref={wrap} className="timeline">
      <svg width={width} height={height} role="img" aria-label="Run timeline">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={TOP - 4} y2={height - 22} className="grid" />
            <text x={x(t)} y={height - 8} textAnchor="middle" className="axis">
              {t / 1000}s
            </text>
          </g>
        ))}
        {['Expected', 'API calls', 'Measured'].map((l, i) => (
          <text key={l} x={0} y={rowY(i) + ROW_H / 2 + 4} className="row-label">
            {l}
          </text>
        ))}

        {/* Plan: where we expected the ad to be */}
        {bar(0, expVisible, expGone, 'plan', `expected ${((expGone - expVisible) / 1000).toFixed(1)} s`)}

        {/* API: takeover and revert requests, width = round-trip */}
        {bar(1, 0, rel(run.start!.respondedAt), 'api')}
        {run.release ? bar(1, rel(run.release.sentAt), rel(run.release.respondedAt), 'api') : bar(1, plannedRelease, plannedRelease + 300, 'api pending')}

        {/* Screen: what the camera saw */}
        {vAt != null && screenEnd != null && (
          <>
            {bar(2, vAt, Math.min(screenEnd, vAt + D), 'screen', `visible ${((screenEnd - vAt) / 1000).toFixed(1)} s`)}
            {screenEnd > vAt + D && bar(2, vAt + D, screenEnd, 'overrun')}
            {gAt != null && gAt < vAt + D && bar(2, gAt, vAt + D, 'missing')}
          </>
        )}

        <Marker x={x(0)} label="T0 takeover sent" y={TOP - 8} cls="m-start" h={height - 22} />
        {run.release && <Marker x={x(rel(run.release.sentAt))} label="revert sent" y={TOP - 8} cls="m-release" h={height - 22} />}
        {m.idealOffset != null && <Marker x={x(m.idealOffset)} label="ideal revert" y={height - 24} cls="m-ideal" h={height - 22} dashed />}
        {live && <line x1={x(rel(tick))} x2={x(rel(tick))} y1={TOP - 4} y2={height - 22} className="m-now" />}
      </svg>
      <div className="legend">
        <span className="lg plan" /> expected (from your inputs) <span className="lg api" /> API request → response <span className="lg screen" /> ad on screen{' '}
        <span className="lg overrun" /> overrun past D <span className="lg missing" /> cut short
      </div>
    </div>
  )
}

function Marker({ x, label, y, cls, h, dashed }: { x: number; label: string; y: number; cls: string; h: number; dashed?: boolean }) {
  return (
    <g className={cls}>
      <line x1={x} x2={x} y1={TOP - 4} y2={h} strokeDasharray={dashed ? '4 3' : undefined} />
      <text x={x + 4} y={y + 10}>
        {label}
      </text>
    </g>
  )
}
