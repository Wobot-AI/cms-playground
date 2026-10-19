# CMS Ad Timing Lab

Measures how late an ad appears after a CMS takeover request (**lead-in**) and how late it
leaves after the revert request (**release delay**), then tells you when to send the revert
so a D-second ad is on screen for exactly D seconds:

```
revert at = T0 + lead-in + D − release delay        (T0 = takeover request sent)
```

## Layout

```
frontend/   Vite + React UI           → deploy to Vercel
backend/    Hono API on Node + ffmpeg → deploy to a VM
```

The backend exists because the browser can't do three things itself:
- keep the Yodeck API token secret (it stays in the backend's environment),
- call Yodeck and read screenshot timestamps (blocked cross-origin),
- play the RTSP camera (ffmpeg turns it into a stream of timestamped JPEG frames).

| Backend route | Purpose |
|---|---|
| `GET /health` | Liveness check, no auth |
| `/api/yodeck/*` | Yodeck API with the token attached. Only the calls the UI needs are allowed. |
| `GET /api/yodeck/screenshot-info?url=` | Upload time of a Yodeck screenshot |
| `GET /camera/stream` | Never-ending stream of `[u32 length][f64 time][jpeg]` frames |
| `GET /camera/status` | ffmpeg / viewer status |

## Local development

Needs Node ≥ 22.9 and `ffmpeg` on the PATH.

```bash
cp backend/.env.example backend/.env   # fill in YODECK_API_TOKEN and CAMERA_RTSP_URL
npm install
npm run dev                            # backend :8787 + frontend http://localhost:5317
```

In dev, Vite forwards `/api` and `/camera` to the backend, and `ACCESS_KEY` can stay empty.

## Deploying

### Backend on a VM

Set these environment variables (see `backend/.env.example`):

| Variable | Example |
|---|---|
| `ACCESS_KEY` | a long random string, **required on a public server** |
| `ALLOWED_ORIGINS` | `https://your-app.vercel.app` |
| `YODECK_API_TOKEN` | Yodeck API token |
| `CAMERA_RTSP_URL` | `rtsp://…` |
| `PORT` | `8787` |

With Docker (includes ffmpeg):

```bash
cd backend
docker build -t ad-timing-backend .
docker run -d --restart unless-stopped -p 8787:8787 --env-file .env ad-timing-backend
```

Or directly with Node: `npm install && npm run build && npm start` inside `backend/`
(ffmpeg must be installed on the VM).

**HTTPS is required**: a page served from Vercel (https) cannot call an http backend.
Put a reverse proxy with TLS in front, e.g. Caddy:

```
api.example.com {
    reverse_proxy localhost:8787 {
        flush_interval -1    # don't buffer the camera stream
    }
}
```

### Frontend on Vercel

- Root directory: `frontend`
- Build command: `npm run build`, output directory: `dist`
- Backend URL comes from `frontend/.env.production`
  (`VITE_API_BASE_URL=https://cms-playground.wobot.ai`). A `VITE_API_BASE_URL` set in the
  Vercel dashboard overrides it.

On first visit the page asks for the access key and keeps it in that browser.

## A run

1. Pick screen, ad, and a revert strategy (at D, after lead-in, compensated, custom).
2. **Start run** sends the takeover; the revert is sent automatically at the planned time.
3. After the run, both marks get an automatic guess from the biggest picture change
   inside the box (shown as `auto-guess`).
4. **Frame review** lets you pin both marks to the exact camera frame.
5. **Compare runs** shows per-player medians and the recommended revert time.

Runs are kept in the browser's localStorage. Export CSV/JSON from the Compare section.
