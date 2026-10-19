import { useEffect, useState } from 'react'
import { ADAPTERS, UPCOMING } from './cms'
import { AccessGate } from './components/AccessGate'
import { CameraPanel } from './components/CameraPanel'
import { FrameReview } from './components/FrameReview'
import { LogPanel } from './components/LogPanel'
import { Results } from './components/Results'
import { RunDetail } from './components/RunDetail'
import { SetupPanel } from './components/SetupPanel'
import { needsAccessKey } from './lib/api'
import { useStore } from './lib/store'
import { activeRunId, runsStore } from './run/engine'
import { patchSettings, settingsStore } from './settings'

export function App() {
  const settings = useStore(settingsStore)
  const runs = useStore(runsStore)
  const active = useStore(activeRunId)
  const locked = useStore(needsAccessKey)
  const [selected, setSelected] = useState<string | null>(null)
  const adapter = ADAPTERS.find((a) => a.id === settings.cmsId) ?? ADAPTERS[0]

  // Follow the active run; otherwise keep the user's pick or fall back to the latest run.
  useEffect(() => {
    if (active) setSelected(active)
  }, [active])
  const shownId = selected && runs.some((r) => r.id === selected) ? selected : runs.at(-1)?.id ?? null
  const shown = runs.find((r) => r.id === shownId)

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (activeRunId.get()) e.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])

  return (
    <div className="app">
      {locked && <AccessGate />}
      <header className="topbar">
        <div>
          <h1>CMS Ad Timing Lab</h1>
          <p className="muted">How late does an ad appear, how late does it leave, and when should the revert request go?</p>
        </div>
        <nav className="tabs" aria-label="CMS">
          {ADAPTERS.map((a) => (
            <button
              key={a.id}
              className={a.id === adapter.id ? 'tab active' : 'tab'}
              disabled={Boolean(active)}
              onClick={() => patchSettings({ cmsId: a.id, screenId: '', mediaId: '' })}
            >
              {a.label}
            </button>
          ))}
          {UPCOMING.map((name) => (
            <button key={name} className="tab" disabled title="Adapter not built yet">
              {name} <span className="soon">soon</span>
            </button>
          ))}
        </nav>
      </header>

      <main className="grid-top">
        <SetupPanel adapter={adapter} />
        <CameraPanel />
      </main>

      {shown ? (
        <>
          <FrameReview run={shown} />
          <RunDetail run={shown} />
        </>
      ) : (
        <section className="card empty">
          No runs yet. Pick a screen and an ad, then press <b>Start run</b>.
        </section>
      )}

      <Results selectedId={shownId} onSelect={setSelected} />
      <LogPanel />
    </div>
  )
}
