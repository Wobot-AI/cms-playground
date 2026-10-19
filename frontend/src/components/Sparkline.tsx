import { useEffect, useRef } from 'react'

export interface Marker {
  at: number
  label: string
  color: string
  dashed?: boolean
}

/** Canvas line chart of a time series, with optional vertical markers. */
export function Sparkline({
  points,
  from,
  to,
  height = 60,
  markers = [],
  cursor,
  onPick,
}: {
  points: { at: number; v: number }[]
  from: number
  to: number
  height?: number
  markers?: Marker[]
  cursor?: number
  onPick?: (at: number) => void
}) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const c = ref.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    const w = c.clientWidth
    c.width = w * dpr
    c.height = height * dpr
    const ctx = c.getContext('2d')!
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, w, height)
    const css = getComputedStyle(c)
    const span = Math.max(1, to - from)
    const x = (at: number) => ((at - from) / span) * w
    const max = Math.max(8, ...points.map((p) => p.v))
    const y = (v: number) => height - 4 - (v / max) * (height - 8)

    ctx.strokeStyle = css.getPropertyValue('--line').trim() || '#888'
    ctx.lineWidth = 1.25
    ctx.beginPath()
    points.forEach((p, i) => (i ? ctx.lineTo(x(p.at), y(p.v)) : ctx.moveTo(x(p.at), y(p.v))))
    ctx.stroke()

    ctx.font = '11px system-ui, sans-serif'
    for (const m of markers) {
      const mx = x(m.at)
      // Colors may be CSS custom property names, so markers follow the theme.
      const color = m.color.startsWith('--') ? css.getPropertyValue(m.color).trim() : m.color
      ctx.strokeStyle = color
      ctx.fillStyle = color
      ctx.setLineDash(m.dashed ? [4, 3] : [])
      ctx.beginPath()
      ctx.moveTo(mx, 0)
      ctx.lineTo(mx, height)
      ctx.stroke()
      ctx.fillText(m.label, Math.min(mx + 3, w - ctx.measureText(m.label).width - 2), 11)
    }
    ctx.setLineDash([])
    if (cursor != null) {
      ctx.strokeStyle = css.getPropertyValue('--fg').trim() || '#000'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(x(cursor), 0)
      ctx.lineTo(x(cursor), height)
      ctx.stroke()
    }
  }, [points, from, to, height, markers, cursor])

  return (
    <canvas
      ref={ref}
      className={onPick ? 'spark pickable' : 'spark'}
      style={{ height }}
      onClick={(e) => {
        if (!onPick) return
        const r = e.currentTarget.getBoundingClientRect()
        onPick(from + ((e.clientX - r.left) / r.width) * (to - from))
      }}
    />
  )
}
