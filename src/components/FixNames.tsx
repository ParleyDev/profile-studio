import { ArrowRight, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { KIND_LABELS } from '../format/kinds'
import type { NameFix } from '../format/names'
import { keyOf, type Item } from '../format/workspace'
import { renameItems } from '../lib/store'

/** Review tidied names, untick any, and rename the rest at once. */
export default function FixNames({ fixes, items, onClose }: { fixes: NameFix[]; items: Item[]; onClose: () => void }) {
  const [skip, setSkip] = useState<Set<string>>(new Set())
  const byUid = useMemo(() => new Map(items.map((i) => [i.uid, i])), [items])
  const chosen = fixes.filter((f) => !skip.has(f.uid))
  const toggle = (uid: string) => { const n = new Set(skip); if (n.has(uid)) n.delete(uid); else n.add(uid); setSkip(n) }
  const apply = () => { renameItems(chosen); onClose() }
  const Pair = ({ from, to }: { from: string; to: string }) => (
    <span className="flex flex-wrap items-center gap-1.5 font-mono text-xs"><span className="text-text-2 line-through">{from}</span><ArrowRight size={12} className="text-text-2" /><span>{to}</span></span>
  )

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-bg-0/70 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }} data-fix-names>
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col rounded-xl border border-line bg-bg-1 shadow-2xl" role="dialog" aria-modal="true" aria-label="Fix names">
        <div className="flex items-start gap-3 border-b border-line px-5 py-4">
          <div className="flex-1">
            <h2 className="text-lg font-bold">Fix names</h2>
            <p className="text-sm text-text-2">
              Characters Parley refuses become '_'. Items already on the instance keep their file or folder name, since members
              wearing them store its id; only their layer files are renamed. Display names don't change. Untick any you'd rather
              rename yourself.
            </p>
          </div>
          <button type="button" className="text-text-2 hover:text-text-0" title="Close" onClick={onClose}><X size={18} /></button>
        </div>
        <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto px-5">
          {fixes.map((f) => {
            const it = byUid.get(f.uid)
            return (
              <li key={f.uid} className="flex items-start gap-3 py-2" data-fix-row={it ? keyOf(it) : f.uid}>
                <input type="checkbox" className="mt-1" checked={!skip.has(f.uid)} onChange={() => toggle(f.uid)} />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="text-sm"><span className="font-semibold">{(it?.entry.name as string) || (it ? keyOf(it) : f.uid)}</span> <span className="text-xs text-text-2">{KIND_LABELS[f.kind].one}</span></div>
                  {f.key && <Pair {...f.key} />}
                  {f.files.map((x) => <Pair key={x.from} {...x} />)}
                </div>
              </li>
            )
          })}
        </ul>
        <div className="flex items-center gap-3 border-t border-line px-5 py-3">
          <span className="flex-1 text-xs text-text-2">Renames change what's open (and bundles.local.json references). Compare again afterwards.</span>
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" disabled={!chosen.length} onClick={apply} data-fix-apply>Rename {chosen.length}</button>
        </div>
      </div>
    </div>
  )
}
