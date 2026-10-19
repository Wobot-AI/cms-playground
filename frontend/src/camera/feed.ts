import { apiFetch } from '../lib/api'
import { createStore, log, now } from '../lib/store'

/**
 * Client for the backend's camera relay (backend/src/camera.ts).
 *
 * Every frame is stamped with the browser clock on arrival, the same clock the
 * API calls use, so camera events and API events share one timeline. Frames
 * are kept as JPEG blobs so a run can be scrubbed frame by frame afterwards.
 */

export interface Frame {
  /** Browser receipt time (ms epoch). */
  at: number
  /** Backend time the frame left ffmpeg. */
  serverAt: number
  blob: Blob
  /** Mean absolute change vs the previous frame inside the ROI, 0..255. */
  diff: number | null
}

/** Region of interest in normalized 0..1 coordinates (the TV in the camera image). */
export interface Roi {
  x: number
  y: number
  w: number
  h: number
}

export interface FeedState {
  status: 'idle' | 'connecting' | 'live' | 'error'
  error?: string
  fps: number
  width: number
  height: number
  lastFrameAt: number
  recording: boolean
}

const PREROLL_MS = 15_000
const ROI_KEY = 'cms-playground.roi'
const DIFF_W = 64
const DIFF_H = 36

function loadRoi(): Roi {
  try {
    const r = JSON.parse(localStorage.getItem(ROI_KEY) ?? 'null')
    if (r && typeof r.x === 'number') return r
  } catch {
    /* storage unavailable */
  }
  return { x: 0, y: 0, w: 1, h: 1 }
}

class CameraFeed {
  state = createStore<FeedState>({ status: 'idle', fps: 0, width: 0, height: 0, lastFrameAt: 0, recording: false })
  roi = createStore<Roi>(loadRoi())

  private frames: Frame[] = []
  private recordFrom: number | null = null
  private abort: AbortController | null = null
  private latest: ImageBitmap | null = null
  private drawListeners = new Set<(b: ImageBitmap) => void>()
  private frameListeners = new Set<(f: Frame) => void>()
  private prevGray: Float32Array | null = null
  private small = new OffscreenCanvas(DIFF_W, DIFF_H)
  private smallCtx = this.small.getContext('2d', { willReadFrequently: true })!
  private decoding = false
  private arrivals: number[] = []

  constructor() {
    this.roi.subscribe(() => {
      this.prevGray = null
      try {
        localStorage.setItem(ROI_KEY, JSON.stringify(this.roi.get()))
      } catch {
        /* storage unavailable */
      }
    })
  }

  get latestBitmap() {
    return this.latest
  }

  onDraw(l: (b: ImageBitmap) => void) {
    this.drawListeners.add(l)
    return () => {
      this.drawListeners.delete(l)
    }
  }

  onFrame(l: (f: Frame) => void) {
    this.frameListeners.add(l)
    return () => {
      this.frameListeners.delete(l)
    }
  }

  async connect() {
    if (this.abort) return
    const abort = new AbortController()
    this.abort = abort
    this.patch({ status: 'connecting', error: undefined })
    log('camera', 'Connecting to camera relay…')
    try {
      const res = await apiFetch('/camera/stream', { signal: abort.signal, cache: 'no-store' })
      if (!res.ok || !res.body) throw new Error(`relay answered ${res.status}: ${await res.text()}`)
      await this.read(res.body.getReader())
      if (!abort.signal.aborted) throw new Error('stream ended')
    } catch (e) {
      if (abort.signal.aborted) return
      const msg = e instanceof Error ? e.message : String(e)
      this.patch({ status: 'error', error: msg })
      log('camera', `Camera stream error: ${msg}`, { level: 'error' })
      try {
        const st = await (await apiFetch('/camera/status')).json()
        if (st.lastError) log('camera', `ffmpeg: ${st.lastError}`, { level: 'error' })
      } catch {
        /* ignore */
      }
    } finally {
      if (this.abort === abort) this.abort = null
    }
  }

