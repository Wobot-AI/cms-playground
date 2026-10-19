import type { CmsAdapter } from './types'
import { yodeck } from './yodeck'

/** Add new CMS adapters here (Samsung VXT next). */
export const ADAPTERS: CmsAdapter[] = [yodeck]

export const UPCOMING = ['Samsung VXT']

export type { CmsAdapter } from './types'
