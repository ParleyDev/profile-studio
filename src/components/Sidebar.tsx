import { AlertTriangle, ChevronDown, ChevronRight, CircleAlert, LayoutGrid, Plus, Search, X } from 'lucide-react'
import { memo, useEffect, useRef, type RefObject } from 'react'
import { KIND_DIRS, KIND_LABELS, KINDS, type Kind } from '../format/kinds'
import type { Problem } from '../format/validate'
import { keyOf, type Item } from '../format/workspace'
import Thumb from './Thumb'

export type Filter = 'all' | 'errors' | 'warnings'
export interface Nav { query: string; filter: Filter; collapsed: Set<Kind> }

const counts = (list: Problem[] | undefined) => {
  const err = list?.filter((p) => p.level === 'error').length ?? 0
  return { err, warn: (list?.length ?? 0) - err }
}

/** The items a search and filter leave, by kind, in metadata.json order. */
export function visibleItems(items: Item[], problems: Map<string, Problem[]>, nav: Nav): Map<Kind, Item[]> {
  const q = nav.query.trim().toLowerCase()
  const out = new Map<Kind, Item[]>(KINDS.map((k) => [k, []]))
  for (const it of items) {
    if (q && !`${it.entry.name ?? ''}\n${keyOf(it)}\n${it.entry.description ?? ''}`.toLowerCase().includes(q)) continue
    if (nav.filter !== 'all') {
      const c = counts(problems.get(it.uid))
      if (nav.filter === 'errors' ? !c.err : !c.warn) continue
    }
    out.get(it.kind)!.push(it)
  }
  return out
}

const Row = memo(function Row({ item, err, warn, selected, edited, onSelect }: { item: Item; err: number; warn: number; selected: boolean; edited: boolean; onSelect: (uid: string) => void }) {
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => { if (selected) ref.current?.scrollIntoView({ block: 'nearest' }) }, [selected])
  return (
    <button
      ref={ref}
      type="button"
      className={`flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-sm ${selected ? 'bg-bg-4 text-text-0' : 'text-text-1 hover:bg-bg-3'}`}
      onClick={() => onSelect(item.uid)}
      data-item-row={item.uid}
      data-row-key={keyOf(item)}
      aria-current={selected || undefined}
    >
      <Thumb item={item} size={28} />
      <span className="min-w-0 flex-1 truncate">{(item.entry.name as string) || keyOf(item) || 'Untitled'}</span>
      {edited && <span className="h-2 w-2 shrink-0 rounded-full bg-accent" title="Edited: changes not saved yet" data-row-edited />}
      {err > 0 && <span className="flex items-center gap-0.5 text-xs text-danger" title={`${err} error${err === 1 ? '' : 's'}: Parley would refuse it`} data-badge-error><CircleAlert size={12} />{err}</span>}
      {warn > 0 && <span className="flex items-center gap-0.5 text-xs text-warn" title={`${warn} warning${warn === 1 ? '' : 's'}`} data-badge-warning><AlertTriangle size={12} />{warn}</span>}
    </button>
  )
})

