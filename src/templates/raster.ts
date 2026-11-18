import type { Shape } from './spec'

/*
 * Guides drawn straight into RGBA pixels: no canvas, so templates build the same in the browser, in a worker and in
 * tests. Shapes are signed-distance fields, so edges come out anti-aliased. Text isn't drawn here (the SVG carries the
 * labels; PSD layer names say what each guide is).
 */

export interface Pixels { width: number; height: number; data: Uint8ClampedArray }
export interface Box { x: number; y: number; w: number; h: number }

function rgba(hex: string): [number, number, number, number] {
  const h = hex.replace('#', '')
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16)
  return [n(0), n(2), n(4), h.length >= 8 ? n(6) / 255 : 1]
}

/** Paint `a` (0–1) of a colour over a pixel, source-over, straight (unpremultiplied) alpha. */
function blend(p: Pixels, x: number, y: number, [r, g, b, a]: [number, number, number, number], cover: number) {
  const sa = a * cover
  if (sa <= 0) return
  const i = (y * p.width + x) * 4, d = p.data
  const da = d[i + 3] / 255, oa = sa + da * (1 - sa)
  if (oa <= 0) return
  d[i] = (r * sa + d[i] * da * (1 - sa)) / oa
  d[i + 1] = (g * sa + d[i + 1] * da * (1 - sa)) / oa
  d[i + 2] = (b * sa + d[i + 2] * da * (1 - sa)) / oa
  d[i + 3] = oa * 255
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const DASH = 10

/** Distance from a point to a rounded rectangle's edge: negative inside. */
function rrect(px: number, py: number, s: { x: number; y: number; w: number; h: number; r?: number }) {
  const r = Math.min(s.r ?? 0, s.w / 2, s.h / 2)
  const qx = Math.abs(px - (s.x + s.w / 2)) - (s.w / 2 - r), qy = Math.abs(py - (s.y + s.h / 2)) - (s.h / 2 - r)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}

/** Draw shapes into `p`, whose top-left is canvas point (ox, oy). */
export function draw(p: Pixels, shapes: Shape[], ox = 0, oy = 0) {
  for (const s of shapes) {
    if (s.t === 'text') continue
    const sw = s.stroke ? (s.width ?? 1) : 0
    const fill = s.fill ? rgba(s.fill) : null, stroke = s.stroke ? rgba(s.stroke) : null
    const bx = s.t === 'rect' ? s.x : s.cx - s.r, by = s.t === 'rect' ? s.y : s.cy - s.r
    const bw = s.t === 'rect' ? s.w : 2 * s.r, bh = s.t === 'rect' ? s.h : 2 * s.r
    const x0 = Math.max(0, Math.floor(bx - sw - 1 - ox)), y0 = Math.max(0, Math.floor(by - sw - 1 - oy))
    const x1 = Math.min(p.width, Math.ceil(bx + bw + sw + 1 - ox)), y1 = Math.min(p.height, Math.ceil(by + bh + sw + 1 - oy))
    const m = sw / 2 + 2
    for (let y = y0; y < y1; y++) {
      const cy = y + 0.5 + oy
      // Without a fill only pixels near the edge matter: skip the inside of the shape on this row.
      let skip0 = Infinity, skip1 = -Infinity
      if (!fill) {
        if (s.t === 'circle') {
          const dy = cy - s.cy, ri = s.r - m
          if (ri > 0 && Math.abs(dy) < ri) { const c = Math.sqrt(ri * ri - dy * dy); skip0 = s.cx - c - ox; skip1 = s.cx + c - ox }
        } else {
          const r = Math.min(s.r ?? 0, s.w / 2, s.h / 2)
          if (cy > s.y + r + m && cy < s.y + s.h - r - m) { skip0 = s.x + m - ox; skip1 = s.x + s.w - m - ox }
        }
      }
      for (let x = x0; x < x1; x++) {
        if (x > skip0 && x + 1 < skip1) { x = Math.ceil(skip1) - 2; continue }
        const cx = x + 0.5 + ox
        const d = s.t === 'rect' ? rrect(cx, cy, s) : Math.hypot(cx - s.cx, cy - s.cy) - s.r
        if (fill && d < 0.5) blend(p, x, y, fill, clamp01(0.5 - d))
        if (stroke && Math.abs(d) < sw / 2 + 0.5) {
          if (s.dash) {
            const along = s.t === 'circle' ? (Math.atan2(cy - s.cy, cx - s.cx) + Math.PI) * s.r : cx + cy
            if (Math.floor(along / DASH) % 2) continue
          }
          blend(p, x, y, stroke, clamp01(sw / 2 + 0.5 - Math.abs(d)))
        }
      }
    }
  }
}

/** The part of the canvas `shapes` touch, clipped to `view`, in whole pixels. */
export function bounds(shapes: Shape[], view: Box): Box | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const s of shapes) {
    if (s.t === 'text') continue
    const sw = s.stroke ? (s.width ?? 1) : 0
    const [a, b, w, h] = s.t === 'rect' ? [s.x, s.y, s.w, s.h] : [s.cx - s.r, s.cy - s.r, 2 * s.r, 2 * s.r]
    x0 = Math.min(x0, a - sw - 1); y0 = Math.min(y0, b - sw - 1); x1 = Math.max(x1, a + w + sw + 1); y1 = Math.max(y1, b + h + sw + 1)
  }
  x0 = Math.max(view.x, Math.floor(x0)); y0 = Math.max(view.y, Math.floor(y0))
  x1 = Math.min(view.x + view.w, Math.ceil(x1)); y1 = Math.min(view.y + view.h, Math.ceil(y1))
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null
}

export const blank = (width: number, height: number): Pixels => ({ width, height, data: new Uint8ClampedArray(width * height * 4) })

/** Shapes drawn into a picture covering `box` of the canvas. */
export function render(shapes: Shape[], box: Box): Pixels {
  const p = blank(box.w, box.h)
  draw(p, shapes, box.x, box.y)
  return p
}
