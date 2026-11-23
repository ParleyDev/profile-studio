import { Loader2, Plus, Sparkles, X } from 'lucide-react'
import { TagLabel } from './Tags'
import { useMemo, useState } from 'react'
import { suggestTags, type Suggestion } from '../format/suggest'
import { tagsOf } from '../format/tags'
import type { Item } from '../format/workspace'
import Thumb from '../components/Thumb'
import { usePool, useFeatures } from '../lib/features'
import { tagItems, useStudio } from '../lib/store'
import { themeLabels } from '../format/shop'

const why = (s: Suggestion) => s.why.join(' · ')

/** "Suggest tags" under an item's Tags: proposals as chips, each added with a click. */
export function TagSuggestions({ item, onAdd }: { item: Item; onAdd: (tags: string[]) => void }) {
  const [on, setOn] = useState(false)
  const pool = usePool()
  const targets = useMemo(() => [item], [item])
  const { feats, progress } = useFeatures(targets, pool, on)
  const { ws } = useStudio()
  const labels = useMemo(() => themeLabels(ws), [ws])
  const list = useMemo(() => (on ? suggestTags(item, pool, feats, { labels }) : []), [on, item, pool, feats, labels])

  if (!on) return <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setOn(true)} title="Tags from its name and description, its colours, and what similar items are tagged" data-suggest-tags><Sparkles size={14} />Suggest tags</button>
  return (
    <div className="flex flex-wrap items-center gap-1 text-xs" data-tag-suggestions>
      <span className="flex items-center gap-1 text-text-2"><Sparkles size={13} />Suggested:</span>
      {list.map((s) => (
        <button key={s.tag} type="button" className="flex items-center gap-0.5 rounded-full border border-dashed border-accent/60 px-2 py-0.5 text-text-1 hover:border-accent hover:bg-accent/15 hover:text-text-0" title={`Add ${s.tag}: ${why(s)}`} onClick={() => onAdd([s.tag])} data-suggestion={s.tag}>
          <Plus size={11} /><TagLabel tag={s.tag} /><span className="ml-1 max-w-48 truncate text-text-2">{s.why[0]}</span>
        </button>
      ))}
      {progress && <span className="flex items-center gap-1 text-text-2"><Loader2 size={12} className="animate-spin" />Looking at pictures {progress.done} of {progress.total}</span>}
      {!progress && !list.length && <span className="text-text-2">Nothing to suggest.</span>}
      {list.length > 1 && <button type="button" className="btn-ghost !px-2 !py-0.5 text-xs" onClick={() => onAdd(list.map((s) => s.tag))} data-suggestion-all>Add all</button>}
      <button type="button" className="rounded p-0.5 text-text-2 hover:text-text-0" title="Hide suggestions" onClick={() => setOn(false)}><X size={12} /></button>
    </div>
  )
}

/** Suggestions for many items at once (gallery Select): review per item, untick what's wrong, add the rest. */
export function SuggestMany({ items: picked, onClose }: { items: Item[]; onClose: () => void }) {
  const pool = usePool()
  // As they stand now, drafts included.
  const items = useMemo(() => picked.map((p) => pool.find((i) => i.uid === p.uid) ?? p), [picked, pool])
  const { feats, progress } = useFeatures(items, pool, true)
  // Frozen once the pictures are in, so ticking doesn't reshuffle what's shown.
  const { ws } = useStudio()
  const labels = useMemo(() => themeLabels(ws), [ws])
  const rows = useMemo(() => (progress ? [] : items.map((it) => ({ it, list: suggestTags(it, pool, feats, { max: 8, labels }) }))), [progress, items, pool, feats, labels])
  const [off, setOff] = useState<Set<string>>(new Set())
  const key = (uid: string, tag: string) => `${uid}\n${tag}`
  const flip = (k: string) => setOff((o) => { const n = new Set(o); if (n.has(k)) n.delete(k); else n.add(k); return n })
  const withSome = rows.filter((r) => r.list.length)
  const chosen = withSome.map((r) => ({ uid: r.it.uid, tags: r.list.map((s) => s.tag).filter((t) => !off.has(key(r.it.uid, t))) })).filter((c) => c.tags.length)
  const count = chosen.reduce((n, c) => n + c.tags.length, 0)
  const apply = () => { for (const c of chosen) tagItems([c.uid], c.tags); onClose() }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-bg-0/70 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }} data-suggest-many>
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col rounded-xl border border-line bg-bg-1 shadow-2xl" role="dialog" aria-modal="true" aria-label="Suggested tags">
        <div className="flex items-start gap-3 border-b border-line px-5 py-4">
          <div className="flex-1">
            <h2 className="text-lg font-bold">Suggested tags</h2>
            <p className="text-sm text-text-2">From names and descriptions, colours, and what similar items are tagged. Untick any that don't fit.</p>
          </div>
          <button type="button" className="text-text-2 hover:text-text-0" title="Close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-5 py-4">
          {progress && <p className="flex items-center gap-2 text-sm text-text-1"><Loader2 size={16} className="animate-spin" />Looking at pictures {progress.done} of {progress.total}</p>}
          {withSome.map(({ it, list }) => (
            <div key={it.uid} className="flex items-start gap-3 rounded-lg border border-line p-2" data-suggest-row={it.uid}>
              <Thumb item={it} size={40} />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-baseline gap-2">
                  <span className="truncate text-sm font-semibold">{(it.entry.name as string) || 'Untitled'}</span>
                  {tagsOf(it).length > 0 && <span className="truncate text-[11px] text-text-2">has {tagsOf(it).map((t) => `#${t}`).join(' ')}</span>}
                </div>
                <div className="flex flex-wrap gap-1">
                  {list.map((s) => {
                    const k = key(it.uid, s.tag), yes = !off.has(k)
                    return <button key={s.tag} type="button" className={`flex items-center rounded-full border px-2 py-0.5 text-xs ${yes ? 'border-accent bg-accent/20 text-text-0' : 'border-line text-text-2 line-through'}`} aria-pressed={yes} title={why(s)} onClick={() => flip(k)} data-suggest-chip={s.tag}><TagLabel tag={s.tag} /></button>
                  })}
                </div>
              </div>
            </div>
          ))}
          {!progress && rows.length > withSome.length && <p className="text-sm text-text-2">Nothing to suggest for {rows.length - withSome.length} of them.</p>}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" disabled={!count} onClick={apply} data-suggest-apply>Add {count || ''} tag{count === 1 ? '' : 's'}{chosen.length ? ` to ${chosen.length} item${chosen.length === 1 ? '' : 's'}` : ''}</button>
        </div>
      </div>
    </div>
  )
}
