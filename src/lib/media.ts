import { useEffect, useState } from 'react'
import { isVideo } from '../format/kinds'
import type { Sizes } from '../format/validate'

/**
 * Object URLs for a set of files, revoked when the set changes or the component goes. They are made inside the effect
 * that revokes them: made during render (useMemo), StrictMode's extra effect run would revoke URLs still in use.
 */
export function useFileUrls(files: Record<string, Blob>): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({})
  useEffect(() => {
    const made = Object.fromEntries(Object.entries(files).map(([n, b]) => [n, URL.createObjectURL(b)]))
    setUrls(made)
    return () => Object.values(made).forEach((u) => URL.revokeObjectURL(u))
  }, [files])
  return urls
}

async function measure(name: string, b: Blob): Promise<{ w: number; h: number } | null> {
  if (isVideo(name)) {
    const url = URL.createObjectURL(b)
    try {
      return await new Promise((res) => {
        const v = document.createElement('video')
        v.preload = 'metadata'; v.muted = true
        v.onloadedmetadata = () => res({ w: v.videoWidth, h: v.videoHeight })
        v.onerror = () => res(null)
        v.src = url
      })
    } finally { URL.revokeObjectURL(url) }
  }
  try { const bm = await createImageBitmap(b); const s = { w: bm.width, h: bm.height }; bm.close(); return s } catch { return null }
}

const cache = new WeakMap<Blob, Promise<{ w: number; h: number } | null>>()
/** Pixel sizes of a set of pictures and videos (frames place layers by them; checks use them). */
export function useSizes(files: Record<string, Blob>): Sizes {
  const [sizes, setSizes] = useState<Sizes>({})
  useEffect(() => {
    let live = true
    void Promise.all(Object.entries(files).map(async ([n, b]) => {
      let p = cache.get(b)
      if (!p) { p = measure(n, b); cache.set(b, p) }
      return [n, await p] as const
    })).then((list) => { if (live) setSizes(Object.fromEntries(list.filter((x): x is [string, { w: number; h: number }] => !!x[1]))) })
    return () => { live = false }
  }, [files])
  return sizes
}

/**
 * How long one play of an animated picture lasts, in ms (null for a still or one this can't read): APNG frame
 * controls, GIF graphic control extensions, animated WebP frames. Effect layers play for `duration_ms`, so this is
 * usually the number to use.
 */
export async function animationLength(b: Blob): Promise<number | null> {
  const d = new Uint8Array(await b.arrayBuffer())
  const v = new DataView(d.buffer)
  const tag = (i: number) => String.fromCharCode(d[i], d[i + 1], d[i + 2], d[i + 3])
  let ms = 0, frames = 0
  if (d[0] === 0x89 && tag(1).startsWith('PNG')) {
    for (let p = 8; p + 8 <= d.length;) {
      const len = v.getUint32(p), type = tag(p + 4)
      if (type === 'fcTL' && p + 8 + 24 <= d.length) {
        const num = v.getUint16(p + 8 + 20), den = v.getUint16(p + 8 + 22) || 100
        ms += (num / den) * 1000; frames++
      }
      if (type === 'IEND') break
      p += 12 + len
    }
  } else if (tag(0) === 'GIF8') {
    for (let p = 13 + (d[10] & 0x80 ? 3 << ((d[10] & 7) + 1) : 0); p < d.length;) {
      if (d[p] === 0x21 && d[p + 1] === 0xf9) { ms += (d[p + 4] | (d[p + 5] << 8)) * 10; frames++ }
      if (d[p] === 0x21) { p += 2; while (p < d.length && d[p]) p += d[p] + 1; p++ }
      else if (d[p] === 0x2c) {
        const lct = d[p + 9] & 0x80 ? 3 << ((d[p + 9] & 7) + 1) : 0
        p += 10 + lct + 1
        while (p < d.length && d[p]) p += d[p] + 1
        p++
      } else break
    }
  } else if (tag(0) === 'RIFF' && tag(8) === 'WEBP') {
    for (let p = 12; p + 8 <= d.length;) {
      const len = v.getUint32(p + 4, true)
      if (tag(p) === 'ANMF' && p + 8 + 16 <= d.length) { ms += d[p + 20] | (d[p + 21] << 8) | (d[p + 22] << 16); frames++ }
      p += 8 + len + (len & 1)
    }
  }
  return frames > 1 ? Math.round(ms) : null
}

/** Animated PNGs have an acTL chunk before their image data; animated WebP an ANIM chunk; GIFs count as animated. */
export async function isAnimated(b: Blob): Promise<boolean> {
  if (b.type === 'image/gif' || b.type.startsWith('video/')) return true
  const head = new Uint8Array(await b.slice(0, 4096).arrayBuffer())
  const s = String.fromCharCode(...head)
  if (b.type === 'image/png') { const i = s.indexOf('acTL'), d = s.indexOf('IDAT'); return i >= 0 && (d < 0 || i < d) }
  if (b.type === 'image/webp') return s.includes('ANIM')
  return false
}