export default function Sidebar({ items, total, problems, nav, setNav, selected, galleryKind, edited, onSelect, onGallery, onNew, searchRef }: {
  items: Map<Kind, Item[]>
  total: Map<Kind, number>
  problems: Map<string, Problem[]>
  nav: Nav
  setNav: (n: Nav) => void
  selected: string | null
  galleryKind: Kind | null
  /** Items with a draft of changes not saved yet. */
  edited: Record<string, unknown>
  onSelect: (uid: string) => void
  onGallery: (k: Kind) => void
  onNew: (k: Kind) => void
  searchRef: RefObject<HTMLInputElement | null>
}) {
  let errs = 0, warns = 0
  for (const l of problems.values()) { const c = counts(l); if (c.err) errs++; if (c.warn) warns++ }
  const toggle = (k: Kind) => { const c = new Set(nav.collapsed); if (c.has(k)) c.delete(k); else c.add(k); setNav({ ...nav, collapsed: c }) }
  const filtered = nav.query.trim() !== '' || nav.filter !== 'all'
  return (
    <nav className="flex w-72 shrink-0 flex-col border-r border-line bg-bg-1" data-sidebar>
      <div className="space-y-2 border-b border-line p-2">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-2" />
          <input
            ref={searchRef}
            className="input !py-1.5 !pl-8 !pr-7"
            placeholder="Search names and files  ( / )"
            title="/ to search · ↓ or Enter to open the first match · Esc to clear"
            value={nav.query}
            onChange={(e) => setNav({ ...nav, query: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { setNav({ ...nav, query: '' }); e.currentTarget.blur() }
              // ↓ or Enter go to the first match, so search-then-arrow works without the mouse.
              else if (e.key === 'ArrowDown' || e.key === 'Enter') {
                const first = KINDS.filter((k) => !nav.collapsed.has(k)).flatMap((k) => items.get(k)!)[0]
                if (first) { e.preventDefault(); e.currentTarget.blur(); onSelect(first.uid) }
              }
            }}
            data-search
          />
          {nav.query && <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-text-2 hover:text-text-0" title="Clear" onClick={() => setNav({ ...nav, query: '' })}><X size={14} /></button>}
        </div>
        <div className="flex gap-1 text-xs" role="radiogroup" aria-label="Show">
          {([['all', 'All'], ['errors', `Errors ${errs}`], ['warnings', `Warnings ${warns}`]] as const).map(([f, label]) => (
            <button key={f} type="button" role="radio" aria-checked={nav.filter === f} className={`rounded px-2 py-1 ${nav.filter === f ? 'bg-bg-4 text-text-0' : 'text-text-2 hover:bg-bg-3'} ${f === 'errors' && errs ? 'text-danger' : ''}`} onClick={() => setNav({ ...nav, filter: f })} data-filter={f}>{label}</button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {KINDS.map((k) => {
          const list = items.get(k)!
          const open = !nav.collapsed.has(k)
          const all = total.get(k) ?? 0
          if (filtered && !list.length) return null
          return (
            <section key={k} className="mb-2" data-kind-section={k}>
              <div className={`group flex items-center gap-1 rounded px-1 py-1 ${galleryKind === k ? 'bg-bg-3' : ''}`}>
                <button type="button" className="flex min-w-0 flex-1 items-center gap-1 text-left" onClick={() => toggle(k)} aria-expanded={open} title={`${KIND_DIRS[k]}/`} data-kind-toggle={k}>
                  {open ? <ChevronDown size={14} className="text-text-2" /> : <ChevronRight size={14} className="text-text-2" />}
                  <span className="text-[11px] font-bold uppercase tracking-wider text-text-2">{KIND_LABELS[k].many}</span>
                  <span className="text-[11px] text-text-2">{filtered ? `${list.length}/${all}` : all}</span>
                </button>
                <button type="button" className="rounded p-0.5 text-text-2 hover:text-text-0" title={`Browse ${KIND_LABELS[k].many.toLowerCase()}`} onClick={() => onGallery(k)} data-kind-gallery={k}><LayoutGrid size={14} /></button>
                <button type="button" className="rounded p-0.5 text-text-2 hover:text-text-0" title={`New ${KIND_LABELS[k].one.toLowerCase()}`} onClick={() => onNew(k)} data-kind-new={k}><Plus size={14} /></button>
              </div>
              {open && list.map((it) => {
                const c = counts(problems.get(it.uid))
                return <Row key={it.uid} item={it} err={c.err} warn={c.warn} selected={it.uid === selected && !galleryKind} edited={it.uid in edited} onSelect={onSelect} />
              })}
            </section>
          )
        })}
        {filtered && KINDS.every((k) => !items.get(k)!.length) && <p className="px-2 py-4 text-sm text-text-2">Nothing matches.</p>}
      </div>
    </nav>
  )
}
