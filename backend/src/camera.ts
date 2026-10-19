import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

/**
 * Browsers cannot play RTSP, so the backend runs one shared ffmpeg that
 * decodes the camera and re-encodes it as a stream of JPEG frames.
 *
 * Every subscriber receives packets of:
 *   [u32 BE jpeg length][f64 BE server epoch ms][jpeg bytes]
 *
 * ffmpeg starts with the first subscriber and stops a few seconds after the
 * last one leaves. If the camera drops while people are watching, it restarts.
 */

type Send = (packet: Uint8Array) => void

const SOI = Buffer.from([0xff, 0xd8])
const EOI = Buffer.from([0xff, 0xd9])

export class CameraRelay {
  private clients = new Set<Send>()
  private ff: ChildProcessWithoutNullStreams | null = null
  private stopTimer: NodeJS.Timeout | null = null
  private pending: Buffer = Buffer.alloc(0)
  private frames = 0
  private lastFrameAt = 0
  private lastError = ''
  private stopping = false

  constructor(private rtspUrl: string | undefined) {}

  get configured() {
    return Boolean(this.rtspUrl)
  }

  subscribe(send: Send): () => void {
    this.clients.add(send)
    if (this.stopTimer) clearTimeout(this.stopTimer)
    this.start()
    return () => {
      if (!this.clients.delete(send)) return
      if (!this.clients.size) this.stopSoon()
    }
  }

  status() {
    return {
      configured: this.configured,
      running: Boolean(this.ff),
      viewers: this.clients.size,
      frames: this.frames,
      lastFrameAt: this.lastFrameAt,
      lastError: this.lastError,
    }
  }

  stop() {
    if (!this.ff) return
    this.stopping = true
    this.ff.kill('SIGTERM')
  }

  private broadcast(jpeg: Buffer) {
    this.frames++
    this.lastFrameAt = Date.now()
    const header = Buffer.alloc(12)
    header.writeUInt32BE(jpeg.length, 0)
    header.writeDoubleBE(this.lastFrameAt, 4)
    const packet = Buffer.concat([header, jpeg])
    for (const send of this.clients) send(packet)
  }

  // ffmpeg's mjpeg output is back-to-back JPEGs. Entropy-coded data
  // byte-stuffs 0xFF, so FFD9 only appears as the end-of-image marker.
  private onData = (chunk: Buffer) => {
    this.pending = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk
    for (;;) {
      const start = this.pending.indexOf(SOI)
      if (start < 0) {
        this.pending = Buffer.alloc(0)
        return
      }
      const end = this.pending.indexOf(EOI, start + 2)
      if (end < 0) {
        if (start > 0) this.pending = this.pending.subarray(start)
        return
      }
      this.broadcast(this.pending.subarray(start, end + 2))
      this.pending = this.pending.subarray(end + 2)
    }
  }

  private start() {
    if (this.ff || !this.rtspUrl) return
    this.lastError = ''
    this.pending = Buffer.alloc(0)
    const ff = spawn('ffmpeg', [
      '-hide_banner', '-loglevel', 'error',
      '-rtsp_transport', 'tcp',
      '-fflags', 'nobuffer', '-flags', 'low_delay',
      '-i', this.rtspUrl,
      '-an',
      '-vf', 'scale=960:-2',
      '-q:v', '6',
      '-f', 'image2pipe', '-vcodec', 'mjpeg',
      'pipe:1',
    ])
    this.ff = ff
    console.log('[camera] ffmpeg started')
    ff.stdout.on('data', this.onData)
    ff.stderr.on('data', (d: Buffer) => {
      this.lastError = d.toString().trim().slice(-500)
    })
    ff.on('error', (e) => {
      this.lastError = `ffmpeg failed to start: ${e.message}`
    })
    ff.on('close', (code) => {
      this.ff = null
      // A deliberate stop exits non-zero too; only report unexpected exits.
      if (code && !this.stopping && !this.lastError) this.lastError = `ffmpeg exited with code ${code}`
      this.stopping = false
      console.log(`[camera] ffmpeg stopped${this.lastError ? `: ${this.lastError}` : ''}`)
      if (this.clients.size) setTimeout(() => this.start(), 2000)
    })
  }

  private stopSoon() {
    if (this.stopTimer) clearTimeout(this.stopTimer)
    this.stopTimer = setTimeout(() => {
      if (!this.clients.size) this.stop()
    }, 5000)
  }
}
