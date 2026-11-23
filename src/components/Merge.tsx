import { FilePen, Loader2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { KIND_LABELS } from '../format/kinds'
import { keyOf, type Workspace } from '../format/workspace'
import type { MergeAction, MergeRow } from '../lib/merge'
import { mergeItems } from '../lib/store'
import Thumb from './Thumb'

export interface MergeSource {
  rows: MergeRow[]
  notes: string[]
  extras?: Workspace['extras']
  bundles?: Workspace['bundles']
  format?: Workspace['format']
  localBundles?: Workspace['localBundles']
}

const GROUPS: { action: MergeAction; title: string; blurb: string }[] = [
  { action: 'new', title: 'New', blurb: 'Added to what\'s open.' },
  { action: 'changed', title: 'Changed', blurb: 'Replace the open version. Where you have a draft, it stays on top.' },
  { action: 'skip', title: 'Left out', blurb: '' },
]

/**
 * Review what a merge brings in, pick, and apply it. `load` reads and compares (the instance, or a folder already
 * read); the open items stay unless an incoming one with the same id replaces it.
 */
export default function Merge({ title, from, load, onReplace, onApplied, onClose }: {
  title: string
  /** Where the items come from, in words. */
  from: string
  load: (onProgress: (label: string, done: number, total: number) => void, signal: AbortSignal) => Promise<MergeSource>
  /** Offer replacing everything instead (opening a folder). */
  onReplace?: () => void
  onApplied: (summary: string, rows: MergeRow[]) => void
  onClose: () => void
}) {
  const [progress, setProgress] = useState<{ label: string; done: number; total: number } | null>({ label: 'Reading', done: 0, total: 0 })
  const [src, setSrc] = useState<MergeSource | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [off, setOff] = useState<Set<MergeRow>>(new Set())
  const stop = useRef<AbortController | null>(null)

  useEffect(() => {
    const ctl = new AbortController()
    stop.current = ctl
    load((label, done, total) => setProgress({ label, done, total }), ctl.signal)
      .then((s) => { if (!ctl.signal.aborted) setSrc(s) })
      .catch((e: unknown) => { if (!ctl.signal.aborted) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (!ctl.signal.aborted) setProgress(null) })
    return () => ctl.abort()
  }, [load])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const rows = useMemo(() => src?.rows ?? [], [src])
  const picked = rows.filter((r) => (r.action === 'new' || r.action === 'changed') && !off.has(r))
  const same = rows.filter((r) => r.action === 'same').length
  const toggle = (list: MergeRow[], on: boolean) => { const s = new Set(off); for (const r of list) { if (on) s.delete(r); else s.add(r) } setOff(s) }

  const apply = () => {
    mergeItems(picked.map((r) => ({ replace: r.action === 'changed' ? r.local?.uid : undefined, item: r.incoming })), src?.extras, src?.bundles, src?.format, src?.localBundles)
    const n = picked.filter((r) => r.action === 'new').length, u = picked.length - n
    onApplied([n && `${n} new`, u && `${u} updated`].filter(Boolean).join(', ') || 'Nothing', picked)
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-bg-0/70 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }} data-merge>
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col rounded-xl border border-line bg-bg-1 shadow-2xl" role="dialog" aria-modal="true" aria-label={title}>
        <div className="flex items-start gap-3 border-b border-line px-5 py-4">
          <div className="flex-1">
            <h2 className="text-lg font-bold">{title}</h2>
            <p className="text-sm text-text-2">From {from}. Items match by id, the way Parley matches them; nothing open is removed.</p>
          </div>
          <button type="button" className="text-text-2 hover:text-text-0" title="Close (Esc)" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {progress && (
            <div className="flex items-center gap-2 text-sm text-text-1" data-merge-progress>
              <Loader2 size={16} className="animate-spin" />
              <span className="flex-1">{progress.label}{progress.total ? ` ${progress.done.toLocaleString()} of ${progress.total.toLocaleString()}` : '…'}</span>
              <button type="button" className="btn-ghost !py-1" onClick={() => { stop.current?.abort(); onClose() }}>Stop</button>
            </div>
          )}
          {error && <p className="text-sm text-danger" data-merge-error>{error}</p>}
          {src && (
            <>
              {src.notes.length > 0 && <ul className="space-y-0.5 text-sm text-text-2">{src.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
              {GROUPS.map((g) => {
                const list = rows.filter((r) => r.action === g.action)
                if (!list.length) return null
                const pickable = g.action !== 'skip'
                const allOn = list.every((r) => !off.has(r))
                return (
                  <section key={g.action} data-merge-group={g.action}>
                    <div className="mb-1 flex items-center gap-2">
                      {pickable && <input type="checkbox" checked={allOn} onChange={(e) => toggle(list, e.target.checked)} aria-label={`All ${g.title.toLowerCase()}`} />}
                      <h3 className="font-semibold">{g.title} <span className="text-text-2">{list.length}</span></h3>
                      {g.blurb && <span className="text-xs text-text-2">{g.blurb}</span>}
                    </div>
                    <ul className="divide-y divide-line rounded-lg border border-line">
                      {list.map((r, i) => (
                        <li key={i}>
                          <label className={`flex items-start gap-2 px-3 py-2 text-sm ${pickable ? 'cursor-pointer hover:bg-bg-2' : ''}`} data-merge-row={`${r.kind}/${r.id}`}>
                            {pickable && <input type="checkbox" className="mt-2" checked={!off.has(r)} onChange={(e) => toggle([r], e.target.checked)} />}
                            <Thumb item={r.incoming} size={32} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate">{(r.incoming.entry.name as string) || keyOf(r.incoming) || 'Untitled'} <span className="text-xs text-text-2">· {KIND_LABELS[r.kind].one}</span></span>
                              <span className="block truncate font-mono text-[11px] text-text-2">{keyOf(r.incoming)}</span>
                              {r.notes.length > 0 && <span className="block text-xs text-text-2">{r.notes.join(' · ')}</span>}
                              {r.draft && r.action === 'changed' && <span className="mt-0.5 flex items-center gap-1 text-xs text-accent"><FilePen size={12} />You have unsaved edits to it: they stay as a draft.</span>}
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </section>
                )
              })}
              {same > 0 && <p className="text-sm text-text-2" data-merge-same>{same} already the same as what's open.</p>}
              {!rows.some((r) => r.action === 'new' || r.action === 'changed') && <p className="text-sm" data-merge-nothing>Nothing to bring in: everything here is already open as it is.</p>}
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">
          {onReplace && <button type="button" className="btn-ghost mr-auto hover:!text-danger" onClick={() => { if (confirm('Replace everything open, drafts included, with this instead?')) onReplace() }} title="Close what's open and open this instead" data-merge-replace>Replace everything instead</button>}
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" disabled={!picked.length} onClick={apply} data-merge-apply>Merge {picked.length || ''}</button>
        </div>
      </div>
    </div>
  )
}
