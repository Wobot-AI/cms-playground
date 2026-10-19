import { useEffect, useMemo, useState } from 'react'
import { signedSecs, useStore } from '../lib/store'
import { runFrames, runsStore, setMark } from '../run/engine'
import type { Run } from '../run/model'
import { Sparkline, type Marker } from './Sparkline'

/** Step through the camera frames recorded during a run and pin marks to exact frames. */
export function FrameReview({ run }: { run: Run }) {
  useStore(runsStore) // re-render when marks change
  const frames = runFrames.get(run.id)
  const [idx, setIdx] = useState(0)
  const [url, setUrl] = useState<string | null>(null)
  const t0 = run.start?.sentAt

  // Jump to the "visible" mark (or T0) whenever another run is selected.
  useEffect(() => {
    if (!frames?.length) return
    const target = run.visibleAt ?? t0 ?? frames[0].at
    setIdx(nearest(frames, target))
  }, [run.id, frames])

  const frame = frames?.[Math.min(idx, frames.length - 1)]
  useEffect(() => {
    if (!frame) return setUrl(null)
    const u = URL.createObjectURL(frame.blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [frame])

  const points = useMemo(() => (frames ?? []).filter((f) => f.diff != null).map((f) => ({ at: f.at, v: f.diff! })), [frames])

  // Five largest picture changes, as jump targets.
  const peaks = useMemo(() => {
    if (!frames) return []
    return frames
      .map((f, i) => ({ i, d: f.diff ?? 0 }))
      .sort((a, b) => b.d - a.d)
      .filter((p, k, all) => all.slice(0, k).every((q) => Math.abs(frames[q.i].at - frames[p.i].at) > 1000))
      .slice(0, 5)
      .sort((a, b) => a.i - b.i)
  }, [frames])

  if (!frames?.length) {
    return (
      <section className="card">
        <div className="card-head">
          <h2>3 · Frame review</h2>
        </div>
        <p className="hint">
          {run.status === 'done' || run.status === 'aborted' || run.status === 'failed'
            ? 'No camera frames kept for this run (camera was off, or the page was reloaded; frames live in memory for the last 6 runs).'
            : 'Frames appear here when the run finishes.'}
        </p>
      </section>
    )
  }

  const markers: Marker[] = []
  if (t0) markers.push({ at: t0, label: 'T0', color: '--c-start' })
  if (run.release) markers.push({ at: run.release.sentAt, label: 'revert', color: '--c-release' })
  if (run.visibleAt) markers.push({ at: run.visibleAt, label: 'visible', color: '--c-screen', dashed: true })
  if (run.goneAt) markers.push({ at: run.goneAt, label: 'gone', color: '--c-bad', dashed: true })

  const step = (d: number) => setIdx((i) => Math.min(frames.length - 1, Math.max(0, i + d)))

  return (
    <section className="card">
      <div className="card-head">
        <h2>3 · Frame review</h2>
        <span className="muted">
          {frames.length} frames · click the chart or use ← → to step · pin the exact frame
        </span>
      </div>
      <Sparkline
        points={points}
        from={frames[0].at}
        to={frames.at(-1)!.at}
        height={70}
        markers={markers}
        cursor={frame?.at}
        onPick={(at) => setIdx(nearest(frames, at))}
      />
      <div className="review">
        <div className="frame-view" tabIndex={0} onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') step(e.shiftKey ? -10 : -1)
          if (e.key === 'ArrowRight') step(e.shiftKey ? 10 : 1)
        }}>
          {url && <img src={url} alt="Camera frame" />}
          <div className="frame-time">T0 {signedSecs(t0 != null && frame ? frame.at - t0 : null, 3)}</div>
        </div>
        <div className="review-side">
          <input type="range" min={0} max={frames.length - 1} value={idx} onChange={(e) => setIdx(Number(e.target.value))} />
          <div className="row">
            <button onClick={() => step(-10)}>−10</button>
            <button onClick={() => step(-1)}>◀ frame</button>
            <button onClick={() => step(1)}>frame ▶</button>
            <button onClick={() => step(10)}>+10</button>
          </div>
          <div className="row">
            <button className="mark visible" onClick={() => frame && setMark(run.id, 'visible', frame.at, 'frame')}>
              Ad visible from this frame
            </button>
            <button className="mark gone" onClick={() => frame && setMark(run.id, 'gone', frame.at, 'frame')}>
              Ad gone from this frame
            </button>
          </div>
          <div>
            <span className="hint">Biggest picture changes:</span>
            <div className="row wrap">
              {peaks.map((p) => (
                <button key={p.i} className="ghost small" onClick={() => setIdx(p.i)}>
                  T0 {signedSecs(t0 != null ? frames[p.i].at - t0 : null, 2)}
                </button>
              ))}
            </div>
          </div>
          <p className="hint">Pick the first frame where the ad is fully on screen, and the first frame where it is gone.</p>
        </div>
      </div>
    </section>
  )
}

function nearest(frames: { at: number }[], at: number) {
  let best = 0
  for (let i = 0; i < frames.length; i++) if (Math.abs(frames[i].at - at) < Math.abs(frames[best].at - at)) best = i
  return best
}
