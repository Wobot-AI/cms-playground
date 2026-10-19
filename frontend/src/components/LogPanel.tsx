import { useState } from 'react'
import { clock, logStore, useStore, type LogSource } from '../lib/store'

const SOURCES: LogSource[] = ['api', 'run', 'mark', 'camera', 'screenshot']

export function LogPanel() {
  const entries = useStore(logStore)
  const [hidden, setHidden] = useState<Set<LogSource>>(new Set())
  const shown = entries.filter((e) => !hidden.has(e.source)).slice().reverse()

  return (
    <section className="card">
      <div className="card-head">
        <h2>Event log</h2>
        <div className="row">
          {SOURCES.map((s) => (
            <label key={s} className="inline small">
              <input
                type="checkbox"
                checked={!hidden.has(s)}
                onChange={() =>
                  setHidden((h) => {
                    const n = new Set(h)
                    if (n.has(s)) n.delete(s)
                    else n.add(s)
                    return n
                  })
                }
              />
              {s}
            </label>
          ))}
          <button className="ghost small" onClick={() => logStore.set([])}>
            Clear
          </button>
        </div>
      </div>
      <div className="log">
        {shown.length === 0 && <div className="hint">Nothing yet.</div>}
        {shown.map((e) => (
          <div key={e.id} className={`log-line ${e.level}`}>
            <span className="log-time">{clock(e.at)}</span>
            <span className={`log-src src-${e.source}`}>{e.source}</span>
            {e.data ? (
              <details>
                <summary>{e.msg}</summary>
                <pre>{JSON.stringify(e.data, null, 2)}</pre>
              </details>
            ) : (
              <span>{e.msg}</span>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
