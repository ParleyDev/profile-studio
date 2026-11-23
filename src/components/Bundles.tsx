import { ArrowDown, ArrowLeft, ArrowUp, ExternalLink, Link2, Package, Plus, RotateCcw, Search, Trash2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { KIND_LABELS, KINDS, type Kind } from '../format/kinds'
import { bundlesOf, deletedBundles, findBundleItem, refOf, revertBundle, SHOP_TYPES, withBundle, withoutBundle, type Bundle, type BundleItem } from '../format/shop'
import { keyOf, type Item } from '../format/workspace'
import { usePool } from '../lib/features'
import { setLocalBundles, useStudio } from '../lib/store'
import Thumb from './Thumb'

type Show = 'all' | 'edited' | 'local' | 'missing'
const SOURCE: Record<NonNullable<Bundle['source']>, { label: string; title: string; cls: string }> = {
  sync: { label: 'Synced', title: 'As the sync script wrote it in bundles.json', cls: 'bg-bg-4 text-text-2' },
  edited: { label: 'Edited', title: 'Changed here: the changes are in bundles.local.json, so the next sync keeps them', cls: 'bg-accent/15 text-accent' },
  local: { label: 'Made here', title: 'Only in bundles.local.json', cls: 'bg-success/15 text-success' },
}
const kindOf = (x: BundleItem, it?: Item): Kind | undefined => it?.kind ?? (x.type ? SHOP_TYPES[x.type] : undefined)
const nameOf = (it: Item) => String(it.entry.name || keyOf(it) || 'Untitled')

/** Bundles: every one as a card, and one at a time to edit. Changes go to bundles.local.json; bundles.json is never changed. */
export default function Bundles({ open, onOpenBundle, onOpenItem }: { open: string | null; onOpenBundle: (id: string | null) => void; onOpenItem: (uid: string) => void }) {
  const { ws } = useStudio()
  const pool = usePool()
  const byShopId = useMemo(() => new Map(pool.filter((i) => typeof i.entry.shop_item_id === 'string').map((i) => [i.entry.shop_item_id as string, i])), [pool])
  const bundles = useMemo(() => bundlesOf(ws), [ws])
  const find = (x: BundleItem) => findBundleItem(x, pool, byShopId)
  const current = open ? bundles.find((b) => b.id === open) : undefined

  const save = (b: Bundle) => setLocalBundles(withBundle(ws, b))
  const create = () => {
    const id = `local-${Date.now().toString(36)}`
    setLocalBundles(withBundle(ws, { id, name: 'New bundle', items: [], source: 'local' }))
    onOpenBundle(id)
  }
  if (current) return <BundleEditor bundle={current} pool={pool} find={find} onSave={save} onBack={() => onOpenBundle(null)} onOpenItem={onOpenItem} />
  return <BundleList bundles={bundles} find={find} onOpen={onOpenBundle} onNew={create} />
}

function BundleList({ bundles, find, onOpen, onNew }: { bundles: Bundle[]; find: (x: BundleItem) => Item | undefined; onOpen: (id: string) => void; onNew: () => void }) {
  const { ws } = useStudio()
  const [q, setQ] = useState('')
  const [show, setShow] = useState<Show>('all')
  const hidden = deletedBundles(ws)
  const missing = (b: Bundle) => b.items.filter((x) => !find(x)).length
  const list = bundles.filter((b) => {
    if (show === 'edited' && b.source !== 'edited') return false
    if (show === 'local' && b.source !== 'local') return false
    if (show === 'missing' && !missing(b)) return false
    const text = q.trim().toLowerCase()
    return !text || `${b.name}\n${b.items.map((x) => x.name ?? '').join('\n')}`.toLowerCase().includes(text)
  })
  const count = (s: Show) => (s === 'all' ? bundles.length : s === 'missing' ? bundles.filter((b) => missing(b)).length : bundles.filter((b) => b.source === s).length)
  return (
    <div className="space-y-4" data-bundles>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Bundles</h1>
          <p className="text-sm text-text-2">{bundles.length} bundle{bundles.length === 1 ? '' : 's'} · Items sold together. Your changes are kept in bundles.local.json, so the sync script's bundles.json stays as it wrote it.</p>
        </div>
        <button type="button" className="btn-ghost" onClick={onNew} data-bundle-new><Plus size={16} />New bundle</button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-2" />
          <input className="input !py-1.5 !pl-8" placeholder="Search bundles and their items" value={q} onChange={(e) => setQ(e.target.value)} data-bundle-search />
        </div>
        <div className="flex items-center gap-0.5 text-xs" role="radiogroup" aria-label="Show">
          {([['all', 'All'], ['edited', 'Edited'], ['local', 'Made here'], ['missing', 'Missing items']] as [Show, string][]).map(([s, label]) => (
            <button key={s} type="button" role="radio" aria-checked={show === s} className={`rounded px-2 py-1 ${show === s ? 'bg-bg-4 text-text-0' : 'text-text-2 hover:bg-bg-3'}`} onClick={() => setShow(s)} data-bundle-filter={s}>{label} {count(s)}</button>
          ))}
        </div>
      </div>
      {hidden.length > 0 && (
        <p className="flex flex-wrap items-center gap-1 text-xs text-text-2">Deleted here (still in bundles.json):
          {hidden.map((h) => <button key={h.id} type="button" className="flex items-center gap-0.5 rounded-full border border-line px-2 py-0.5 hover:border-accent hover:text-text-0" title="Bring it back" onClick={() => setLocalBundles(revertBundle(ws, h.id))} data-bundle-restore={h.id}><RotateCcw size={10} />{h.name}</button>)}
        </p>
      )}
      {list.length ? (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
          {list.map((b) => {
            const found = b.items.map(find)
            const gone = found.filter((x) => !x).length
            return (
              <button key={b.id} type="button" className="flex flex-col gap-2 rounded-lg border border-line bg-bg-1 p-3 text-left hover:border-accent/60" style={{ contentVisibility: 'auto', containIntrinsicSize: '240px 130px' }} onClick={() => onOpen(b.id)} data-bundle-card={b.id}>
                <div className="flex h-12 items-center gap-1.5">
                  {found.slice(0, 5).map((it, i) => (it ? <Thumb key={i} item={it} size={44} /> : <span key={i} className="flex h-11 w-11 items-center justify-center rounded border border-dashed border-line text-text-2" title={`${b.items[i].name ?? 'An item'} isn't in this folder`}><Package size={14} /></span>))}
                  {b.items.length > 5 && <span className="text-xs text-text-2">+{b.items.length - 5}</span>}
                  {!b.items.length && <span className="text-xs text-text-2">No items yet</span>}
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate font-semibold">{b.name}</span>
                  {b.source && b.source !== 'sync' && <span className={`shrink-0 rounded px-1 py-px text-[10px] font-bold uppercase ${SOURCE[b.source].cls}`} title={SOURCE[b.source].title}>{SOURCE[b.source].label}</span>}
                </div>
                <span className="flex gap-2 text-xs text-text-2">
                  <span>{b.items.length} item{b.items.length === 1 ? '' : 's'}</span>
                  {b.price?.display && <span>{b.price.display}</span>}
                  {b.owned && <span className="text-success">Owned</span>}
                  {gone > 0 && <span className="text-warn">{gone} not in folder</span>}
                </span>
              </button>
            )
          })}
        </div>
      ) : <p className="text-sm text-text-2">{bundles.length ? 'Nothing matches.' : 'No bundles yet. Open a folder with a bundles.json, or make one.'}</p>}
    </div>
  )
}

function BundleEditor({ bundle: b, pool, find, onSave, onBack, onOpenItem }: {
  bundle: Bundle; pool: Item[]; find: (x: BundleItem) => Item | undefined
  onSave: (b: Bundle) => void; onBack: () => void; onOpenItem: (uid: string) => void
}) {
  const { ws } = useStudio()
  // Picking an item to add, or to stand for entry `relink`.
  const [picking, setPicking] = useState<{ relink?: number } | null>(null)
  const patch = (p: Partial<Bundle>) => onSave({ ...b, ...p })
  const items = b.items.map((x) => ({ ref: x, it: find(x) }))
  const move = (i: number, by: -1 | 1) => { const next = [...b.items]; const [x] = next.splice(i, 1); next.splice(i + by, 0, x); patch({ items: next }) }
  const price = b.price ?? {}
  const setPrice = (p: Partial<NonNullable<Bundle['price']>>) => {
    const next = { ...price, ...p }
    for (const k of Object.keys(next) as (keyof typeof next)[]) if (next[k] === undefined || next[k] === '') delete next[k]
    patch({ price: Object.keys(next).length ? next : null })
  }
  const pick = (it: Item) => {
    const ref = refOf(it)
    if (picking?.relink !== undefined) patch({ items: b.items.map((x, i) => (i === picking.relink ? ref : x)) })
    else patch({ items: [...b.items, ref] })
    setPicking(null)
  }

  return (
    <div className="space-y-5" data-bundle-editor={b.id}>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-ghost !px-2 !py-1 text-sm text-text-2" onClick={onBack} data-bundle-back><ArrowLeft size={14} />Bundles</button>
        <span className="flex-1" />
        {b.source && <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold uppercase ${SOURCE[b.source].cls}`} title={SOURCE[b.source].title} data-bundle-source={b.source}>{SOURCE[b.source].label}</span>}
        {b.source === 'edited' && <button type="button" className="btn-ghost !py-1 text-sm" onClick={() => { if (confirm('Undo your changes to this bundle and use the sync script\'s version?')) setLocalBundles(revertBundle(ws, b.id)) }} data-bundle-revert><RotateCcw size={14} />Back to synced</button>}
        <button type="button" className="btn-ghost !py-1 text-sm hover:!text-danger" onClick={() => { if (!confirm(b.source === 'local' ? 'Delete this bundle?' : 'Hide this bundle? bundles.json keeps it; you can bring it back from the Bundles page.')) return; setLocalBundles(withoutBundle(ws, b.id)); onBack() }} data-bundle-delete><Trash2 size={14} />Delete</button>
      </div>

      <div className="grid gap-4 sm:grid-cols-[2fr_1fr_auto_auto]">
        <label className="block"><span className="label">Name</span><input className="input" value={b.name} onChange={(e) => patch({ name: e.target.value })} data-bundle-name /></label>
        <label className="block"><span className="label">Price as shown</span><input className="input" value={price.display ?? ''} placeholder="CA$10.99" onChange={(e) => setPrice({ display: e.target.value || undefined })} data-bundle-price /></label>
        <label className="block"><span className="label">Amount</span><input className="input !w-28" type="number" step="0.01" min="0" value={price.amount ?? ''} onChange={(e) => setPrice({ amount: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
        <label className="block"><span className="label">Currency</span><input className="input !w-20 uppercase" maxLength={3} value={price.currency ?? ''} onChange={(e) => setPrice({ currency: e.target.value.toUpperCase() || undefined })} /></label>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!b.owned} onChange={(e) => patch({ owned: e.target.checked })} />Owned</label>

      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold">Items <span className="text-sm font-normal text-text-2">{b.items.length}</span></h2>
          <span className="flex-1" />
          <button type="button" className="btn-ghost !py-1 text-sm" onClick={() => setPicking({})} data-bundle-add><Plus size={14} />Add items</button>
        </div>
        {items.map(({ ref, it }, i) => {
          const kind = kindOf(ref, it)
          return (
            <div key={`${ref.shop_item_id ?? ref.key}-${i}`} className={`flex items-center gap-3 rounded-lg border p-2 ${it ? 'border-line bg-bg-1' : 'border-dashed border-warn/50'}`} data-bundle-item={ref.shop_item_id ?? ref.key}>
              {it ? <Thumb item={it} size={40} /> : <span className="flex h-10 w-10 items-center justify-center rounded border border-dashed border-line text-text-2"><Package size={16} /></span>}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{it ? nameOf(it) : ref.name ?? ref.shop_item_id ?? ref.key}</p>
                <p className="truncate text-xs text-text-2">{kind ? KIND_LABELS[kind].one : 'Unknown kind'}{it ? ` · ${keyOf(it)}` : ' · not in this folder'}{ref.shop_item_id ? ` · #${ref.shop_item_id}` : ''}</p>
              </div>
              {it ? <button type="button" className="btn-ghost !px-2 !py-1 text-xs" title="Open it" onClick={() => onOpenItem(it.uid)}><ExternalLink size={13} />Open</button>
                : <button type="button" className="btn-ghost !px-2 !py-1 text-xs" title="Pick the item in this folder it means" onClick={() => setPicking({ relink: i })} data-bundle-relink><Link2 size={13} />Link</button>}
              <button type="button" className="btn-ghost !px-1.5 !py-1" disabled={i === 0} title="Move up" onClick={() => move(i, -1)}><ArrowUp size={14} /></button>
              <button type="button" className="btn-ghost !px-1.5 !py-1" disabled={i === b.items.length - 1} title="Move down" onClick={() => move(i, 1)}><ArrowDown size={14} /></button>
              <button type="button" className="btn-ghost !px-1.5 !py-1 hover:!text-danger" title="Take it out of the bundle" onClick={() => patch({ items: b.items.filter((_, j) => j !== i) })} data-bundle-remove><X size={14} /></button>
            </div>
          )
        })}
        {!b.items.length && <p className="text-sm text-text-2">No items yet: add some from any kind.</p>}
      </section>

      {picking && <ItemPicker pool={pool} exclude={new Set(items.map((x) => x.it?.uid).filter((u): u is string => !!u))} kind={picking.relink !== undefined ? kindOf(b.items[picking.relink]) : undefined} title={picking.relink !== undefined ? `Which item is “${b.items[picking.relink].name ?? 'this'}”?` : `Add to ${b.name}`} onPick={pick} onClose={() => setPicking(null)} />}
    </div>
  )
}

