import { AlertTriangle, Check, CheckSquare, CircleAlert, Plus, Sparkles, Tags, X } from 'lucide-react'
import { memo, useMemo, useState } from 'react'
import { KIND_LABELS, type Kind } from '../format/kinds'
import { allTags, tagsOf } from '../format/tags'
import type { Problem } from '../format/validate'
import { keyOf, type Item } from '../format/workspace'
import TagInput from '../editors/Tags'
import { SuggestMany } from '../editors/Suggest'
import Thumb from './Thumb'
import { MarkBadge } from './Sidebar'
import { tagItems, useStudio, type Marks } from '../lib/store'
import { bundleIndex, bundlesWith, shopOf, themeLabel, themeLabels } from '../format/shop'

const Card = memo(function Card({ item, err, warn, mark, picking, picked, onOpen, onPick }: {
  item: Item; err: number; warn: number; mark?: 'new' | 'updated'
  /** Choosing items for tagging: a click picks instead of opening. */
  picking: boolean; picked: boolean
  onOpen: (uid: string) => void; onPick: (uid: string) => void
}) {
  const tags = tagsOf(item)
  return (
    <button
      type="button"
      className={`group relative flex flex-col gap-2 rounded-lg border bg-bg-1 p-2 text-left ${picked ? 'border-accent ring-1 ring-accent' : 'border-line hover:border-accent/60'}`}
      style={{ contentVisibility: 'auto', containIntrinsicSize: '160px 200px' }}
      onClick={() => (picking ? onPick(item.uid) : onOpen(item.uid))}
      aria-pressed={picking ? picked : undefined}
      data-gallery-card={keyOf(item)}
    >
      {picking && <span className={`absolute left-3 top-3 z-[1] flex h-5 w-5 items-center justify-center rounded border ${picked ? 'border-accent bg-accent text-white' : 'border-line bg-bg-1/90'}`}>{picked && <Check size={14} />}</span>}
      {item.kind === 'nameplate' ? <Thumb item={item} size={320} height={72} className="!w-full" /> : <Thumb item={item} size={140} className="!w-full" />}
      <div className="flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate text-sm">{(item.entry.name as string) || keyOf(item) || 'Untitled'}</span>
        <MarkBadge mark={mark} />
        {err > 0 && <CircleAlert size={13} className="shrink-0 text-danger" aria-label={`${err} errors`} />}
        {!err && warn > 0 && <AlertTriangle size={13} className="shrink-0 text-warn" aria-label={`${warn} warnings`} />}
      </div>
      <span className="truncate font-mono text-[11px] text-text-2">{keyOf(item)}</span>
      {tags.length > 0 && <span className="truncate text-[11px] text-text-2" title={tags.join(', ')}>{tags.map((t) => `#${t}`).join(' ')}</span>}
    </button>
  )
})

// How to group is remembered in this browser.
type GroupBy = 'none' | 'tag' | 'theme' | 'color' | 'bundle'
const GROUP_KEY = 'parley-profile-studio:gallery-group'
const loadGroup = (): GroupBy => { try { const v = localStorage.getItem(GROUP_KEY); return v === 'tag' || v === 'theme' || v === 'color' || v === 'bundle' ? v : 'none' } catch { return 'none' } }
const NONE_LABEL: Record<GroupBy, string> = { none: '', tag: 'No tags', theme: 'No themes', color: 'No colours', bundle: 'Not in a bundle' }

