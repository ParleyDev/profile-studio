import { ExternalLink, Package, Store } from 'lucide-react'
import { useMemo } from 'react'
import { KIND_LABELS } from '../format/kinds'
import { bundleIndex, bundlesWith, findBundleItem, hasShop, SHOP_TYPES, shopOf, themeLabel, themeLabels } from '../format/shop'
import { keyOf, type Item } from '../format/workspace'
import Thumb from '../components/Thumb'
import { Swatch } from './Tags'
import { usePool } from '../lib/features'
import { useStudio } from '../lib/store'

const when = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) }

/**
 * What a sync script recorded about an item in the shop: price and availability, colours and themes, its variant and
 * collection, and the bundles it comes in (with links to the other items in them). Shown, not edited: the script owns it.
 */
export default function ShopInfo({ item, onOpen, onBundle }: { item: Item; onOpen: (uid: string) => void; onBundle: (id: string) => void }) {
  const { ws } = useStudio()
  const pool = usePool()
  const s = shopOf(item)
  const labels = useMemo(() => themeLabels(ws), [ws])
  const bundles = useMemo(() => bundleIndex(ws, pool), [ws, pool])
  const byShopId = useMemo(() => new Map(pool.filter((i) => typeof i.entry.shop_item_id === 'string').map((i) => [i.entry.shop_item_id as string, i])), [pool])
  const siblings = useMemo(() => (s.collection ? pool.filter((i) => i.uid !== item.uid && i.entry.collection_id === s.collection) : []), [pool, s.collection, item.uid])
  const tagged = s.tagColors.length + s.tagThemes.length > 0
  if (!hasShop(s) && !tagged && !bundlesWith(item, bundles).length) return null

  // Bundles it's in, as they stand (bundles.json with your changes laid over it).
  const mine = bundlesWith(item, bundles)
  const status = s.inShop === false ? 'Not in the shop' : s.availability === 'owned' ? 'Owned' : s.inShop ? 'In the shop' : undefined
  const chip = 'rounded-full border border-line px-2 py-0.5 text-[11px] text-text-1'
  return (
    <section className="space-y-2 rounded-lg border border-line bg-bg-1 p-3 text-sm" data-shop-info>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex items-center gap-1.5 font-semibold"><Store size={15} className="text-text-2" />{hasShop(s) ? 'Shop' : 'Discover'}</span>
        {status && <span className={s.inShop === false ? 'text-text-2' : 'text-success'}>{status}</span>}
        {s.price?.display && <span data-shop-price>{s.price.display}</span>}
        {s.availability && !['purchasable', 'owned'].includes(s.availability) && <span className="text-text-2">{s.availability}</span>}
        {s.leaves && <span className="text-warn" title={s.leaves}>Leaves {when(s.leaves)}</span>}
        {s.dynamic !== undefined && <span className="text-text-2">{s.dynamic ? 'Dynamic' : 'Static'} effect</span>}
        {s.palette && <span className="text-text-2">Palette: {s.palette}</span>}
        <span className="ml-auto flex items-center gap-2 text-xs text-text-2">
          {s.preview && <a className="flex items-center gap-0.5 hover:text-text-0" href={s.preview} target="_blank" rel="noreferrer noopener">Preview<ExternalLink size={11} /></a>}
          {s.video && <a className="flex items-center gap-0.5 hover:text-text-0" href={s.video} target="_blank" rel="noreferrer noopener">Video<ExternalLink size={11} /></a>}
          {s.shopId && <span className="font-mono" title={s.match ? `Matched: ${s.match}` : undefined}>#{s.shopId}</span>}
        </span>
      </div>
      {(s.base || s.variant) && <p className="text-text-2">Variant <span className="text-text-1">{s.variant ?? '—'}</span> of <span className="text-text-1">{s.base ?? '—'}</span></p>}
      {(s.allColors.length > 0 || s.allThemes.length > 0) && (
        <div className="flex flex-wrap items-center gap-1" title="Search them with #name. Dashed ones come from your color: and theme: tags.">
          {s.allThemes.map((t) => <span key={t} className={`${chip} ${s.tagThemes.includes(t) ? '!border-dashed' : ''}`} title={s.tagThemes.includes(t) ? `From the tag theme:${t}` : 'From the shop'} data-shop-theme={t}>{themeLabel(t, labels)}</span>)}
          {s.allColors.map((c) => <span key={c} className={`${chip} flex items-center gap-1 text-text-2 ${s.tagColors.includes(c) ? '!border-dashed' : ''}`} title={s.tagColors.includes(c) ? `From the tag color:${c}` : 'From the shop'} data-shop-color={c}><Swatch code={c} />{c.replace(/_/g, ' ')}</span>)}
        </div>
      )}
      {mine.map((b) => (
        <div key={b.id} className="space-y-1" data-shop-bundle={b.id}>
          <p className="flex items-center gap-1.5 text-text-2"><Package size={13} /><button type="button" className="text-text-1 hover:text-accent hover:underline" title="Open the bundle to edit it" onClick={() => onBundle(b.id)} data-shop-bundle-open={b.id}>{b.name}</button>{b.price?.display && <span>· {b.price.display}</span>}</p>
          <div className="flex flex-wrap gap-1">
            {b.items.map((x) => ({ x, other: findBundleItem(x, pool, byShopId) })).filter(({ other }) => other?.uid !== item.uid).map(({ x, other }) => {
              const kind = x.type ? SHOP_TYPES[x.type] : other?.kind
              const label = `${other?.entry.name || x.name || x.shop_item_id || x.key}${kind ? ` · ${KIND_LABELS[kind].one}` : ''}`
              const id = x.shop_item_id ?? x.key ?? ''
              return other
                ? <button key={id} type="button" className="flex items-center gap-1.5 rounded border border-line py-0.5 pl-0.5 pr-2 text-xs hover:border-accent" title={`Open ${keyOf(other)}`} onClick={() => onOpen(other.uid)} data-shop-link={id}><Thumb item={other} size={22} />{label}</button>
                : <span key={id} className="rounded border border-dashed border-line px-2 py-0.5 text-xs text-text-2" title="Not in this folder">{label}</span>
            })}
          </div>
        </div>
      ))}
      {siblings.length > 0 && (
        <p className="text-xs text-text-2">Same collection: {siblings.slice(0, 8).map((o, i) => <span key={o.uid}>{i ? ', ' : ''}<button type="button" className="text-text-1 hover:text-accent hover:underline" onClick={() => onOpen(o.uid)}>{String(o.entry.name || keyOf(o))}</button></span>)}{siblings.length > 8 ? ` and ${siblings.length - 8} more` : ''}</p>
      )}
    </section>
  )
}
