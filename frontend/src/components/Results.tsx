import { useMemo, useState } from 'react'
import { secs, signedSecs, useStore } from '../lib/store'
import { clearRuns, deleteRun, runsStore } from '../run/engine'
import { metrics, profiles, STRATEGIES, type Run } from '../run/model'
import { patchSettings, settingsStore } from '../settings'
import { deltaClass } from './RunDetail'

export function Results({ selectedId, onSelect }: { selectedId: string | null; onSelect: (id: string) => void }) {
  const runs = useStore(runsStore)
  const settings = useStore(settingsStore)
  const [adSec, setAdSec] = useState(20)
  const profs = useMemo(() => profiles(runs), [runs])

  const exportCsv = () => {
    const cols = [
      'run', 'started', 'cms', 'screen', 'player', 'media', 'ad_s', 'strategy', 'expected_lead_in_s', 'expected_release_delay_s', 'planned_revert_s',
      'measured_lead_in_s', 'measured_release_delay_s', 'visible_for_s', 'delta_s', 'ideal_revert_s', 'start_rtt_s', 'release_rtt_s',
      'visible_mark', 'gone_mark', 'status',
    ]
    const s = (ms: number | null) => (ms == null ? '' : (ms / 1000).toFixed(3))
    const rows = runs.map((r, i) => {
      const m = metrics(r)
      return [
        i + 1, new Date(r.start?.sentAt ?? r.createdAt).toISOString(), r.cmsLabel, r.screenName, r.playerType, r.mediaName, r.adSec,
        r.strategy, r.leadEstSec, r.releaseEstSec, r.releaseOffsetSec, s(m.leadIn), s(m.releaseDelay), s(m.onScreen), s(m.delta), s(m.idealOffset),
        s(m.startRtt), s(m.releaseRtt), r.visibleSource ?? '', r.goneSource ?? '', r.status,
      ]
    })
    download('ad-timing-runs.csv', [cols, ...rows].map((r) => r.map(csvCell).join(',')).join('\n'), 'text/csv')
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>5 · Compare runs</h2>
        <div className="row">
          <button className="ghost" onClick={exportCsv} disabled={!runs.length}>
            Export CSV
          </button>
          <button className="ghost" onClick={() => download('ad-timing-runs.json', JSON.stringify(runs, null, 2), 'application/json')} disabled={!runs.length}>
            Export JSON
          </button>
          <button className="ghost danger" disabled={!runs.length} onClick={() => confirm('Delete all recorded runs?') && clearRuns()}>
            Clear
          </button>
        </div>
      </div>

      {profs.length > 0 && (
        <>
          <div className="row">
            <h3>Recommendation</h3>
            <label className="inline">
              for a
              <input type="number" min={1} value={adSec} onChange={(e) => setAdSec(Number(e.target.value) || 1)} />s ad
            </label>
          </div>
          <div className="recs">
            {profs.map((p) => {
              const ready = p.leadIn != null && p.releaseDelay != null
              const offset = ready ? (p.leadIn! + adSec * 1000 - p.releaseDelay!) / 1000 : null
              return (
                <div key={`${p.cms}|${p.playerType}`} className="rec">
                  <div className="rec-head">
                    {p.cmsLabel} · {p.playerType} <span className="muted">({p.runs} run{p.runs > 1 ? 's' : ''})</span>
                  </div>
                  {ready ? (
                    <>
                      <div className="rec-big">
                        Send revert at <b>T0 + {offset!.toFixed(1)} s</b>
                      </div>
                      <div className="hint">
                        measured lead-in ≈ {secs(p.leadIn, 1)} ({range(p.leadSpread)}) · measured release delay ≈ {secs(p.releaseDelay, 1)} ({range(p.releaseSpread)})
                        <br />
                        i.e. {p.leadIn! > p.releaseDelay! ? 'later' : 'earlier'} than “T0 + D” by {Math.abs((p.leadIn! - p.releaseDelay!) / 1000).toFixed(1)} s
                      </div>
                      {p.cms === settings.cmsId && (
                        <button
                          className="link"
                          onClick={() =>
                            patchSettings({
                              leadEstSec: Math.round(p.leadIn! / 100) / 10,
                              releaseEstSec: Math.round(p.releaseDelay! / 100) / 10,
                              strategy: 'compensated',
                            })
                          }
                        >
                          Use for next run
                        </button>
                      )}
                    </>
                  ) : (
                    <div className="hint">Needs runs with both marks.</div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      {runs.length === 0 ? (
        <p className="hint">Runs you make show up here, newest last.</p>
      ) : (
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>#</th>
                <th>Time</th>
                <th>Screen</th>
                <th>Ad</th>
                <th>Revert strategy</th>
                <th className="num">Revert at</th>
                <th className="num">Measured lead-in</th>
                <th className="num">Measured release delay</th>
                <th className="num">Visible for</th>
                <th className="num">vs D</th>
                <th className="num">Ideal revert</th>
                <th>Marks</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {runs.map((r, i) => (
                <RunRow key={r.id} r={r} n={i + 1} selected={r.id === selectedId} onSelect={() => onSelect(r.id)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function RunRow({ r, n, selected, onSelect }: { r: Run; n: number; selected: boolean; onSelect: () => void }) {
  const m = metrics(r)
  return (
    <tr className={selected ? 'current clickable' : 'clickable'} onClick={onSelect}>
      <td>{n}</td>
      <td className="nowrap">{new Date(r.start?.sentAt ?? r.createdAt).toLocaleTimeString()}</td>
      <td>
        {r.screenName} <span className="muted">{r.playerType}</span>
      </td>
      <td>
        {r.mediaName} <span className="muted">{r.adSec} s</span>
      </td>
      <td>{STRATEGIES[r.strategy].label}</td>
      <td className="num">+{secs(m.usedOffset ?? r.releaseOffsetSec * 1000, 1)}</td>
      <td className="num">{secs(m.leadIn)}</td>
      <td className="num">{secs(m.releaseDelay)}</td>
      <td className="num">{secs(m.onScreen)}</td>
      <td className={`num ${deltaClass(m.delta)}`}>{signedSecs(m.delta)}</td>
      <td className="num">+{secs(m.idealOffset, 1)}</td>
      <td className="nowrap muted">
        {r.visibleSource ?? '—'} / {r.goneSource ?? '—'}
        {r.status !== 'done' && <span className={`pill ${r.status}`}>{r.status}</span>}
      </td>
      <td>
        <button
          className="ghost small"
          title="Delete run"
          onClick={(e) => {
            e.stopPropagation()
            deleteRun(r.id)
          }}
        >
          ✕
        </button>
      </td>
    </tr>
  )
}

const range = (s: [number, number] | null) => (s ? `${(s[0] / 1000).toFixed(1)}–${(s[1] / 1000).toFixed(1)} s` : '—')
const csvCell = (v: unknown) => {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function download(name: string, text: string, type: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type }))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