/** Every item of a kind as a grid of stills; each card decodes its still only when it scrolls into view. */
export default function Gallery({ kind, items, total, problems, marks, onOpen, onNew }: { kind: Kind; items: Item[]; total: number; problems: Map<string, Problem[]>; marks: Marks; onOpen: (uid: string) => void; onNew: () => void }) {
  const [groupBy, setGroupByRaw] = useState(loadGroup)
  const setGroupBy = (v: GroupBy) => { setGroupByRaw(v); try { localStorage.setItem(GROUP_KEY, v) } catch { /* this visit only */ } }
  const { ws } = useStudio()
  const labels = useMemo(() => themeLabels(ws), [ws])
  const bundles = useMemo(() => bundleIndex(ws, ws.items), [ws])
  // Only offer theme, colour and bundle grouping when some item has them (from a sync script or special tags).
  const hasThemes = items.some((i) => shopOf(i).allThemes.length)
  const hasColors = items.some((i) => shopOf(i).allColors.length)
  const hasBundles = bundles.size > 0
  const [picking, setPicking] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState<string[]>([])
  const [suggesting, setSuggesting] = useState(false)
  const pick = (uid: string) => setPicked((p) => { const n = new Set(p); if (n.has(uid)) n.delete(uid); else n.add(uid); return n })
  const stopPicking = () => { setPicking(false); setPicked(new Set()); setAdding([]) }

  const groups = useMemo<[string | null, Item[]][]>(() => {
    if (groupBy === 'none') return [[null, items]]
    // Each item under every group it belongs to, the biggest groups first.
    const keysOf = (it: Item): string[] => {
      if (groupBy === 'tag') return tagsOf(it).map((t) => `#${t}`)
      const s = shopOf(it)
      if (groupBy === 'theme') return s.allThemes.map((t) => themeLabel(t, labels))
      if (groupBy === 'color') return s.allColors.map((c) => c.replace(/_/g, ' '))
      return bundlesWith(it, bundles).map((b) => b.name)
    }
    const by = new Map<string, Item[]>()
    const none: Item[] = []
    for (const it of items) {
      const keys = keysOf(it)
      if (!keys.length) none.push(it)
      for (const k of keys) by.set(k, [...(by.get(k) ?? []), it])
    }
    const out: [string | null, Item[]][] = [...by].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    if (none.length) out.push(['', none])
    return out
  }, [groupBy, items, labels, bundles])
  const pickedItems = items.filter((i) => picked.has(i.uid))
  const pickedTags = allTags(pickedItems)

  return (
    <div className="space-y-4" data-gallery={kind}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{KIND_LABELS[kind].many}</h1>
          <p className="text-sm text-text-2">{items.length === total ? `${total} item${total === 1 ? '' : 's'}` : `${items.length} of ${total} shown`} · {KIND_LABELS[kind].blurb}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <label className="flex items-center gap-1.5 px-2 text-sm text-text-2" title="A section per tag, theme, colour or bundle (an item shows under each one it has)">
            <Tags size={16} />Group
            <select className="input !w-auto !py-1 text-sm" value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)} data-gallery-group>
              <option value="none">None</option>
              <option value="tag">By tag</option>
              {(hasThemes || groupBy === 'theme') && <option value="theme">By theme</option>}
              {(hasColors || groupBy === 'color') && <option value="color">By colour</option>}
              {(hasBundles || groupBy === 'bundle') && <option value="bundle">By bundle</option>}
            </select>
          </label>
          <button type="button" className={`btn-ghost ${picking ? '!bg-bg-3 !text-text-0' : ''}`} aria-pressed={picking} onClick={() => (picking ? stopPicking() : setPicking(true))} title="Pick items to tag them together" data-gallery-select><CheckSquare size={16} />Select</button>
          <button type="button" className="btn-ghost" onClick={onNew}><Plus size={16} />New {KIND_LABELS[kind].one.toLowerCase()}</button>
        </div>
      </div>

      {picking && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-accent/40 bg-bg-2/95 px-3 py-2 text-sm shadow-lg backdrop-blur" data-gallery-picking>
          <span className="font-semibold" data-gallery-picked>{picked.size} selected</span>
          <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setPicked(new Set(items.map((i) => i.uid)))}>All {items.length}</button>
          <button type="button" className="btn-ghost !px-2 !py-1 text-xs" disabled={!picked.size} onClick={() => setPicked(new Set())}>None</button>
          <div className="min-w-56 flex-1"><TagInput value={adding} onChange={setAdding} suggestions={allTags(items).map(([t]) => t)} placeholder="Tags to add" data-gallery-add-tags /></div>
          <button type="button" className="btn-primary !py-1.5" disabled={!picked.size || !adding.length} onClick={() => { tagItems([...picked], adding); setAdding([]) }} data-gallery-add>Add to {picked.size}</button>
          {pickedTags.length > 0 && (
            <span className="flex flex-wrap items-center gap-1 text-xs text-text-2">Take off:
              {pickedTags.map(([t, n]) => <button key={t} type="button" className="flex items-center gap-0.5 rounded-full border border-line px-2 py-0.5 hover:border-danger hover:text-danger" title={`Remove ${t} from the ${n} selected item${n === 1 ? '' : 's'} that have it`} onClick={() => tagItems([...picked], [], [t])} data-gallery-remove={t}>#{t} {n}<X size={10} /></button>)}
            </span>
          )}
          <button type="button" className="btn-ghost !py-1.5" disabled={!picked.size} onClick={() => setSuggesting(true)} title="Suggest tags for the selected items to review" data-gallery-suggest><Sparkles size={14} />Suggest for {picked.size}</button>
          <button type="button" className="btn-ghost !py-1.5" onClick={stopPicking}>Done</button>
        </div>
      )}

      {suggesting && <SuggestMany items={pickedItems} onClose={() => setSuggesting(false)} />}

      {items.length ? groups.map(([tag, list]) => (
        <section key={tag ?? '*'} className="space-y-2" data-gallery-section={tag ?? undefined}>
          {tag !== null && (
            <div className="flex items-center gap-2">
              <h2 className="font-semibold">{tag || NONE_LABEL[groupBy]} <span className="text-sm font-normal text-text-2">{list.length}</span></h2>
              {picking && <button type="button" className="btn-ghost !px-2 !py-0.5 text-xs" onClick={() => setPicked((p) => new Set([...p, ...list.map((i) => i.uid)]))}>Select these</button>}
            </div>
          )}
          <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${kind === 'nameplate' ? 300 : 160}px, 1fr))` }}>
            {list.map((it) => {
              const l = problems.get(it.uid) ?? []
              const err = l.filter((p) => p.level === 'error').length
              return <Card key={it.uid} item={it} err={err} warn={l.length - err} mark={marks[it.uid]} picking={picking} picked={picked.has(it.uid)} onOpen={onOpen} onPick={pick} />
            })}
          </div>
        </section>
      )) : <p className="text-sm text-text-2">Nothing here{total ? ' matches the search or filter' : ' yet'}.</p>}
    </div>
  )
}
