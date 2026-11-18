import { Film, Loader2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AssembleMessage, AssembleRequest } from '../lib/assemble.worker'
import { fmtSize } from './Fields'

/** Frame files in the order their numbers say: frame_2 before frame_10. */
const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/**
 * A button that turns a PNG sequence into one animated PNG. Design apps export sequences, not animated PNGs; this is
 * the bridge to what Parley plays.
 */
export function AssembleButton({ defaultFps = 12, label = 'Animation from frames', onDone }: { defaultFps?: number; label?: string; onDone: (png: Blob, durationMs: number, frames: number) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [frames, setFrames] = useState<File[] | null>(null)
  return (
    <>
      <button type="button" className="btn-ghost bg-bg-3 !px-3 !py-1.5 shrink-0" onClick={() => input.current?.click()} title="Pick a PNG sequence exported from your app" data-assemble><Film size={14} />{label}</button>
      <input ref={input} type="file" accept=".png" multiple className="hidden" onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ''; if (f.length) setFrames(f.sort((a, b) => natural.compare(a.name, b.name))) }} data-assemble-input />
      {frames && <AssembleDialog frames={frames} defaultFps={defaultFps} onClose={() => setFrames(null)} onDone={(b, ms, n) => { onDone(b, ms, n); setFrames(null) }} />}
    </>
  )
}

type Result = Extract<AssembleMessage, { type: 'done' }> & { blob: Blob; url: string }

function AssembleDialog({ frames, defaultFps, onClose, onDone }: { frames: File[]; defaultFps: number; onClose: () => void; onDone: (b: Blob, durationMs: number, frames: number) => void }) {
  const [fps, setFps] = useState(defaultFps)
  const [colors, setColors] = useState(0)
  const [running, setRunning] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState<string | null>(null)
  const worker = useRef<Worker | null>(null)
  const delay = Math.round(1000 / fps)
  const total = useMemo(() => frames.reduce((n, f) => n + f.size, 0), [frames])

  useEffect(() => () => { worker.current?.terminate() }, [])
  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url) }, [result])

  const run = () => {
    setError(null); setResult(null); setRunning('Starting')
    worker.current?.terminate()
    const w = new Worker(new URL('../lib/assemble.worker.ts', import.meta.url), { type: 'module' })
    worker.current = w
    w.onerror = (e) => { setError(`Couldn't start: ${e.message || 'the worker failed to load'}`); setRunning(null) }
    w.onmessage = (e: MessageEvent<AssembleMessage>) => {
      const m = e.data
      if (m.type === 'progress') setRunning(`${m.label} ${m.done}/${m.total}`)
      else if (m.type === 'error') { setError(`Couldn't make it: ${m.message}`); setRunning(null); w.terminate() }
      else { const b = new Blob([m.buf], { type: 'image/png' }); setResult({ ...m, blob: b, url: URL.createObjectURL(b) }); setRunning(null); w.terminate() }
    }
    w.postMessage({ frames, delayMs: delay, colors } satisfies AssembleRequest)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg-0/80 p-4" role="dialog" aria-modal="true" aria-label="Animation from frames" data-assemble-dialog>
      <div className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-line bg-bg-2 shadow-2xl">
        <div className="flex items-center gap-2 border-b border-line px-5 py-3">
          <Film size={16} className="text-accent" />
          <h2 className="flex-1 font-semibold">Animation from {frames.length} frame{frames.length === 1 ? '' : 's'}</h2>
          <button type="button" className="text-text-2 hover:text-text-0" title="Close" onClick={onClose} disabled={!!running}><X size={18} /></button>
        </div>
        <div className="space-y-4 overflow-y-auto p-5">
          <p className="text-xs text-text-2">In name order: <span className="font-mono">{frames[0].name}</span>{frames.length > 1 && <> … <span className="font-mono">{frames[frames.length - 1].name}</span></>} · {fmtSize(total)}</p>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">Frames per second
              <input type="number" min={1} max={60} className="input !w-20" value={fps} onChange={(e) => setFps(Math.min(60, Math.max(1, Number(e.target.value) || 1)))} data-assemble-fps />
            </label>
            <label className="flex items-center gap-2">Colors
              <select className="input !w-auto !py-1.5" value={colors} onChange={(e) => setColors(Number(e.target.value))}>
                <option value={0}>All (lossless)</option>{[256, 128, 64].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <span className="self-center text-text-2">Plays for {((frames.length * delay) / 1000).toFixed(2)} s</span>
          </div>
          <div className="checker flex h-64 items-center justify-center overflow-hidden rounded-lg">
            {result ? <img src={result.url} alt="" className="max-h-full max-w-full" data-assemble-result /> : running ? <span className="flex items-center gap-2 text-sm text-text-1"><Loader2 size={16} className="animate-spin" />{running}…</span> : <span className="text-sm text-text-2">The animation shows here.</span>}
          </div>
          {result && <p className="text-xs text-text-1" data-assemble-size={result.blob.size}>{result.width}×{result.height} · {result.frames} frames · {fmtSize(result.blob.size)}. Optimize can shrink it after.</p>}
          {error && <p className="text-sm text-danger">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
          <button type="button" className="btn-ghost" onClick={running ? () => { worker.current?.terminate(); setRunning(null) } : onClose}>{running ? 'Stop' : 'Cancel'}</button>
          <button type="button" className="btn-ghost" disabled={!!running} onClick={run} data-assemble-run>{result ? 'Make again' : 'Make it'}</button>
          <button type="button" className="btn-primary" disabled={!result || !!running} onClick={() => result && onDone(result.blob, result.frames * delay, result.frames)} data-assemble-use>Use it</button>
        </div>
      </div>
    </div>
  )
}
