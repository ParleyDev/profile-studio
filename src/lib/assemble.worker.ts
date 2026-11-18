/// <reference lib="webworker" />
import UPNG from 'upng-js'

/*
 * Turns a PNG sequence (what PhotoCraft, AniCraft, EffectCraft and most animation apps export) into one animated
 * PNG, the format Parley plays for decorations and effect layers. Frames are drawn onto the first frame's size.
 */

export interface AssembleRequest { frames: Blob[]; delayMs: number; /** 0 = lossless. */ colors: number }
export type AssembleMessage =
  | { type: 'progress'; done: number; total: number; label: string }
  | { type: 'done'; buf: ArrayBuffer; width: number; height: number; frames: number }
  | { type: 'error'; message: string }

const post = (m: AssembleMessage, transfer: Transferable[] = []) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m, transfer)

self.onmessage = async (e: MessageEvent<AssembleRequest>) => {
  try {
    const { frames, delayMs, colors } = e.data
    if (!frames.length) throw new Error('no frames')
    const first = await createImageBitmap(frames[0])
    const W = first.width, H = first.height
    first.close()
    const c = new OffscreenCanvas(W, H)
    const g = c.getContext('2d', { willReadFrequently: true })!
    const rgba: ArrayBuffer[] = []
    for (const [i, f] of frames.entries()) {
      post({ type: 'progress', done: i, total: frames.length, label: 'Reading frames' })
      const bm = await createImageBitmap(f)
      g.clearRect(0, 0, W, H)
      g.drawImage(bm, 0, 0, W, H)
      bm.close()
      rgba.push(g.getImageData(0, 0, W, H).data.buffer as ArrayBuffer)
    }
    post({ type: 'progress', done: frames.length, total: frames.length, label: 'Encoding' })
    const buf = UPNG.encode(rgba, W, H, colors, frames.length > 1 ? rgba.map(() => delayMs) : undefined)
    post({ type: 'done', buf, width: W, height: H, frames: frames.length }, [buf])
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
