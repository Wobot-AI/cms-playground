import { createStore } from './lib/store'
import type { StrategyKind } from './run/model'

export interface Settings {
  cmsId: string
  screenId: string
  mediaId: string
  adSec: number
  strategy: StrategyKind
  /** Estimates used to plan the revert. Defaults are the client sheet's 5 s lead-in. */
  leadEstSec: number
  releaseEstSec: number
  customOffsetSec: number
  backstop: number | null
  screenshotEverySec: number
}

const KEY = 'cms-playground.settings'

const DEFAULTS: Settings = {
  cmsId: 'yodeck',
  screenId: '',
  mediaId: '',
  adSec: 20,
  strategy: 'compensated',
  leadEstSec: 5,
  releaseEstSec: 3,
  customOffsetSec: 22,
  backstop: 5,
  screenshotEverySec: 5,
}

function load(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    return DEFAULTS
  }
}

export const settingsStore = createStore<Settings>(load())

settingsStore.subscribe(() => {
  try {
    localStorage.setItem(KEY, JSON.stringify(settingsStore.get()))
  } catch {
    /* ignore */
  }
})

export const patchSettings = (p: Partial<Settings>) => settingsStore.set((s) => ({ ...s, ...p }))
