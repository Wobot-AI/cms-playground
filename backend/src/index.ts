import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { bearerAuth } from 'hono/bearer-auth'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { CameraRelay } from './camera.js'
import { config } from './config.js'
import { yodeck } from './yodeck.js'

const camera = new CameraRelay(config.cameraRtspUrl)
const app = new Hono()

app.use('*', logger())
app.use(
  '*',
  cors({
    origin: config.allowedOrigins,
    allowHeaders: ['Authorization', 'Content-Type'],
    allowMethods: ['GET', 'HEAD', 'POST', 'PUT', 'OPTIONS'],
    maxAge: 600,
  }),
)

app.get('/health', (c) => c.json({ ok: true }))

if (config.accessKey) {
  const auth = bearerAuth({ token: config.accessKey })
  app.use('/api/*', auth)
  app.use('/camera/*', auth)
} else {
  console.warn('[auth] ACCESS_KEY is not set: the API is open. Fine on localhost, never on a public server.')
}

app.route('/api/yodeck', yodeck)

app.get('/camera/status', (c) => c.json(camera.status()))

/** Never-ending binary stream of timestamped JPEG frames (see camera.ts). */
app.get('/camera/stream', (c) => {
  if (!camera.configured) return c.text('CAMERA_RTSP_URL is not set on the backend', 503)
  let unsubscribe = () => {}
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      unsubscribe = camera.subscribe((packet) => {
        // Slow viewer: drop frames instead of buffering without limit.
        if ((controller.desiredSize ?? 0) < -30) return
        try {
          controller.enqueue(packet)
        } catch {
          unsubscribe()
        }
      })
    },
    cancel() {
      unsubscribe()
    },
  })
  c.req.raw.signal.addEventListener('abort', () => unsubscribe())
  return c.body(stream, 200, {
    'Content-Type': 'application/octet-stream',
    'Cache-Control': 'no-store',
    'X-Accel-Buffering': 'no',
  })
})

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`Backend listening on http://localhost:${info.port}`)
  console.log(`Allowed frontend origins: ${config.allowedOrigins.join(', ')}`)
})

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    camera.stop()
    server.close()
    process.exit(0)
  })
}