/** Search every item, of any kind (or one), and pick one. */
function ItemPicker({ pool, exclude, kind: only, title, onPick, onClose }: { pool: Item[]; exclude: Set<string>; kind?: Kind; title: string; onPick: (it: Item) => void; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [kind, setKind] = useState<Kind | 'all'>(only ?? 'all')
  const text = q.trim().toLowerCase()
  const list = pool.filter((it) => !exclude.has(it.uid) && (kind === 'all' || it.kind === kind) && (!text || `${it.entry.name ?? ''}\n${keyOf(it)}`.toLowerCase().includes(text))).slice(0, 200)
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-bg-0/70 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }} data-bundle-picker>
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-xl border border-line bg-bg-1 shadow-2xl" role="dialog" aria-modal="true" aria-label={title}>
        <div className="flex items-center gap-3 border-b border-line px-5 py-3">
          <h2 className="flex-1 font-bold">{title}</h2>
          <button type="button" className="text-text-2 hover:text-text-0" title="Close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="flex flex-wrap gap-2 border-b border-line px-5 py-3">
          <input className="input min-w-48 flex-1 !py-1.5" autoFocus placeholder="Search by name or file" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && list[0]) onPick(list[0]); if (e.key === 'Escape') onClose() }} data-bundle-picker-search />
          <select className="input !w-auto !py-1.5" value={kind} onChange={(e) => setKind(e.target.value as Kind | 'all')}>
            <option value="all">Every kind</option>
            {KINDS.map((k) => <option key={k} value={k}>{KIND_LABELS[k].many}</option>)}
          </select>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {list.map((it) => (
            <button key={it.uid} type="button" className="flex w-full items-center gap-3 rounded px-2 py-1.5 text-left hover:bg-bg-3" onClick={() => onPick(it)} data-bundle-pick={keyOf(it)}>
              <Thumb item={it} size={32} />
              <span className="min-w-0 flex-1 truncate text-sm">{nameOf(it)}</span>
              <span className="text-xs text-text-2">{KIND_LABELS[it.kind].one}</span>
            </button>
          ))}
          {!list.length && <p className="p-3 text-sm text-text-2">Nothing matches.</p>}
        </div>
      </div>
    </div>
  )
}
