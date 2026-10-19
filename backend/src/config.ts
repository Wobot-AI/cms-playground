/** All settings come from environment variables (see .env.example). */
export const config = {
  port: Number(process.env.PORT ?? 8787),
  /** Shared secret the frontend must send as `Authorization: Bearer <key>`. Empty = no auth (local dev only). */
  accessKey: process.env.ACCESS_KEY ?? '',
  /** Comma-separated frontend origins allowed to call this API, e.g. https://ad-timing.vercel.app */
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5317')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  yodeck: {
    token: process.env.YODECK_API_TOKEN ?? '',
    baseUrl: (process.env.YODECK_BASE_URL ?? 'https://app.yodeck.com/api/v2').replace(/\/$/, ''),
  },
  cameraRtspUrl: process.env.CAMERA_RTSP_URL || undefined,
}
