import { clock, secs, signedSecs } from '../lib/store'
import { metrics, STRATEGIES, type Run, type StrategyKind } from '../run/model'
import { Timeline } from './Timeline'

export function RunDetail({ run }: { run: Run }) {
  const m = metrics(run)
  const t0 = run.start?.sentAt
  const D = run.adSec * 1000
  const L = m.leadIn
  const R = m.releaseDelay

  // Replay this run's measured delays under every strategy.
  const whatIf = (Object.keys(STRATEGIES) as StrategyKind[])
    .filter((k) => k !== 'custom')
    .map((k) => {
      const offset = k === 'naive' ? D : k === 'after-lead-in' ? (L ?? 0) + D : (L ?? 0) + D - (R ?? 0)
      const onScreen = L != null && R != null ? offset + R - L : null
      return { k, offset, onScreen, delta: onScreen != null ? onScreen - D : null }
    })

  return (
    <section className="card">
      <div className="card-head">
        <h2>4 · Run result</h2>
        <span className="muted">
          {run.cmsLabel} · {run.screenName} ({run.playerType}) · {run.mediaName} · {STRATEGIES[run.strategy].label} ·{' '}
          <span className={`pill ${run.status}`}>{run.status}</span>
        </span>
      </div>
      {run.error && <p className="error">{run.error}</p>}

      <Timeline run={run} />

      <div className="detail-grid">
        <div>
          <h3>Sheet view</h3>
          <table className="sheet">
            <tbody>
              <tr>
                <th>Ad duration</th>
                <td>{run.adSec} seconds long</td>
                <td />
              </tr>
              <tr>
                <th>Ad start request</th>
                <td className="num">{clock(t0)}</td>
                <td className="muted">API answered in {secs(m.startRtt)}</td>
              </tr>
              <tr>
                <th>Ad starts playing</th>
                <td className="num">{clock(run.visibleAt)}</td>
                <td className="muted">
                  measured lead-in {secs(L)} <Source s={run.visibleSource} />
                </td>
              </tr>
              <tr>
                <th>Ad should end</th>
                <td className="num">{clock(run.visibleAt != null ? run.visibleAt + D : null)}</td>
                <td className="muted">starts playing + D</td>
              </tr>
              <tr>
                <th>Revert request sent</th>
                <td className="num">{clock(run.release?.sentAt)}</td>
                <td className="muted">T0 + {secs(m.usedOffset)}</td>
              </tr>
              <tr>
                <th>Ad actually ends</th>
                <td className="num">{clock(run.goneAt)}</td>
                <td className="muted">
                  measured release delay {secs(R)} <Source s={run.goneSource} />
                </td>
              </tr>
              <tr className="total">
                <th>Visible for</th>
                <td className="num">{secs(m.onScreen)}</td>
                <td className={deltaClass(m.delta)}>{deltaText(m.delta)}</td>
              </tr>
              <tr className="total">
                <th>Revert should go at</th>
                <td className="num">{clock(t0 != null && m.idealOffset != null ? t0 + m.idealOffset : null)}</td>
                <td className="muted">T0 + {secs(m.idealOffset)} = measured lead-in + D − measured release delay</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div>
          <h3>Same delays, other revert times</h3>
          {L == null || R == null ? (
            <p className="hint">Needs both marks (ad visible and ad gone) to compare.</p>
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>Revert at</th>
                  <th className="num">Sent at</th>
                  <th className="num">Visible for</th>
                  <th className="num">vs D</th>
                </tr>
              </thead>
              <tbody>
                {whatIf.map((w) => (
                  <tr key={w.k} className={w.k === run.strategy ? 'current' : undefined}>
                    <td>
                      {STRATEGIES[w.k].label} <code>{STRATEGIES[w.k].formula}</code>
                    </td>
                    <td className="num">{t0 != null ? clock(t0 + w.offset) : '—'}</td>
                    <td className="num">{secs(w.onScreen)}</td>
                    <td className={`num ${deltaClass(w.delta)}`}>{signedSecs(w.delta)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="hint">Assumes the measured lead-in and measured release delay of this run would repeat.</p>

          {run.screenshots.length > 0 && (
            <>
              <h3>CMS screenshots</h3>
              <div className="shots">
                {run.screenshots.map((s) => (
                  <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="shot">
                    <img src={s.url} alt="" loading="lazy" />
                    <span>
                      asked T0 {signedSecs(t0 != null ? s.requestedAt - t0 : null, 1)}
                      {s.imageAt && t0 != null ? ` · image T0 ${signedSecs(s.imageAt - t0, 0)}` : ''}
                    </span>
                  </a>
                ))}
              </div>
              <p className="hint">Screenshots are evidence of what the player reported, not timing: the upload time has 1 s resolution and lags the screen.</p>
            </>
          )}
        </div>
      </div>
    </section>
  )
}

function Source({ s }: { s?: string }) {
  if (!s) return null
  const label = { live: 'button', frame: 'frame-picked', auto: 'auto-guess' }[s] ?? s
  return <span className={`src src-${s}`}>{label}</span>
}

export function deltaClass(d: number | null) {
  if (d == null) return 'muted'
  if (Math.abs(d) <= 500) return 'good'
  return d < 0 ? 'bad' : 'warn'
}

export function deltaText(d: number | null) {
  if (d == null) return '—'
  if (Math.abs(d) <= 500) return `on time (${signedSecs(d)})`
  return d < 0 ? `cut short by ${secs(-d)}` : `overran by ${secs(d)}`
}
