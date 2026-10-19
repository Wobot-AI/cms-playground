import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CmsAdapter, CmsMedia, CmsScreen } from '../cms/types'
import { log, useStore } from '../lib/store'
import { abortRun, activeRunId, finishRun, releaseNow, runsStore, startRun } from '../run/engine'
import { plannedReleaseOffsetSec, profiles, STRATEGIES, type StrategyKind } from '../run/model'
import { patchSettings, settingsStore } from '../settings'

export function SetupPanel({ adapter }: { adapter: CmsAdapter }) {
  const s = useStore(settingsStore)
  const runs = useStore(runsStore)
  const active = useStore(activeRunId)
  const activeRun = runs.find((r) => r.id === active)
  const [screens, setScreens] = useState<CmsScreen[]>([])
  const [media, setMedia] = useState<CmsMedia[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [sc, me] = await Promise.all([adapter.listScreens(), adapter.listMedia()])
      setScreens(sc)
      setMedia(me)
      const cur = settingsStore.get()
      const patch: Partial<typeof cur> = {}
      if (!sc.some((x) => x.id === cur.screenId)) patch.screenId = (sc.find((x) => x.online) ?? sc[0])?.id ?? ''
      if (!me.some((x) => x.id === cur.mediaId)) {
        const first = me.find((x) => x.kind === 'video') ?? me[0]
        patch.mediaId = first?.id ?? ''
        if (first?.durationSec) patch.adSec = first.durationSec
      }
      patchSettings(patch)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [adapter])

  useEffect(() => {
    setScreens([])
    setMedia([])
    void load()
  }, [load])

  const screen = screens.find((x) => x.id === s.screenId)
  const item = media.find((x) => x.id === s.mediaId)
  const profile = useMemo(
    () => profiles(runs).find((p) => p.cms === adapter.id && p.playerType === screen?.playerType),
    [runs, adapter.id, screen?.playerType],
  )

  const offsetFor = (k: StrategyKind) => plannedReleaseOffsetSec(k, s.adSec, s.leadEstSec, s.releaseEstSec, s.customOffsetSec)
  const offset = offsetFor(s.strategy)
  const expectedOnScreen = offset + s.releaseEstSec - s.leadEstSec
  const backstopTooShort = s.backstop != null && s.backstop > 0 && s.backstop * 60 < offset + s.releaseEstSec + 5

  const start = () => {
    if (!screen || !item) return
    startRun({
      adapter,
      screens: [screen],
      media: item,
      adSec: s.adSec,
      strategy: s.strategy,
      leadEstSec: s.leadEstSec,
      releaseEstSec: s.releaseEstSec,
      customOffsetSec: s.customOffsetSec,
      backstop: adapter.backstop ? s.backstop || null : null,
      screenshotEverySec: s.screenshotEverySec,
    })
  }

  const clearTakeover = async () => {
    if (!screen) return
    log('run', `Clearing any takeover on ${screen.name}`)
    await adapter.stopTakeover([screen.id])
    void load()
  }

  const num = (v: string) => (v === '' ? 0 : Number(v))

  return (
    <section className="card setup">
      <div className="card-head">
        <h2>1 · Set up the run</h2>
        <button className="ghost" onClick={() => void load()} disabled={loading}>
          {loading ? 'Loading…' : 'Reload'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}

      <div className="field-grid">
        <label className="span2">
          Screen
          <select value={s.screenId} onChange={(e) => patchSettings({ screenId: e.target.value })} disabled={Boolean(active)}>
            {screens.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name} · {x.playerType} · {x.online ? 'online' : 'OFFLINE'} {x.takeoverActive ? '· takeover active' : ''}
              </option>
            ))}
          </select>
        </label>
        {screen && (
          <p className="hint span2">
            #{screen.id}
            {screen.normalContent && <> normally plays {screen.normalContent}.</>}
            {screen.takeoverActive && (
              <>
                {' '}
                <b className="warn-text">A takeover is active right now.</b>{' '}
                <button className="link" onClick={() => void clearTakeover()} disabled={Boolean(active)}>
                  Clear it
                </button>
              </>
            )}
          </p>
        )}

        <label className="span2">
          Ad (media)
          <select
            value={s.mediaId}
            disabled={Boolean(active)}
            onChange={(e) => {
              const m = media.find((x) => x.id === e.target.value)
              patchSettings({ mediaId: e.target.value, ...(m?.durationSec ? { adSec: m.durationSec } : {}) })
            }}
          >
            {media.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} · {m.kind}
                {m.durationSec ? ` · ${m.durationSec} s` : ''}
              </option>
            ))}
          </select>
        </label>

        <label>
          Ad length D (s)
          <input type="number" min={1} step={1} value={s.adSec} disabled={Boolean(active)} onChange={(e) => patchSettings({ adSec: num(e.target.value) })} />
        </label>
        <label>
          Screenshot every (s)
          <input
            type="number"
            min={0}
            step={1}
            value={s.screenshotEverySec}
            disabled={Boolean(active) || !adapter.captureScreenshot}
            onChange={(e) => patchSettings({ screenshotEverySec: num(e.target.value) })}
          />
        </label>
        <label>
          Expected lead-in (s)
          <input type="number" min={0} step={0.1} value={s.leadEstSec} disabled={Boolean(active)} onChange={(e) => patchSettings({ leadEstSec: num(e.target.value) })} />
        </label>
        <label>
          Expected release delay (s)
          <input type="number" min={0} step={0.1} value={s.releaseEstSec} disabled={Boolean(active)} onChange={(e) => patchSettings({ releaseEstSec: num(e.target.value) })} />
        </label>
        {profile && (profile.leadIn != null || profile.releaseDelay != null) && (
          <p className="hint span2">
            Measured on {profile.playerType} ({profile.runs} run{profile.runs > 1 ? 's' : ''}): lead-in ≈ {fmt(profile.leadIn)}, release delay ≈ {fmt(profile.releaseDelay)}.{' '}
            <button
              className="link"
              disabled={Boolean(active)}
              onClick={() =>
                patchSettings({
                  ...(profile.leadIn != null ? { leadEstSec: round1(profile.leadIn / 1000) } : {}),
                  ...(profile.releaseDelay != null ? { releaseEstSec: round1(profile.releaseDelay / 1000) } : {}),
                })
              }
            >
              Use as expected
            </button>
          </p>
        )}
        {adapter.backstop && (
          <label>
            {adapter.backstop.label}
            <input
              type="number"
              min={0}
              step={1}
              value={s.backstop ?? 0}
              disabled={Boolean(active)}
              onChange={(e) => patchSettings({ backstop: num(e.target.value) || null })}
            />
          </label>
        )}
        {s.strategy === 'custom' && (
          <label>
            Custom revert offset X (s)
            <input type="number" min={0} step={0.1} value={s.customOffsetSec} disabled={Boolean(active)} onChange={(e) => patchSettings({ customOffsetSec: num(e.target.value) })} />
          </label>
        )}
      </div>

      <fieldset className="strategies" disabled={Boolean(active)}>
        <legend>When should the revert request go?</legend>
        {(Object.keys(STRATEGIES) as StrategyKind[]).map((k) => (
          <label key={k} className={s.strategy === k ? 'strategy selected' : 'strategy'}>
            <input type="radio" name="strategy" checked={s.strategy === k} onChange={() => patchSettings({ strategy: k })} />
            <span className="strategy-title">
              {STRATEGIES[k].label} <code>{STRATEGIES[k].formula}</code>
              <b className="offset">T0 + {offsetFor(k).toFixed(1)} s</b>
            </span>
            <span className="hint">{STRATEGIES[k].help}</span>
          </label>
        ))}
      </fieldset>

      <p className="plan">
        Revert goes at <b>T0 + {offset.toFixed(1)} s</b>. With expected lead-in {s.leadEstSec} s and expected release delay {s.releaseEstSec} s the ad should be visible for about{' '}
        <b>{expectedOnScreen.toFixed(1)} s</b> of {s.adSec} s ({signed(expectedOnScreen - s.adSec)}).
      </p>
      {backstopTooShort && <p className="error">The backstop ends before the revert. Raise it or the CMS will cut the ad.</p>}

      <div className="actions">
        {!active ? (
          <button className="primary" onClick={start} disabled={!screen || !item || loading}>
            Start run
          </button>
        ) : (
          <>
            <span className="pill live">Run in progress · {activeRun?.status}</span>
            <button onClick={() => void releaseNow()} disabled={Boolean(activeRun?.release)}>
              Revert now
            </button>
            <button onClick={() => finishRun()} disabled={!activeRun?.release}>
              Finish
            </button>
            <button className="danger" onClick={() => void abortRun()}>
              Abort
            </button>
          </>
        )}
      </div>
      {adapter.notes && (
        <details className="notes">
          <summary>{adapter.label} notes</summary>
          <ul>
            {adapter.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}

const round1 = (x: number) => Math.round(x * 10) / 10
const fmt = (ms: number | null) => (ms == null ? '—' : `${(ms / 1000).toFixed(1)} s`)
const signed = (x: number) => (x > 0.05 ? `+${x.toFixed(1)} s overrun` : x < -0.05 ? `${x.toFixed(1)} s cut` : 'on time')
