import { Film, ImageOff } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { isVideo } from '../format/kinds'
import { keyOf, type Item } from '../format/workspace'

/** The file that best stands for an item in lists: its picture, an effect's thumbnail or still, a frame's top staple. */
export function thumbFile(it: Item): string | undefined {
  const names = Object.keys(it.files)
  if (!names.length) return undefined
  if (it.kind === 'decoration' || it.kind === 'nameplate') return it.files[keyOf(it)] ? keyOf(it) : names[0]
  if (it.kind === 'effect') return ['thumbnail.png', 'static.png'].find((n) => it.files[n]) ?? (it.entry.layers as { file?: string }[] | undefined)?.[0]?.file ?? names[0]
  const layers = (it.entry.layers as { file?: string; order?: string; anchor?: string }[] | undefined) ?? []
  return (layers.find((l) => l.order === 'front' && l.anchor === 'top') ?? layers[0])?.file ?? names[0]
}

/** True once the element has come near the viewport; it stays true, so a thumbnail decoded once stays drawn. */
function useNear<T extends Element>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null)
  const [near, setNear] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || near) return
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setNear(true); io.disconnect() } }, { rootMargin: '300px' })
    io.observe(el)
    return () => io.disconnect()
  }, [near])
  return [ref, near]
}

/*
 * Stills, not live pictures: a list of hundreds of animated PNGs would decode every frame of every one. Each file is
 * decoded once (its first frame, scaled down) and kept for as long as the file is.
 */
const stills = new WeakMap<Blob, Map<number, Promise<string | null>>>()
const queue: (() => Promise<void>)[] = []
let running = 0
/** A few at a time, so scrolling past hundreds doesn't start hundreds of decodes. */
export function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    queue.push(() => fn().then(resolve, reject))
    pump()
  })
}
function pump() {
  while (running < 4 && queue.length) {
    const job = queue.shift()!
    running++
    void job().finally(() => { running--; pump() })
  }
}

export async function videoFrame(b: Blob): Promise<ImageBitmap> {
  const url = URL.createObjectURL(b)
  try {
    const v = document.createElement('video')
    v.muted = true; v.preload = 'auto'; v.src = url
    await new Promise<void>((res, rej) => { v.onloadeddata = () => res(); v.onerror = () => rej(new Error('video')) })
    v.currentTime = Math.min(0.5, (v.duration || 1) / 2)
    await new Promise<void>((res) => { v.onseeked = () => res(); setTimeout(res, 1500) })
    return await createImageBitmap(v)
  } finally { URL.revokeObjectURL(url) }
}

function still(b: Blob, name: string, size: number): Promise<string | null> {
  let bySize = stills.get(b)
  if (!bySize) { bySize = new Map(); stills.set(b, bySize) }
  let p = bySize.get(size)
  if (!p) {
    p = enqueue(async () => {
      try {
        const bm = isVideo(name) ? await videoFrame(b) : await createImageBitmap(b)
        const scale = Math.min(1, (size * devicePixelRatio) / Math.max(bm.width, bm.height))
        const c = document.createElement('canvas')
        c.width = Math.max(1, Math.round(bm.width * scale)); c.height = Math.max(1, Math.round(bm.height * scale))
        const g = c.getContext('2d')!
        g.imageSmoothingQuality = 'high'
        g.drawImage(bm, 0, 0, c.width, c.height)
        bm.close()
        const out = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'))
        return out ? URL.createObjectURL(out) : null
      } catch { return null }
    })
    bySize.set(size, p)
  }
  return p
}

/** A small still of an item, decoded only when it scrolls into view. */
export default function Thumb({ item, size, height = size, className = '' }: { item: Item; size: number; height?: number; className?: string }) {
  const [ref, near] = useNear<HTMLDivElement>()
  const name = thumbFile(item)
  const blob = name ? item.files[name] : undefined
  const [src, setSrc] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    if (!near || !blob || !name) return
    let live = true
    void still(blob, name, size).then((s) => { if (live) setSrc(s) })
    return () => { live = false }
  }, [near, blob, name, size])
  return (
    <div ref={ref} className={`checker flex shrink-0 items-center justify-center overflow-hidden rounded ${className}`} style={{ width: size, height }} data-thumb>
      {!blob ? <ImageOff size={Math.round(size / 2.5)} className="text-text-2" />
        : src ? <img src={src} alt="" className="max-h-full max-w-full object-contain" draggable={false} />
        : src === null ? (isVideo(name!) ? <Film size={Math.round(size / 2.5)} className="text-text-2" /> : <ImageOff size={Math.round(size / 2.5)} className="text-text-2" />)
        : null}
    </div>
  )
}
