import { Loader2 } from 'lucide-react'
import type { Progress, Saved } from '../lib/store'

const mb = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : `${Math.round(n / 1024 ** 2)} MB`)
const amount = (p: Progress) => (p.bytes ? `${mb(p.done)} of ${mb(p.total)}` : `${p.done.toLocaleString()} of ${p.total.toLocaleString()}`)

/** Covers the page while something it depends on is under way: opening a workspace, reading a folder, writing one. */
export default function Loading({ progress }: { progress: Progress }) {
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg-0/80 backdrop-blur-sm" role="alertdialog" aria-busy="true" aria-label={progress.label} data-loading>
      <div className="w-80 space-y-3 rounded-xl border border-line bg-bg-2 p-6 shadow-2xl">
        <div className="flex items-center gap-2 font-semibold"><Loader2 size={18} className="animate-spin text-accent" />{progress.label}…</div>
        <div className="h-1.5 overflow-hidden rounded-full bg-bg-4">
          {pct === null ? <div className="h-full w-1/3 animate-[slide_1.2s_ease-in-out_infinite] rounded-full bg-accent" /> : <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />}
        </div>
        {pct !== null && <div className="text-xs text-text-2">{amount(progress)} · {pct}%</div>}
      </div>
    </div>
  )
}

const LABEL: Record<Saved, string> = { saved: 'Backed up in this browser', saving: 'Backing up…', unsaved: 'Backing up…', off: 'Not backed up in this browser' }

/** The autosave state; a long first save shows how far it has got, without stopping you working. */
export function SaveStatus({ saved, saving }: { saved: Saved; saving: Progress | null }) {
  if (saving && saving.total) {
    const pct = Math.round((saving.done / saving.total) * 100)
    return (
      <span className="flex items-center gap-2 text-xs text-text-2" title={`${saving.label}: ${amount(saving)}`} data-saved="saving">
        <span className="h-1.5 w-24 overflow-hidden rounded-full bg-bg-4"><span className="block h-full bg-accent transition-[width]" style={{ width: `${pct}%` }} /></span>
        Backing up {pct}%
      </span>
    )
  }
  return <span className={`text-xs ${saved === 'off' ? 'text-warn' : 'text-text-2'}`} data-saved={saved}>{LABEL[saved]}</span>
}
