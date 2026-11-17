import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react'
import type { FrameLayer, FrameLayout } from '../format/kinds'
import { ProfileCard } from './Sample'

/** A frame layer with its picture's pixel size (Parley's server adds these when it reads the folder). */
export type SizedLayer = FrameLayer & { width?: number; height?: number }
export interface FrameDraft { layers: SizedLayer[]; layout: FrameLayout; fileUrl: (file: string) => string }

/**
 * Parley's frame renderer (frontend ProfileFrame.tsx), drawn around the card it sits in. Frames are authored for a card
 * `inner_width` wide (1200, Discord's 4x), so every layer is scaled by card width / inner_width:
 *  - staples hang off the top or bottom edge, reaching `overflow_top` / `overflow_bottom` past it;
 *  - rails and borders run along the sides, cropped to the card's height from their top or centre, or on a card
 *    taller than they were drawn for, kept at size at both ends with the middle stretched between;
 *  - front layers draw over the card, back layers behind it, masked out of the card's own rounded shape.
 */
function ProfileFrame({ draft }: { draft: FrameDraft }) {
  const { layers, layout, fileUrl: src } = draft
  const ref = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<{ w: number; h: number; r: number[] } | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const p = el.parentElement
      const w = p?.offsetWidth ?? el.offsetWidth, h = p?.offsetHeight ?? el.offsetHeight
      const card = p?.firstElementChild instanceof HTMLElement && p.firstElementChild !== el ? getComputedStyle(p.firstElementChild) : null
      const r = (['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'] as const).map((k) => (card ? parseFloat(card[`border${k}Radius`]) || 0 : 0))
      setBox((b) => (b && b.w === w && b.h === h && b.r.join() === r.join() ? b : { w, h, r }))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const { w: W, h: H } = box ?? { w: 0, h: 0 }
  const s = W / (layout.inner_width || 1200)
  const dpr = window.devicePixelRatio || 1
  const snap = (v: number) => Math.round(v * dpr) / dpr
  const ot = snap(layout.overflow_top * s), ob = snap(layout.overflow_bottom * s), oh = snap(layout.overflow_horizontal * s)
  const pad = 40
  const hole = (() => {
    const [tl, tr, br, bl] = (box?.r ?? [0, 0, 0, 0]).map((v) => Math.min(v, W / 2, H / 2))
    const x0 = -oh - pad, y0 = -ot - pad, x1 = W + oh + pad, y1 = H + ob + pad
    const card = `M${tl} 0H${W - tr}A${tr} ${tr} 0 0 1 ${W} ${tr}V${H - br}A${br} ${br} 0 0 1 ${W - br} ${H}H${bl}A${bl} ${bl} 0 0 1 0 ${H - bl}V${tl}A${tl} ${tl} 0 0 1 ${tl} 0Z`
    return `path(evenodd, "M${x0} ${y0}H${x1}V${y1}H${x0}Z${card}")`
  })()
  type At = { left: number; width: number; top?: number; bottom?: number; along: boolean }
  const place = (l: SizedLayer): At => {
    const w = snap((l.width ?? 1312) * s), h = (l.height ?? 0) * s
    const left = snap((W - w) / 2)
    if (l.type === 'staple') return l.anchor === 'bottom' ? { left, width: w, bottom: -ob, along: false } : { left, width: w, top: -ot, along: false }
    return { left, width: w, top: l.anchor === 'top' ? 0 : snap((H - h) / 2), along: true }
  }
  const img = (l: SizedLayer, at: At, dx = 0): ReactElement =>
    <img src={src(l.file)} alt="" draggable={false} className="absolute max-w-none select-none"
      style={{ left: at.left - dx, width: at.width, ...(at.bottom !== undefined ? { bottom: at.bottom } : { top: at.top }) }} data-frame-layer={l.file} data-frame-order={l.order} />
  const along = (l: SizedLayer, at: At, dx: number): ReactElement => {
    const nat = l.height ?? 0
    if (!nat || nat * s >= H) return img(l, at, dx)
    const cut = Math.floor(nat * 0.45), cutPx = snap(cut * s)
    return <div className="absolute inset-y-0 select-none" style={{ left: at.left - dx, width: at.width, boxSizing: 'border-box', borderStyle: 'solid', borderWidth: `${cutPx}px 0`, borderImageSource: `url("${src(l.file)}")`, borderImageSlice: `${cut} 0 ${cut} 0 fill`, borderImageWidth: `${cutPx}px 0`, borderImageRepeat: 'stretch' }} data-frame-layer={l.file} data-frame-order={l.order} data-frame-stretched />
  }
  const piece = (l: SizedLayer, i: number) => {
    const at = place(l)
    return at.along
      ? <div key={i} className="absolute overflow-hidden" style={{ left: -oh - pad, width: W + 2 * (oh + pad), top: 0, bottom: 0 }}>{along(l, at, -oh - pad)}</div>
      : <span key={i}>{img(l, at)}</span>
  }
  return (
    <>
      {box && W > 0 && layers.some((l) => l.order === 'back') && (
        <div className="pointer-events-none absolute inset-0 z-0" style={{ clipPath: hole }} aria-hidden data-frame-back>
          {layers.map((l, i) => (l.order === 'back' ? piece(l, i) : null))}
        </div>
      )}
      <div ref={ref} className="pointer-events-none absolute inset-0 z-20" aria-hidden data-frame-front>
        {box && W > 0 && layers.map((l, i) => (l.order === 'back' ? null : piece(l, i)))}
      </div>
    </>
  )
}

/** Room around the card for its frame (Parley's FrameRoom): padding as large as the frame reaches past the card. */
function FrameRoom({ draft, cardWidth, children }: { draft: FrameDraft; cardWidth: number; children: ReactNode }) {
  const L = draft.layout, s = cardWidth / (L.inner_width || 1200)
  const widest = Math.max(0, ...draft.layers.map((l) => (l.width ?? 1312) * s))
  const pad: CSSProperties = { paddingTop: L.overflow_top * s, paddingBottom: L.overflow_bottom * s, paddingLeft: Math.max(L.overflow_horizontal * s, (widest - cardWidth) / 2), paddingRight: Math.max(L.overflow_horizontal * s, (widest - cardWidth) / 2) }
  return (
    <div style={pad} data-frame-room>
      <div className="relative isolate" style={{ width: cardWidth }}>
        {/* The card first: the frame reads its rounded corners from the first child. */}
        {children}
        <ProfileFrame draft={draft} />
      </div>
    </div>
  )
}

export default function FramePreview({ draft }: { draft: FrameDraft }) {
  const [width, setWidth] = useState(300)
  const [tall, setTall] = useState(false)
  const [outline, setOutline] = useState(false)
  return (
    <div className="space-y-3" data-frame-preview>
      <div className={`inline-block rounded-xl ${outline ? 'outline outline-1 outline-dashed outline-accent/60' : ''}`}>
        <FrameRoom draft={draft} cardWidth={width}>
          <ProfileCard width={width} height={tall ? 640 : undefined} />
        </FrameRoom>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-sm text-text-1">
        <label className="flex items-center gap-2 text-xs text-text-2">Card width<input type="range" min={240} max={480} value={width} onChange={(e) => setWidth(+e.target.value)} data-frame-width />{width}px</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={tall} onChange={(e) => setTall(e.target.checked)} data-frame-tall />Tall card (the DM panel)</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={outline} onChange={(e) => setOutline(e.target.checked)} />Show the room it takes</label>
      </div>
    </div>
  )
}
