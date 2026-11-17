import { AlertTriangle, Upload, XCircle } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import type { Problem } from '../format/validate'

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-text-2">{hint}</span>}
    </label>
  )
}

/** A whole number input that keeps what's typed until it's a number. */
export function Num({ value, onChange, min = 0, max, step = 1, ...rest }: { value: number | undefined; onChange: (n: number) => void; min?: number; max: number; step?: number } & Record<`data-${string}`, string | boolean>) {
  return <input type="number" className="input !py-1.5" value={value ?? ''} min={min} max={max} step={step} onChange={(e) => { const n = Math.round(Number(e.target.value)); if (e.target.value !== '' && Number.isFinite(n)) onChange(n) }} {...rest} />
}

/** A drop target and a picker for one or more files. */
export function DropFiles({ accept, multiple, onFiles, children, compact, ...rest }: { accept: string; multiple?: boolean; onFiles: (files: File[]) => void; children: ReactNode; compact?: boolean } & Record<`data-${string}`, string | boolean>) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setOver(false); const f = [...e.dataTransfer.files]; if (f.length) onFiles(multiple ? f : f.slice(0, 1)) }}
      className={`flex items-center gap-3 rounded-lg border border-dashed ${over ? 'border-accent bg-accent/10' : 'border-line'} ${compact ? 'p-2' : 'p-4'}`}
      {...rest}
    >
      <button type="button" className="btn-ghost bg-bg-3 !px-3 !py-1.5 shrink-0" onClick={() => input.current?.click()}><Upload size={14} />Choose</button>
      <span className="min-w-0 text-sm text-text-2">{children}</span>
      <input ref={input} type="file" accept={accept} multiple={multiple} className="hidden" onChange={(e) => { const f = [...(e.target.files ?? [])]; if (f.length) onFiles(f); e.target.value = '' }} />
    </div>
  )
}

export function Problems({ list }: { list: Problem[] }) {
  if (!list.length) return null
  return (
    <ul className="space-y-1" data-problems>
      {list.map((p, i) => (
        <li key={i} className={`flex items-start gap-2 text-sm ${p.level === 'error' ? 'text-danger' : 'text-warn'}`} data-problem={p.level}>
          {p.level === 'error' ? <XCircle size={15} className="mt-0.5 shrink-0" /> : <AlertTriangle size={15} className="mt-0.5 shrink-0" />}<span>{p.message}</span>
        </li>
      ))}
    </ul>
  )
}

export const fmtSize = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