  disconnect() {
    this.abort?.abort()
    this.abort = null
    this.patch({ status: 'idle', fps: 0 })
    log('camera', 'Camera disconnected')
  }

  /** Keep every frame from `from` until stopRecording(). */
  startRecording(from = now()) {
    this.recordFrom = from - 3000
    this.patch({ recording: true })
  }

  stopRecording(): Frame[] {
    const from = this.recordFrom ?? now()
    this.recordFrom = null
    this.patch({ recording: false })
    return this.frames.filter((f) => f.at >= from)
  }

  private patch(p: Partial<FeedState>) {
    this.state.set((s) => ({ ...s, ...p }))
  }

  private async read(reader: ReadableStreamDefaultReader<Uint8Array>) {
    let buf = new Uint8Array(0)
    for (;;) {
      const { value, done } = await reader.read()
      if (done) return
      const arrivedAt = now()
      const merged = new Uint8Array(buf.length + value.length)
      merged.set(buf)
      merged.set(value, buf.length)
      buf = merged
      let off = 0
      while (buf.length - off >= 12) {
        const view = new DataView(buf.buffer, buf.byteOffset + off, 12)
        const len = view.getUint32(0)
        if (buf.length - off < 12 + len) break
        const serverAt = view.getFloat64(4)
        const jpeg = buf.slice(off + 12, off + 12 + len)
        off += 12 + len
        this.ingest({ at: arrivedAt, serverAt, blob: new Blob([jpeg], { type: 'image/jpeg' }), diff: null })
      }
      buf = buf.slice(off)
    }
  }

  private ingest(frame: Frame) {
    this.frames.push(frame)
    // Keep a rolling pre-roll, plus everything since recording started.
    const cutoff = Math.min(this.recordFrom ?? Infinity, frame.at - PREROLL_MS)
    const firstKept = this.frames.findIndex((f) => f.at >= cutoff)
    if (firstKept > 0) this.frames.splice(0, firstKept)

    this.arrivals.push(frame.at)
    while (this.arrivals.length && this.arrivals[0] < frame.at - 2000) this.arrivals.shift()
    const fps = this.arrivals.length / 2
    const s = this.state.get()
    if (s.status !== 'live' || Math.abs(s.fps - fps) >= 0.5 || frame.at - s.lastFrameAt > 500) {
      this.patch({ status: 'live', fps, lastFrameAt: frame.at })
    }
    void this.decode(frame)
  }

  /** Decode the newest frame for display and the change score. Drops frames if decoding lags. */
  private async decode(frame: Frame) {
    if (this.decoding) {
      frame.diff = null
      this.frameListeners.forEach((l) => l(frame))
      return
    }
    this.decoding = true
    try {
      const bmp = await createImageBitmap(frame.blob)
      if (!this.state.get().width) this.patch({ width: bmp.width, height: bmp.height })
      frame.diff = this.changeScore(bmp)
      this.latest?.close()
      this.latest = bmp
      this.drawListeners.forEach((l) => l(bmp))
      this.frameListeners.forEach((l) => l(frame))
    } catch {
      /* corrupt frame, skip */
    } finally {
      this.decoding = false
    }
  }

  private changeScore(bmp: ImageBitmap): number | null {
    const r = this.roi.get()
    this.smallCtx.drawImage(bmp, r.x * bmp.width, r.y * bmp.height, r.w * bmp.width, r.h * bmp.height, 0, 0, DIFF_W, DIFF_H)
    const px = this.smallCtx.getImageData(0, 0, DIFF_W, DIFF_H).data
    const gray = new Float32Array(DIFF_W * DIFF_H)
    for (let i = 0; i < gray.length; i++) gray[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]
    const prev = this.prevGray
    this.prevGray = gray
    if (!prev) return null
    let sum = 0
    for (let i = 0; i < gray.length; i++) sum += Math.abs(gray[i] - prev[i])
    return sum / gray.length
  }
}

export const camera = new CameraFeed()
