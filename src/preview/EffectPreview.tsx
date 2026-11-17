import { RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { EffectLayer } from '../format/kinds'
import { ProfileCard } from './Sample'

/**
 * Parley's effect player (frontend ProfileEffect.tsx EffectLayers): each layer is an animated picture the width of
 * the card, anchored to its top. It starts `start_ms` after the card opens and plays for `duration_ms`; looping
 * layers then wait `loop_delay_ms` and play again (a random variant each time when it has some), one-shot layers go
 * away. Reduced motion shows the still instead.
 */
export function EffectLayers({ layers, files, reduced, still }: { layers: EffectLayer[]; files: Record<string, Blob>; reduced: boolean; still?: string }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-[5] isolate overflow-hidden rounded-[inherit]" aria-hidden data-effect-layers={layers.length}>
      {reduced
        ? still && <img src={still} alt="" className="absolute inset-x-0 top-0 w-full" data-effect-still />
        : layers.map((l, i) => <Layer key={`${i}-${l.file}`} layer={l} files={files} />)}
    </div>
  )
}

function Layer({ layer, files }: { layer: EffectLayer; files: Record<string, Blob> }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let alive = true, url: string | null = null
    const timers: number[] = []
    const names = [layer.file, ...(layer.random_variants ?? [])].filter((f) => files[f])
    if (!names.length) return
    const later = (fn: () => void, ms: number) => { timers.push(window.setTimeout(fn, ms)) }
    const play = () => {
      if (!alive) return
      // A fresh object URL each play, so an animated PNG starts again from its first frame.
      const next = URL.createObjectURL(files[names[Math.floor(Math.random() * names.length)]])
      if (url) URL.revokeObjectURL(url)
      url = next
      setSrc(next)
      later(() => {
        if (!layer.loop) { setSrc(null); return }
        if (layer.loop_delay_ms > 0) { setSrc(null); later(play, layer.loop_delay_ms) } else play()
      }, Math.max(100, layer.duration_ms))
    }
    later(play, layer.start_ms)
    return () => { alive = false; timers.forEach(clearTimeout); if (url) URL.revokeObjectURL(url) }
  }, [layer, files])
  if (!src) return null
  return <img src={src} alt="" className="absolute inset-x-0 top-0 w-full max-w-none" style={{ zIndex: layer.z_index }} data-effect-layer={layer.file} />
}

/** When each layer shows over the first stretch of time: a bar per play, faded while it waits to loop. */
export function Timeline({ layers, span = 12_000 }: { layers: EffectLayer[]; span?: number }) {
  const pct = (ms: number) => `${Math.min(100, (ms / span) * 100)}%`
  return (
    <div className="space-y-1.5" data-effect-timeline>
      <div className="flex justify-between text-[10px] text-text-2">{[0, 0.25, 0.5, 0.75, 1].map((f) => <span key={f}>{(span * f) / 1000}s</span>)}</div>
      {layers.map((l, i) => {
        const plays: [number, number][] = []
        let t = l.start_ms
        const d = Math.max(100, l.duration_ms)
        while (t < span && plays.length < 200) { plays.push([t, Math.min(span, t + d)]); if (!l.loop) break; t += d + l.loop_delay_ms }
        return (
          <div key={i} className="relative h-4 rounded bg-bg-0/60" title={l.file}>
            {plays.map(([a, b], j) => <span key={j} className="absolute inset-y-0.5 rounded-sm bg-accent/70" style={{ left: pct(a), width: `calc(${pct(b - a)} - 1px)` }} />)}
            <span className="absolute left-1 top-0 text-[10px] leading-4 text-text-0/80">{i + 1}</span>
          </div>
        )
      })}
    </div>
  )
}

export default function EffectPreview({ layers, files, still }: { layers: EffectLayer[]; files: Record<string, Blob>; still?: string }) {
  const [run, setRun] = useState(0)
  const [reduced, setReduced] = useState(false)
  const [width, setWidth] = useState(300)
  return (
    <div className="flex flex-wrap items-start gap-8" data-effect-preview>
      <div className="space-y-3">
        <ProfileCard width={width}>
          <EffectLayers key={`${run}-${reduced}`} layers={layers} files={files} reduced={reduced} still={still} />
        </ProfileCard>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <button type="button" className="btn-ghost bg-bg-3 !px-3 !py-1.5" onClick={() => setRun((r) => r + 1)} data-effect-replay><RotateCcw size={14} />Play from the start</button>
          <label className="flex items-center gap-2 text-text-1"><input type="checkbox" checked={reduced} onChange={(e) => setReduced(e.target.checked)} data-effect-reduced />Reduced motion</label>
        </div>
        <label className="flex items-center gap-2 text-xs text-text-2">Card width<input type="range" min={240} max={480} value={width} onChange={(e) => setWidth(+e.target.value)} />{width}px</label>
      </div>
      <div className="min-w-64 flex-1 space-y-2">
        <div className="label">The first 12 seconds</div>
        <Timeline layers={layers} />
        <p className="text-xs text-text-2">Layers are drawn the card's width and pinned to its top, so make them for a 4× card (1200 px wide). Higher z_index draws on top.</p>
      </div>
    </div>
  )
}
