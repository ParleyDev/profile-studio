import { useEffect, useMemo, useState } from 'react'
import { isVideo } from '../format/kinds'
import { fromPixels, type Features } from '../format/suggest'
import { tagsOf } from '../format/tags'
import { keyOf, type Item } from '../format/workspace'
import { enqueue, thumbFile, videoFrame } from '../components/Thumb'
import { isAnimated } from './media'
import { useStudio } from './store'

const SIZE = 32
// Worked out once per file, for as long as the file is kept.
const looks = new WeakMap<Blob, Promise<Omit<Features, 'animated'> | null>>()

function lookOf(b: Blob, name: string) {
  let p = looks.get(b)
  if (!p) {
    p = enqueue(async () => {
      try {
        const opts: ImageBitmapOptions = { resizeWidth: SIZE, resizeHeight: SIZE, resizeQuality: 'high' }
        const bm = isVideo(name) ? await createImageBitmap(await videoFrame(b), opts) : await createImageBitmap(b, opts)
        const c = document.createElement('canvas')
        c.width = c.height = SIZE
        const g = c.getContext('2d', { willReadFrequently: true })!
        g.drawImage(bm, 0, 0)
        bm.close()
        return fromPixels(g.getImageData(0, 0, SIZE, SIZE).data, SIZE, SIZE)
      } catch { return null }
    })
    looks.set(b, p)
  }
  return p
}

/** What an item's picture looks like (its list picture's first frame), or null when it has none that decodes. */
export async function featuresOf(it: Item): Promise<Features | null> {
  const name = thumbFile(it)
  const b = name ? it.files[name] : undefined
  if (!name || !b) return null
  const look = await lookOf(b, name)
  if (!look) return null
  // Effects always move and frames are judged by their parts, so only decorations and nameplates say "animated".
  const main = it.kind === 'decoration' || it.kind === 'nameplate' ? it.files[keyOf(it)] : undefined
  return { ...look, animated: main ? await isAnimated(main) : false }
}

const ids = new WeakMap<Blob, number>()
let nextId = 1
const blobId = (b: Blob | undefined) => { if (!b) return 0; let n = ids.get(b); if (!n) { n = nextId++; ids.set(b, n) } return n }

/** Every item as it stands now: drafts in place of saved items, new drafts added. */
export function usePool(): Item[] {
  const { ws, drafts } = useStudio()
  return useMemo(() => {
    const saved = new Set(ws.items.map((i) => i.uid))
    return [...ws.items.map((i) => drafts[i.uid] ?? i), ...Object.values(drafts).filter((d) => !saved.has(d.uid))]
  }, [ws.items, drafts])
}

/**
 * Features for `targets` and for the tagged items of the same kinds (the ones similar items are looked for among),
 * worked out once `on` turns true. Returns what's known so far and how far along it is.
 */
export function useFeatures(targets: Item[], pool: Item[], on: boolean) {
  const [feats, setFeats] = useState<Map<string, Features | null>>(new Map())
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const kinds = new Set(targets.map((t) => t.kind))
  const want = on ? [...targets, ...pool.filter((p) => kinds.has(p.kind) && tagsOf(p).length && !targets.some((t) => t.uid === p.uid))] : []
  // A file change gives a new blob; tags changing on a neighbour don't change what it looks like.
  const sig = want.map((i) => `${i.uid}:${blobId(i.files[thumbFile(i) ?? ''])}:${blobId(i.files[keyOf(i)])}`).join('|')
  useEffect(() => {
    if (!want.length) return
    let live = true
    let done = 0
    setProgress({ done, total: want.length })
    void Promise.all(want.map(async (it) => {
      const f = await featuresOf(it)
      if (!live) return
      done++
      setFeats((m) => new Map(m).set(it.uid, f))
      setProgress(done === want.length ? null : { done, total: want.length })
    }))
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig])
  return { feats, progress }
}
