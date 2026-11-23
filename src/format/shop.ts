import type { Kind } from './kinds'
import { facetCode, taggedFacet } from './tags'
import { keyOf, type Item, type Workspace } from './workspace'

/*
 * Shop details a sync script adds to metadata.json entries (price, availability, colours, themes, collection, bundles)
 * and the assets folder's bundles.json. The Studio shows and searches them but leaves them as the script wrote them.
 */

export interface Price { amount?: number; currency?: string; display?: string; discount_percent?: number }
export interface BundleRef { id: string; name?: string }
/**
 * One item in a bundle: by `shop_item_id` (as bundles.json has them), or for an item with none, by `type` plus `key`
 * (its file or folder name). `name` is what to call it when it isn't in the folder.
 */
export interface BundleItem { shop_item_id?: string; type?: string; key?: string; name?: string }
export interface Bundle {
  id: string
  name: string
  price?: Price | null
  owned?: boolean
  collection_id?: string
  items: BundleItem[]
  /** Where it comes from: the sync script's bundles.json, changed by bundles.local.json, or only in bundles.local.json. */
  source?: 'sync' | 'edited' | 'local'
}

/** bundles.json's item types as kinds, and back. */
export const SHOP_TYPES: Record<string, Kind> = { avatar_decoration: 'decoration', nameplate: 'nameplate', profile_effect: 'effect', profile_frame: 'frame' }
export const TYPE_OF: Record<Kind, string> = { decoration: 'avatar_decoration', nameplate: 'nameplate', effect: 'profile_effect', frame: 'profile_frame' }

const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

const codes = (l: string[]) => [...new Set(l.map(facetCode).filter(Boolean))]

/**
 * An entry's shop details, read leniently (whatever is missing or the wrong shape is left out). `colors` and `themes`
 * are the sync script's (as codes); `tagColors`/`tagThemes` are the ones only `color:`/`theme:` tags add, and
 * `allColors`/`allThemes` both, the way Parley's Discover counts them.
 */
export function shopOf(it: Item) {
  const e = it.entry
  const colors = codes(strs(e.colors)), themes = codes(strs(e.themes))
  const tagColors = taggedFacet(it, 'color').filter((c) => !colors.includes(c)), tagThemes = taggedFacet(it, 'theme').filter((t) => !themes.includes(t))
  const price = e.price && typeof e.price === 'object' ? (e.price as Price) : null
  const bundles = Array.isArray(e.bundles) ? (e.bundles as unknown[]).filter((b): b is BundleRef => !!b && typeof b === 'object' && typeof (b as BundleRef).id === 'string') : []
  return {
    shopId: str(e.shop_item_id),
    inShop: typeof e.in_shop === 'boolean' ? e.in_shop : undefined,
    price,
    availability: str(e.availability),
    leaves: str(e.leaves_shop_at),
    match: str(e.match_type),
    collection: str(e.collection_id),
    base: str(e.base_name),
    variant: str(e.variant_label),
    colors,
    themes,
    tagColors,
    tagThemes,
    allColors: [...colors, ...tagColors],
    allThemes: [...themes, ...tagThemes],
    palette: str(e.palette),
    dynamic: typeof e.dynamic === 'boolean' ? e.dynamic : undefined,
    preview: str(e.preview_url),
    video: str(e.video_url),
    bundles,
  }
}
export type Shop = ReturnType<typeof shopOf>
/** Whether a sync script has added anything to the entry. */
export const hasShop = (s: Shop) => !!(s.shopId || s.inShop !== undefined || s.price || s.colors.length || s.themes.length || s.bundles.length || s.collection)

/** Theme codes ("cute_cozy") to their labels ("Cute & Cozy"), from the `tag_labels` lists in each metadata.json. */
export function themeLabels(ws: Pick<Workspace, 'extras'>): Map<string, string> {
  const out = new Map<string, string>()
  for (const ex of Object.values(ws.extras)) for (const l of strs(ex?.tag_labels)) out.set(l.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''), l)
  return out
}
export const themeLabel = (code: string, labels: Map<string, string>) => labels.get(code) ?? code.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

const okItem = (x: unknown): x is BundleItem => !!x && typeof x === 'object' && (typeof (x as BundleItem).shop_item_id === 'string' || typeof (x as BundleItem).key === 'string')
const rawList = (file: Record<string, unknown> | undefined) => (Array.isArray(file?.bundles) ? (file.bundles as unknown[]).filter((b): b is Record<string, unknown> => !!b && typeof b === 'object' && typeof (b as { id?: unknown }).id === 'string') : [])

/*
 * bundles.local.json: the Studio's own changes, laid over the sync script's bundles.json so the next sync can't undo
 * them. Each entry has an `id`: for a bundle bundles.json has, only the fields changed (`name`, `price`, `owned`,
 * `items`, the whole list) or `deleted: true`; any other id is a bundle made here. bundles.json is never changed.
 */
export interface LocalBundle { id: string; name?: string; price?: Price | null; owned?: boolean; collection_id?: string; items?: BundleItem[]; deleted?: boolean }
export const EDITABLE = ['name', 'price', 'owned', 'items'] as const

