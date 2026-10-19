/**
 * The contract every CMS (Yodeck, Samsung VXT, ...) implements. The run engine
 * and UI only talk to this interface, so adding a CMS means adding one adapter.
 */

export interface CmsScreen {
  id: string
  name: string
  /** Hardware/OS family, e.g. "Tizen", "BrightSign". Latencies are grouped by this. */
  playerType: string
  online: boolean
  /** What the screen normally plays, for display only. */
  normalContent?: string
  takeoverActive: boolean
}

export interface CmsMedia {
  id: string
  name: string
  kind: string
  /** Natural length of the media in seconds, if the CMS knows it. */
  durationSec: number | null
  thumbnailUrl?: string
}

/** Timing of one API call, measured in the browser. */
export interface ApiCall {
  sentAt: number
  respondedAt: number
  ok: boolean
  status: number
  body?: unknown
  error?: string
}

export interface Screenshot {
  /** When we asked the CMS for a fresh screenshot. */
  requestedAt: number
  /** When the image was produced/uploaded, if the CMS tells us (second precision). */
  imageAt: number | null
  url: string
}

export interface TakeoverOptions {
  /**
   * CMS-side safety timer. If our page dies mid-run the CMS still ends the
   * takeover. Units are CMS specific (Yodeck: whole minutes, min 5). null = none.
   */
  backstop: number | null
}

export interface CmsAdapter {
  id: string
  label: string
  /** Notes shown in the UI about this CMS's quirks. */
  notes?: string[]
  backstop?: { label: string; default: number | null; min?: number }
  listScreens(): Promise<CmsScreen[]>
  listMedia(): Promise<CmsMedia[]>
  startTakeover(screenIds: string[], mediaId: string, opts: TakeoverOptions): Promise<ApiCall>
  stopTakeover(screenIds: string[]): Promise<ApiCall>
  /** Ask the player for a fresh screenshot and resolve once a new image is available. */
  captureScreenshot?(screenId: string, previous?: Screenshot): Promise<Screenshot | null>
}
