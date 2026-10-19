import { useEffect, useRef, useState } from 'react'
import { camera, type Roi } from '../camera/feed'
import { now, useStore } from '../lib/store'
import { activeRunId, runsStore, setMark } from '../run/engine'
import { Sparkline } from './Sparkline'

const WINDOW_MS = 20_000
/** Live picture-change graph under the video. Display only: scores are still computed for auto-guess and Frame review. */
const SHOW_LIVE_GRAPH = false
/** "Ad visible / Ad gone" buttons and their V/G shortcuts. Marks can still be set in Frame review. */
const SHOW_LIVE_MARKS = false

export function CameraPanel() {
  const feed = useStore(camera.state)
  const roi = useStore(camera.roi)
  const active = useStore(activeRunId)
  const runs = useStore(runsStore)
  const run = runs.find((r) => r.id === active)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [draft, setDraft] = useState<Roi | null>(null)
  const dragFrom = useRef<{ x: number; y: number } | null>(null)
  const [series, setSeries] = useState<{ at: number; v: number }[]>([])
  const [clockNow, setClockNow] = useState(now())

  useEffect(() => {
    void camera.connect()
  }, [])

  useEffect(() => {
    const draw = (b: ImageBitmap) => {
      const c = canvasRef.current
      if (!c) return
      if (c.width !== b.width || c.height !== b.height) {
        c.width = b.width
        c.height = b.height
      }
      c.getContext('2d')!.drawImage(b, 0, 0)
    }
    if (camera.latestBitmap) draw(camera.latestBitmap)
    return camera.onDraw(draw)
  }, [])

  // Change-score history for the live sparkline, batched to ~4 updates/s.
  useEffect(() => {
    if (!SHOW_LIVE_GRAPH) return
    let buf: { at: number; v: number }[] = []
    const off = camera.onFrame((f) => {
      if (f.diff != null) buf.push({ at: f.at, v: f.diff })
    })
    const t = setInterval(() => {
      const cutoff = now() - WINDOW_MS
      const batch = buf
      buf = []
      setSeries((prev) => [...prev.filter((p) => p.at > cutoff), ...batch])
      if (!activeRunId.get()) setClockNow(now())
    }, 250)
    return () => {
      off()
      clearInterval(t)
    }
  }, [])

  useEffect(() => {
    if (!active) return
    let raf = 0
    const tick = () => {
      setClockNow(now())
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [active])

  // V = ad visible, G = ad gone (while a run is active).
  useEffect(() => {
    if (!SHOW_LIVE_MARKS) return
    const onKey = (e: KeyboardEvent) => {
      const id = activeRunId.get()
      if (!id || e.repeat || (e.target as HTMLElement).matches('input, select, textarea')) return
      if (e.key === 'v' || e.key === 'V') setMark(id, 'visible', now(), 'live')
      if (e.key === 'g' || e.key === 'G') setMark(id, 'gone', now(), 'live')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const toNorm = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect()
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    }
  }
  const rectFrom = (a: { x: number; y: number }, b: { x: number; y: number }): Roi => ({
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  })

  const t0 = run?.start?.sentAt
  const shownRoi = draft ?? roi
  const fullFrame = roi.w === 1 && roi.h === 1

  return (
    <section className="card camera">
      <div className="card-head">
        <h2>2 · Watch the screen</h2>
        <div className="row">
          <span className={`pill ${feed.status}`}>
            {feed.status === 'live' ? `live · ${feed.fps.toFixed(0)} fps` : feed.status}
            {feed.recording && ' · rec'}
          </span>
          {feed.status === 'live' || feed.status === 'connecting' ? (
            <button className="ghost" onClick={() => camera.disconnect()}>
              Disconnect
            </button>
          ) : (
            <button className="ghost" onClick={() => void camera.connect()}>
              Connect camera
            </button>
          )}
        </div>
      </div>
      {feed.error && <p className="error">{feed.error}</p>}

      <div className="video-wrap">
        <canvas
          ref={canvasRef}
          className="video"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            dragFrom.current = toNorm(e)
          }}
          onPointerMove={(e) => dragFrom.current && setDraft(rectFrom(dragFrom.current, toNorm(e)))}
          onPointerUp={(e) => {
            const r = dragFrom.current && rectFrom(dragFrom.current, toNorm(e))
            dragFrom.current = null
            setDraft(null)
            if (r && r.w > 0.02 && r.h > 0.02) camera.roi.set(r)
          }}
        />
        {feed.status !== 'live' && <div className="video-placeholder">{feed.status === 'connecting' ? 'Connecting to camera…' : 'Camera not connected'}</div>}
        {!fullFrame || draft ? (
          <div
            className="roi"
            style={{ left: `${shownRoi.x * 100}%`, top: `${shownRoi.y * 100}%`, width: `${shownRoi.w * 100}%`, height: `${shownRoi.h * 100}%` }}
          />
        ) : null}
        {run && (
          <div className="run-clock">
            {t0 ? `T0 + ${((clockNow - t0) / 1000).toFixed(1)} s` : 'sending takeover…'}
            {run.start && run.releaseOffsetSec != null && !run.release && t0 && (
              <small> · revert in {Math.max(0, (t0 + run.releaseOffsetSec * 1000 - clockNow) / 1000).toFixed(1)} s</small>
            )}
          </div>
        )}
      </div>

      <div className="row space">
        <span className="hint">
          Drag on the video to box the TV, so the change score ignores the room.{' '}
          {!fullFrame && (
            <button className="link" onClick={() => camera.roi.set({ x: 0, y: 0, w: 1, h: 1 })}>
              Reset box
            </button>
          )}
        </span>
      </div>

      {SHOW_LIVE_GRAPH && (
        <div className="spark-row">
          <span className="hint">Picture change (last 20 s)</span>
          <Sparkline points={series} from={clockNow - WINDOW_MS} to={Math.max(clockNow, series.at(-1)?.at ?? 0)} height={44} />
        </div>
      )}

      {SHOW_LIVE_MARKS && (
        <>
          <div className="marks">
            <button className="mark visible" disabled={!run} onClick={() => run && setMark(run.id, 'visible', now(), 'live')}>
              Ad visible <kbd>V</kbd>
              {run?.visibleAt && t0 && <small>T0 + {((run.visibleAt - t0) / 1000).toFixed(2)} s</small>}
            </button>
            <button className="mark gone" disabled={!run} onClick={() => run && setMark(run.id, 'gone', now(), 'live')}>
              Ad gone <kbd>G</kbd>
              {run?.goneAt && t0 && <small>T0 + {((run.goneAt - t0) / 1000).toFixed(2)} s</small>}
            </button>
          </div>
          <p className="hint">
            Press when you <i>see</i> it on the camera. Camera delay and your reaction time hit both marks about equally, so they cancel out in the
            recommended revert time. Refine marks to the exact frame afterwards in Frame review.
          </p>
        </>
      )}
    </section>
  )
}