/** The bundles as they stand: bundles.json with bundles.local.json laid over it, deleted ones left out. */
export function bundlesOf(ws: Pick<Workspace, 'bundles' | 'localBundles'>): Bundle[] {
  const local = new Map(rawList(ws.localBundles).map((b) => [b.id as string, b as unknown as LocalBundle]))
  const out: Bundle[] = []
  const read = (b: Record<string, unknown>, source: Bundle['source']): Bundle => ({
    ...(b as unknown as Bundle), name: str(b.name) ?? (b.id as string), items: Array.isArray(b.items) ? b.items.filter(okItem) : [], source,
  })
  for (const b of rawList(ws.bundles)) {
    const o = local.get(b.id as string)
    local.delete(b.id as string)
    if (o?.deleted) continue
    out.push(read(o ? { ...b, ...o } : b, o ? 'edited' : 'sync'))
  }
  for (const o of local.values()) if (!o.deleted) out.push(read(o as unknown as Record<string, unknown>, 'local'))
  return out
}
/** Bundles bundles.local.json hides. */
export const deletedBundles = (ws: Pick<Workspace, 'bundles' | 'localBundles'>) => {
  const gone = new Set(rawList(ws.localBundles).filter((b) => b.deleted).map((b) => b.id as string))
  return rawList(ws.bundles).filter((b) => gone.has(b.id as string)).map((b) => ({ id: b.id as string, name: str(b.name) ?? (b.id as string) }))
}
/** The sync script's version of a bundle, if it has one. */
export const syncedBundle = (ws: Pick<Workspace, 'bundles'>, id: string) => rawList(ws.bundles).find((b) => b.id === id) as unknown as Bundle | undefined

/**
 * bundles.local.json after a bundle is changed to `next`: for one bundles.json has, only the fields that now differ
 * from it are kept (nothing at all when it's back as synced); a bundle made here is kept whole.
 */
export function withBundle(ws: Pick<Workspace, 'bundles' | 'localBundles'>, next: Bundle): Record<string, unknown> {
  const base = syncedBundle(ws, next.id)
  let entry: LocalBundle | null
  if (base) {
    const diff: LocalBundle = { id: next.id }
    for (const k of EDITABLE) if (JSON.stringify(next[k] ?? null) !== JSON.stringify(base[k] ?? null)) (diff as unknown as Record<string, unknown>)[k] = next[k]
    entry = Object.keys(diff).length > 1 ? diff : null
  } else {
    const { source: _s, ...whole } = next
    entry = whole
  }
  return setLocal(ws, next.id, entry)
}
/** bundles.local.json with a bundle deleted: hidden when bundles.json has it, else taken out. */
export const withoutBundle = (ws: Pick<Workspace, 'bundles' | 'localBundles'>, id: string) => setLocal(ws, id, syncedBundle(ws, id) ? { id, deleted: true } : null)
/** bundles.local.json with a bundle back as the sync script has it. */
export const revertBundle = (ws: Pick<Workspace, 'bundles' | 'localBundles'>, id: string) => setLocal(ws, id, null)
function setLocal(ws: Pick<Workspace, 'localBundles'>, id: string, entry: LocalBundle | null): Record<string, unknown> {
  const list = rawList(ws.localBundles)
  const at = list.findIndex((b) => b.id === id)
  const next = [...list]
  if (entry && at >= 0) next[at] = entry as unknown as Record<string, unknown>
  else if (entry) next.push(entry as unknown as Record<string, unknown>)
  else if (at >= 0) next.splice(at, 1)
  return { ...ws.localBundles, bundles: next }
}

/** The item a bundle's entry means, among `items`: by shop id, else by kind and file or folder name. */
export function findBundleItem(ref: BundleItem, items: Item[], byShopId?: Map<string, Item>): Item | undefined {
  if (ref.shop_item_id) {
    const hit = byShopId ? byShopId.get(ref.shop_item_id) : items.find((i) => i.entry.shop_item_id === ref.shop_item_id)
    if (hit) return hit
  }
  if (ref.key) {
    const kind = ref.type ? SHOP_TYPES[ref.type] : undefined
    return items.find((i) => (!kind || i.kind === kind) && keyOf(i) === ref.key)
  }
  return undefined
}
/** How a bundle refers to an item: its shop id when it has one, else its kind and file or folder name. */
export function refOf(it: Item): BundleItem {
  const shop = str(it.entry.shop_item_id)
  const name = str(it.entry.name) || keyOf(it)
  return shop ? { shop_item_id: shop, name, type: TYPE_OF[it.kind] } : { type: TYPE_OF[it.kind], key: keyOf(it), name }
}

/**
 * Bundles by id as they stand, plus any only named in entries' `bundles` lists (which carry an id and a name). A
 * bundle bundles.json or bundles.local.json has decides its own items; entries' lists only fill in ones they lack.
 */
export function bundleIndex(ws: Pick<Workspace, 'bundles' | 'localBundles'>, items: Item[]): Map<string, Bundle> {
  const out = new Map(bundlesOf(ws).map((b) => [b.id, b]))
  const known = new Set([...out.keys(), ...deletedBundles(ws).map((b) => b.id)])
  for (const it of items) {
    const s = shopOf(it)
    for (const r of s.bundles) {
      if (known.has(r.id)) continue
      const b = out.get(r.id) ?? { id: r.id, name: r.name ?? r.id, items: [], source: 'sync' as const }
      if (s.shopId && !b.items.some((x) => x.shop_item_id === s.shopId)) b.items = [...b.items, { shop_item_id: s.shopId, name: str(it.entry.name) }]
      out.set(r.id, b)
    }
  }
  return out
}
/** The ids of the bundles an item is in. */
export function bundlesWith(it: Item, index: Map<string, Bundle>): Bundle[] {
  return [...index.values()].filter((b) => b.items.some((x) => findBundleItem(x, [it]) === it))
}
