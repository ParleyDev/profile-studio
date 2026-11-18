/// <reference lib="webworker" />
import UPNG from 'upng-js'

/*
 * Re-encodes a PNG or animated PNG smaller, off the page's thread: fewer colors (a palette, like pngquant) and/or a
 * smaller size. Every frame keeps its timing. "Auto" tries gentle settings first and stops at the first that fits.
 */

export interface OptimizeRequest { buf: ArrayBuffer; /** 0 = lossless. */ colors: number; scale: number; /** Auto: bytes to get under. */ target?: number; /** Auto may scale down. */ allowScale: boolean }
export type OptimizeMessage =
  | { type: 'progress'; label: string }
  | { type: 'done'; buf: ArrayBuffer; colors: number; scale: number; width: number; height: number; frames: number; fits: boolean }
  | { type: 'error'; message: string }

const post = (m: OptimizeMessage, transfer: Transferable[] = []) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m, transfer)

async function resize(frames: ArrayBuffer[], w: number, h: number, scale: number) {
  if (scale >= 1) return { frames, w, h }
  const W = Math.max(1, Math.round(w * scale)), H = Math.max(1, Math.round(h * scale))
  const c = new OffscreenCanvas(W, H)
  const g = c.getContext('2d')!
  g.imageSmoothingQuality = 'high'
  const out: ArrayBuffer[] = []
  for (const f of frames) {
    const bm = await createImageBitmap(new ImageData(new Uint8ClampedArray(f), w, h))
    g.clearRect(0, 0, W, H)
    g.drawImage(bm, 0, 0, W, H)
    bm.close()
    out.push(g.getImageData(0, 0, W, H).data.buffer as ArrayBuffer)
  }
  return { frames: out, w: W, h: H }
}

/** Gentlest first: how much quality each step gives up. */
const AUTO: [colors: number, scale: number][] = [[0, 1], [256, 1], [192, 1], [128, 1], [256, 0.85], [128, 0.85], [256, 0.75], [128, 0.75], [96, 0.65], [64, 0.5]]

self.onmessage = async (e: MessageEvent<OptimizeRequest>) => {
  try {
    const { buf, target, allowScale } = e.data
    post({ type: 'progress', label: 'Reading the frames' })
    const img = UPNG.decode(buf)
    const frames = UPNG.toRGBA8(img)
    const delays = img.frames.length > 1 ? img.frames.map((f) => f.delay) : undefined
    const tries: [number, number][] = target ? AUTO.filter(([, s]) => allowScale || s === 1) : [[e.data.colors, allowScale ? e.data.scale : 1]]
    let best: { buf: ArrayBuffer; colors: number; scale: number; w: number; h: number } | null = null
    const scaled = new Map<number, Awaited<ReturnType<typeof resize>>>()
    for (const [i, [colors, scale]] of tries.entries()) {
      post({ type: 'progress', label: `${tries.length > 1 ? `Try ${i + 1} of ${tries.length}: ` : ''}${colors ? `${colors} colors` : 'lossless'}${scale < 1 ? `, ${Math.round(scale * 100)}% size` : ''}` })
      let s = scaled.get(scale)
      if (!s) { s = await resize(frames, img.width, img.height, scale); scaled.set(scale, s) }
      const out = UPNG.encode(s.frames, s.w, s.h, colors, delays)
      if (!best || out.byteLength < best.buf.byteLength) best = { buf: out, colors, scale, w: s.w, h: s.h }
      if (target && out.byteLength <= target) { best = { buf: out, colors, scale, w: s.w, h: s.h }; break }
    }
    const b = best!
    post({ type: 'done', buf: b.buf, colors: b.colors, scale: b.scale, width: b.w, height: b.h, frames: frames.length, fits: !target || b.buf.byteLength <= target }, [b.buf])
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
