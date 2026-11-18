import { Loader2, Wand2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { extOf, MAX_FILE } from '../format/kinds'
import type { OptimizeMessage, OptimizeRequest } from '../lib/optimize.worker'
import { useRules } from '../lib/settings'
import { fmtSize } from './Fields'

/** Files Optimize can re-encode: PNG and animated PNG. */
export const canOptimize = (name: string) => ['png', 'apng'].includes(extOf(name))

/** A button that opens the optimizer for one file; highlighted when the file is over the size you warn about. */
export function OptimizeButton({ name, blob, allowScale, onApply }: { name: string; blob: Blob; allowScale: boolean; onApply: (b: Blob) => void }) {
  const [open, setOpen] = useState(false)
  const rules = useRules()
  if (!canOptimize(name)) return null
  const big = blob.size > rules.maxFileMB * 1024 * 1024
  return (
    <>
      <button type="button" className={`btn-ghost !px-2 !py-1 text-xs ${big ? '!text-warn' : ''}`} title="Re-encode it smaller" onClick={() => setOpen(true)} data-optimize={name}><Wand2 size={14} />Optimize</button>
      {open && <OptimizeDialog name={name} blob={blob} allowScale={allowScale} onClose={() => setOpen(false)} onApply={(b) => { onApply(b); setOpen(false) }} />}
    </>
  )
}

type Result = Extract<OptimizeMessage, { type: 'done' }> & { blob: Blob; url: string }

function OptimizeDialog({ name, blob, allowScale, onClose, onApply }: { name: string; blob: Blob; allowScale: boolean; onClose: () => void; onApply: (b: Blob) => void }) {
  const rules = useRules()
  const [mode, setMode] = useState<'auto' | 'manual'>('auto')
  const [targetMB, setTargetMB] = useState(Math.min(rules.maxFileMB, MAX_FILE / 1024 / 1024))
  const [colors, setColors] = useState(256)
  const [scale, setScale] = useState(1)
  const [running, setRunning] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [before, setBefore] = useState<string | null>(null)
  const worker = useRef<Worker | null>(null)

  useEffect(() => { const u = URL.createObjectURL(blob); setBefore(u); return () => URL.revokeObjectURL(u) }, [blob])
  useEffect(() => () => { worker.current?.terminate() }, [])
  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url) }, [result])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !running) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [running, onClose])

  const run = async () => {
    setError(null); setResult(null); setRunning('Starting')
    worker.current?.terminate()
    const w = new Worker(new URL('../lib/optimize.worker.ts', import.meta.url), { type: 'module' })
    worker.current = w
    w.onerror = (e) => { setError(`Couldn't start the optimizer: ${e.message || 'the worker failed to load'}`); setRunning(null); w.terminate() }
    w.onmessage = (e: MessageEvent<OptimizeMessage>) => {
      const m = e.data
      if (m.type === 'progress') setRunning(m.label)
      else if (m.type === 'error') { setError(`Couldn't re-encode it: ${m.message}`); setRunning(null); w.terminate() }
      else {
        const b = new Blob([m.buf], { type: 'image/png' })
        setResult({ ...m, blob: b, url: URL.createObjectURL(b) })
        setRunning(null); w.terminate()
      }
    }
    const buf = await blob.arrayBuffer()
    const req: OptimizeRequest = mode === 'auto' ? { buf, colors: 0, scale: 1, target: Math.round(targetMB * 1024 * 1024), allowScale } : { buf, colors, scale, allowScale }
    w.postMessage(req, [buf])
  }
  const cancel = () => { worker.current?.terminate(); setRunning(null) }
  const saved = result ? Math.round((1 - result.blob.size / blob.size) * 100) : 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg-0/80 p-4" role="dialog" aria-modal="true" aria-label={`Optimize ${name}`} data-optimize-dialog>
      <div className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-line bg-bg-2 shadow-2xl">
        <div className="flex items-center gap-2 border-b border-line px-5 py-3">
          <Wand2 size={16} className="text-accent" />
          <h2 className="flex-1 font-semibold">Optimize <span className="font-mono text-sm text-text-1">{name}</span></h2>
          <button type="button" className="text-text-2 hover:text-text-0" title="Close" onClick={onClose} disabled={!!running}><X size={18} /></button>
        </div>
        <div className="space-y-4 overflow-y-auto p-5">
          <div className="flex flex-wrap gap-2 text-sm">
            {(['auto', 'manual'] as const).map((m) => (
              <button key={m} type="button" className={`rounded-lg border px-3 py-1.5 ${mode === m ? 'border-accent bg-accent/10' : 'border-line hover:bg-bg-3'}`} onClick={() => setMode(m)} data-optimize-mode={m}>{m === 'auto' ? 'Aim for a size' : 'Choose settings'}</button>
            ))}
          </div>
          {mode === 'auto' ? (
            <label className="flex flex-wrap items-center gap-2 text-sm">
              Get it under
              <input type="number" min={0.1} step={0.5} className="input !w-24" value={targetMB} onChange={(e) => setTargetMB(Math.max(0.1, Number(e.target.value) || 0.1))} data-optimize-target />
              MB, giving up as little quality as it can{allowScale ? '' : ' (frame pictures keep their size, so only colors are reduced)'}.
            </label>
          ) : (
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">Colors
                <select className="input !w-auto !py-1.5" value={colors} onChange={(e) => setColors(Number(e.target.value))}>
                  <option value={0}>All (lossless)</option>{[256, 192, 128, 96, 64, 32].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              {allowScale && (
                <label className="flex items-center gap-2">Size
                  <select className="input !w-auto !py-1.5" value={scale} onChange={(e) => setScale(Number(e.target.value))}>
                    {[1, 0.9, 0.85, 0.75, 0.65, 0.5].map((n) => <option key={n} value={n}>{Math.round(n * 100)}%</option>)}
                  </select>
                </label>
              )}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <figure className="space-y-1">
              <div className="checker flex h-56 items-center justify-center overflow-hidden rounded-lg">{before && <img src={before} alt="" className="max-h-full max-w-full" />}</div>
              <figcaption className="text-xs text-text-2">Now: {fmtSize(blob.size)}</figcaption>
            </figure>
            <figure className="space-y-1">
              <div className="checker flex h-56 items-center justify-center overflow-hidden rounded-lg">
                {result ? <img src={result.url} alt="" className="max-h-full max-w-full" data-optimize-result /> : running ? <span className="flex items-center gap-2 text-sm text-text-1"><Loader2 size={16} className="animate-spin" />{running}…</span> : <span className="text-sm text-text-2">The result shows here.</span>}
              </div>
              {result && (
                <figcaption className={`text-xs ${result.fits ? 'text-text-1' : 'text-warn'}`} data-optimize-size={result.blob.size}>
                  After: {fmtSize(result.blob.size)} ({saved > 0 ? `${saved}% smaller` : 'no smaller'}) · {result.colors ? `${result.colors} colors` : 'lossless'}{result.scale < 1 ? ` · ${result.width}×${result.height}` : ''} · {result.frames} frame{result.frames === 1 ? '' : 's'}
                  {!result.fits && ' · the smallest it got without spoiling it; try fewer colors or a smaller size'}
                </figcaption>
              )}
            </figure>
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
          <p className="text-xs text-text-2">Animated pictures keep every frame and its timing. Fewer colors can band smooth gradients: compare the two before applying.</p>
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
          {running ? <button type="button" className="btn-ghost" onClick={cancel}>Stop</button> : <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>}
          <button type="button" className="btn-ghost" disabled={!!running} onClick={() => void run()} data-optimize-run>{result ? 'Try again' : 'Optimize'}</button>
          <button type="button" className="btn-primary" disabled={!result || result.blob.size >= blob.size || !!running} onClick={() => result && onApply(result.blob)} data-optimize-apply>Use it</button>
        </div>
      </div>
    </div>
  )
}
