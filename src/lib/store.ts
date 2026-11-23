import { useSyncExternalStore } from 'react'
import type { Kind } from '../format/kinds'
import { applyFix, type NameFix } from '../format/names'
import { TYPE_OF } from '../format/shop'
import { cleanTags } from '../format/tags'
import { emptyWorkspace, type Entry, type Item, type Workspace } from '../format/workspace'

/*
 * The open workspace, kept in this browser (IndexedDB) as you work, so closing the tab loses nothing. Nothing leaves
 * the browser: exporting is a download or a write to a folder you pick.
 *
 * An assets folder can run to thousands of items and gigabytes of pictures, so it is stored in pieces: one record per
 * item, each file once under its own id, and the order separately. A save writes only the items that changed and the
 * files not stored yet, and drops files nothing uses any more.
 */

const DB = 'parley-profile-studio', VERSION = 3
const LEGACY = 'workspace', META = 'meta', ITEMS = 'items', BLOBS = 'blobs', DRAFTS = 'drafts'

interface ItemRec { uid: string; kind: Kind; entry: Entry; files: Record<string, string> }
interface MetaRec { order: string[]; extras: Workspace['extras']; bundles?: Workspace['bundles']; localBundles?: Workspace['localBundles']; format?: Workspace['format']; marks?: Marks }
/** Items a merge or pull brought in or changed, by uid, until you clear them. */
export type Marks = Record<string, 'new' | 'updated'>

let dbp: Promise<IDBDatabase> | null = null
function db(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, VERSION)
    r.onupgradeneeded = () => {
      for (const s of [LEGACY, META, ITEMS, BLOBS, DRAFTS]) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s)
    }
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => { dbp = null; reject(r.error) }
  })
  return dbp
}
const req = <T>(r: IDBRequest): Promise<T> => new Promise((res, rej) => { r.onsuccess = () => res(r.result as T); r.onerror = () => rej(r.error) })
async function tx(stores: string[], fn: (t: IDBTransaction) => void): Promise<void> {
  const t = (await db()).transaction(stores, 'readwrite')
  fn(t)
  return new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error ?? new Error('aborted')) })
}

// --- state ----------------------------------------------------------------------------------------------------------

export interface Progress { label: string; done: number; total: number; bytes?: boolean }
export type Saved = 'saved' | 'saving' | 'unsaved' | 'off'
interface State {
  /** The saved items: what the list shows and what export writes. */
  ws: Workspace
  /**
   * Work not saved yet, by uid: a new item (no saved one with its uid) or changes to a saved one. Edits go here; Save
   * moves a draft into the workspace, Discard drops it.
   */
  drafts: Record<string, Item>
  marks: Marks
  selected: string | null
  loaded: boolean
  saved: Saved
  /** Why saving stopped, when it did (a full disk, say). */
  saveError: string | null
  /** A save in progress big enough to show (the first save of a large folder). */
  saving: Progress | null
  /** Work that blocks the page: opening the last workspace, reading a folder. */
  busy: Progress | null
}
let state: State = { ws: emptyWorkspace(), drafts: {}, marks: {}, selected: null, loaded: false, saved: 'saved', saveError: null, saving: null, busy: null }
const listeners = new Set<() => void>()
const set = (next: Partial<State>) => { state = { ...state, ...next }; listeners.forEach((l) => l()) }
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
export const useStudio = () => useSyncExternalStore(subscribe, () => state, () => state)
export const getState = () => state
export const setBusy = (busy: Progress | null) => set({ busy })

// --- saving ---------------------------------------------------------------------------------------------------------

const blobIds = new WeakMap<Blob, string>()
let nextBlob = 0
const blobId = (b: Blob) => {
  let id = blobIds.get(b)
  if (!id) { id = `b${Date.now().toString(36)}${(nextBlob++).toString(36)}${Math.random().toString(36).slice(2, 6)}`; blobIds.set(b, id) }
  return id
}
/** What the database holds: each item as last written (by identity) and the files stored. */
const savedItems = new Map<string, Item>()
const savedDrafts = new Map<string, Item>()
const savedBlobs = new Set<string>()
let savedMeta: { order: string[]; extras: Workspace['extras']; bundles?: Workspace['bundles']; localBundles?: Workspace['localBundles']; format?: Workspace['format']; marks: Marks } | null = null

let timer: number | undefined
let flushing = false, again = false
function persist() {
  if (state.saved === 'off') return
  set({ saved: 'unsaved' })
  window.clearTimeout(timer)
  timer = window.setTimeout(() => void flush(), 400)
}

/** Files go in transactions of about this many bytes, so a big first save shows progress and doesn't hold one huge transaction. */
const BATCH_BYTES = 48 * 1024 * 1024

const record = (it: Item): ItemRec => ({ uid: it.uid, kind: it.kind, entry: it.entry, files: Object.fromEntries(Object.entries(it.files).map(([n, b]) => [n, blobId(b)])) })

async function flush() {
  if (flushing) { again = true; return }
  flushing = true
  set({ saved: 'saving' })
  try {
    do {
      again = false
      const ws = state.ws
      const changed = ws.items.filter((it) => savedItems.get(it.uid) !== it)
      const live = new Set(ws.items.map((i) => i.uid))
      const removed = [...savedItems.keys()].filter((u) => !live.has(u))
      const drafts = Object.values(state.drafts)
      const dChanged = drafts.filter((d) => savedDrafts.get(d.uid) !== d)
      const dLive = new Set(drafts.map((d) => d.uid))
      const dRemoved = [...savedDrafts.keys()].filter((u) => !dLive.has(u))

      // New files first, so an item record never points at a file that isn't stored.
      const fresh = new Map<string, Blob>()
      for (const it of [...changed, ...dChanged]) for (const b of Object.values(it.files)) { const id = blobId(b); if (!savedBlobs.has(id)) fresh.set(id, b) }
      const total = [...fresh.values()].reduce((n, b) => n + b.size, 0)
      const show = total > 8 * 1024 * 1024
      let done = 0
      let batch: [string, Blob][] = [], size = 0
      const write = async () => {
        if (!batch.length) return
        const list = batch
        await tx([BLOBS], (t) => { for (const [id, b] of list) t.objectStore(BLOBS).put(b, id) })
        for (const [id, b] of list) { savedBlobs.add(id); done += b.size }
        batch = []; size = 0
        if (show) set({ saving: { label: 'Keeping a copy in this browser', done, total, bytes: true } })
      }
      if (show) set({ saving: { label: 'Keeping a copy in this browser', done: 0, total, bytes: true } })
      for (const entry of fresh) { batch.push(entry); size += entry[1].size; if (size >= BATCH_BYTES) await write() }
      await write()

      const order = ws.items.map((i) => i.uid)
      const marks = state.marks
      const metaChanged = !savedMeta || savedMeta.extras !== ws.extras || savedMeta.bundles !== ws.bundles || savedMeta.localBundles !== ws.localBundles || savedMeta.format !== ws.format || savedMeta.marks !== marks || savedMeta.order.length !== order.length || savedMeta.order.some((u, i) => u !== order[i])
      if (changed.length || removed.length || metaChanged || dChanged.length || dRemoved.length) {
        await tx([ITEMS, META, DRAFTS], (t) => {
          for (const it of changed) t.objectStore(ITEMS).put(record(it), it.uid)
          for (const u of removed) t.objectStore(ITEMS).delete(u)
          for (const d of dChanged) t.objectStore(DRAFTS).put(record(d), d.uid)
          for (const u of dRemoved) t.objectStore(DRAFTS).delete(u)
          if (metaChanged) t.objectStore(META).put({ order, extras: ws.extras, bundles: ws.bundles, localBundles: ws.localBundles, format: ws.format, marks } satisfies MetaRec, 'ws')
        })
        for (const it of changed) savedItems.set(it.uid, it)
        for (const u of removed) savedItems.delete(u)
        for (const d of dChanged) savedDrafts.set(d.uid, d)
        for (const u of dRemoved) savedDrafts.delete(u)
        savedMeta = { order, extras: ws.extras, bundles: ws.bundles, localBundles: ws.localBundles, format: ws.format, marks }
      }

      // Files nothing uses any more.
      const used = new Set<string>()
      for (const it of [...savedItems.values(), ...savedDrafts.values()]) for (const b of Object.values(it.files)) used.add(blobId(b))
      const orphans = [...savedBlobs].filter((id) => !used.has(id))
      if (orphans.length) {
        await tx([BLOBS], (t) => { for (const id of orphans) t.objectStore(BLOBS).delete(id) })
        for (const id of orphans) savedBlobs.delete(id)
      }
    } while (again)
    set({ saved: state.ws.items.every((it) => savedItems.get(it.uid) === it) && Object.values(state.drafts).every((d) => savedDrafts.get(d.uid) === d) ? 'saved' : 'unsaved', saving: null })
  } catch (e) {
    const quota = e instanceof DOMException && e.name === 'QuotaExceededError'
    set({ saved: 'off', saving: null, saveError: quota ? 'This browser is out of room for the workspace. Export a zip to keep your work.' : `Saving stopped: ${e instanceof Error ? e.message : String(e)}. Export a zip to keep your work.` })
  } finally { flushing = false }
}

/** Try saving again after it stopped. */
export function retrySave() { set({ saved: 'unsaved', saveError: null }); void flush() }

// --- restoring ------------------------------------------------------------------------------------------------------

/** The last workspace from this browser, when there is one. */
export async function restore() {
  set({ busy: { label: 'Opening your workspace', done: 0, total: 0 } })
  try {
    const d = await db()
    const read = d.transaction([META, ITEMS, BLOBS, LEGACY, DRAFTS], 'readonly')
    const meta = await req<MetaRec | undefined>(read.objectStore(META).get('ws'))
    if (!meta) {
      // A workspace saved whole by the first version: load it, then store it the new way.
      const old = await req<Workspace | undefined>(read.objectStore(LEGACY).get('current'))
      if (old?.items) {
        set({ ws: old, selected: old.items[0]?.uid ?? null })
        persist()
        void tx([LEGACY], (t) => t.objectStore(LEGACY).delete('current')).catch(() => {})
      }
      return
    }
    const [recs, draftRecs, blobKeys, blobs] = await Promise.all([
      req<ItemRec[]>(read.objectStore(ITEMS).getAll()),
      req<ItemRec[]>(read.objectStore(DRAFTS).getAll()),
      req<string[]>(read.objectStore(BLOBS).getAllKeys()),
      req<Blob[]>(read.objectStore(BLOBS).getAll()),
    ])
    const byId = new Map<string, Blob>()
    blobKeys.forEach((k, i) => { byId.set(k, blobs[i]); blobIds.set(blobs[i], k); savedBlobs.add(k) })
    const recBy = new Map(recs.map((r) => [r.uid, r]))
    const fromRec = (r: ItemRec): Item => {
      const files: Record<string, Blob> = {}
      for (const [n, id] of Object.entries(r.files)) { const b = byId.get(id); if (b) files[n] = b }
      return { uid: r.uid, kind: r.kind, entry: r.entry, files }
    }
    const items: Item[] = []
    for (const uid of meta.order) {
      const r = recBy.get(uid)
      if (!r) continue
      const it = fromRec(r)
      items.push(it)
      savedItems.set(uid, it)
    }
    const drafts: Record<string, Item> = {}
    for (const r of draftRecs) { const d = fromRec(r); drafts[d.uid] = d; savedDrafts.set(d.uid, d) }
    const ws: Workspace = { items, extras: meta.extras ?? {}, bundles: meta.bundles, localBundles: meta.localBundles, format: meta.format }
    const marks = meta.marks ?? {}
    savedMeta = { order: meta.order, extras: ws.extras, bundles: ws.bundles, localBundles: ws.localBundles, format: ws.format, marks }
    set({ ws, drafts, marks, selected: items[0]?.uid ?? null })
    // Records or files left over from an interrupted save get tidied by the next save.
    if (recs.length !== items.length || blobKeys.length) persist()
  } catch {
    set({ saved: 'off', saveError: 'This browser blocks storage, so your work isn\'t kept between visits. Export a zip to keep it.' })
  } finally {
    set({ loaded: true, busy: null })
  }
}

// --- edits ----------------------------------------------------------------------------------------------------------

/** An item as you see it in the editor: its draft when there is one, else the saved one. */
export const current = (uid: string): Item | undefined => state.drafts[uid] ?? state.ws.items.find((i) => i.uid === uid)
/** A draft with no saved item behind it: made with New or Duplicate, not saved yet. */
export const isNewDraft = (uid: string) => !!state.drafts[uid] && !state.ws.items.some((i) => i.uid === uid)
const without = (uid: string) => { const { [uid]: _gone, ...rest } = state.drafts; return rest }

/** Opening another folder replaces everything, drafts included. */
export function replaceWorkspace(ws: Workspace) { set({ ws, drafts: {}, marks: {}, selected: ws.items[0]?.uid ?? null }); persist() }

/**
 * Merge items in: each `{ replace, item }` takes the place of the saved item with uid `replace` (keeping that uid,
 * its place and any draft), and each `{ item }` is added at the end. They're marked until the marks are cleared.
 */
export function mergeItems(changes: { replace?: string; item: Item }[], extras: Workspace['extras'] = {}, bundles?: Workspace['bundles'], format?: Workspace['format'], localBundles?: Workspace['localBundles']) {
  const marks = { ...state.marks }
  const by = new Map<string, Item>()
  for (const c of changes) if (c.replace) by.set(c.replace, { ...c.item, uid: c.replace })
  const items = state.ws.items.map((i) => by.get(i.uid) ?? i)
  for (const uid of by.keys()) if (marks[uid] !== 'new') marks[uid] = 'updated'
  for (const c of changes) if (!c.replace) { items.push(c.item); marks[c.item.uid] = 'new' }
  // The incoming folder's settings are the newer (a sync script's tag labels, say); ones only the open folder has stay.
  // item_count and collections are worked out from the items when written, so they can't go stale either way.
  const ex: Workspace['extras'] = { ...state.ws.extras }
  for (const k of Object.keys(extras) as Kind[]) ex[k] = { ...state.ws.extras[k], ...extras[k] }
  set({ ws: { items, extras: ex, bundles: bundles ?? state.ws.bundles, localBundles: mergeLocal(state.ws.localBundles, localBundles), format: { ...state.ws.format, ...format } }, marks, selected: state.selected ?? changes[0]?.item.uid ?? null }); persist()
}
/** Your own bundle changes win over incoming ones for the same bundle; incoming ones for other bundles are added. */
function mergeLocal(mine: Workspace['localBundles'], incoming: Workspace['localBundles']): Workspace['localBundles'] {
  if (!incoming) return mine
  if (!mine) return incoming
  const list = (f: Record<string, unknown>) => (Array.isArray(f.bundles) ? (f.bundles as { id?: unknown }[]) : [])
  const have = new Set(list(mine).map((b) => b.id))
  return { ...incoming, ...mine, bundles: [...list(mine), ...list(incoming).filter((b) => !have.has(b.id))] }
}

/** Change bundles.local.json (bundles.json, the sync script's, is never changed). Applied at once, like tags. */
export function setLocalBundles(localBundles: Record<string, unknown>) { set({ ws: { ...state.ws, localBundles } }); persist() }

/** Take the instance's copy of a root file (undefined: it has none). */
export function setRootJson(root: 'bundles' | 'localBundles', value: Record<string, unknown> | undefined) { set({ ws: { ...state.ws, [root]: value } }); persist() }
/** Set (or, with null, remove) a kind's top-level metadata.json fields, keeping the rest in place. */
export function setKindFields(kind: Kind, fields: Record<string, unknown>) {
  const ex = { ...state.ws.extras[kind] }
  for (const [k, v] of Object.entries(fields)) { if (v === null) delete ex[k]; else ex[k] = v }
  set({ ws: { ...state.ws, extras: { ...state.ws.extras, [kind]: ex } } }); persist()
}

export function clearMarks() { set({ marks: {} }); persist() }

/**
 * Add and take off tags on several items at once. It changes the saved items directly (like moving or deleting does),
 * and any drafts of them too, so their drafts don't undo it.
 */
export function tagItems(uids: string[], add: string[], remove: string[] = []) {
  const want = new Set(uids)
  const retag = (it: Item): Item => {
    const before = Array.isArray(it.entry.tags) ? cleanTags(it.entry.tags) : []
    const after = cleanTags([...before.filter((t) => !remove.includes(t)), ...add])
    if (JSON.stringify(it.entry.tags ?? []) === JSON.stringify(after)) return it
    const { tags: _old, ...entry } = it.entry
    return { ...it, entry: after.length ? { ...entry, tags: after } : entry }
  }
  const items = state.ws.items.map((i) => (want.has(i.uid) ? retag(i) : i))
  const drafts = Object.fromEntries(Object.entries(state.drafts).map(([u, d]) => [u, want.has(u) ? retag(d) : d]))
  set({ ws: { ...state.ws, items }, drafts }); persist()
}
/**
 * Rename items' files and folders at once (saved items and their drafts alike). Bundles in bundles.local.json that
 * name a renamed item by its file or folder name follow it.
 */
export function renameItems(fixes: NameFix[]) {
  const by = new Map(fixes.map((f) => [f.uid, f]))
  const fix = (it: Item) => { const f = by.get(it.uid); return f ? applyFix(it, f) : it }
  const items = state.ws.items.map(fix)
  const drafts = Object.fromEntries(Object.entries(state.drafts).map(([u, d]) => [u, fix(d)]))
  const keys = new Map(fixes.filter((f) => f.key).map((f) => [`${TYPE_OF[f.kind]}/${f.key!.from}`, f.key!.to]))
  let localBundles = state.ws.localBundles
  const list = localBundles?.bundles
  if (keys.size && Array.isArray(list)) {
    const next = list.map((b) => {
      if (!b || typeof b !== 'object' || !Array.isArray((b as { items?: unknown }).items)) return b
      const bi = (b as { items: Record<string, unknown>[] }).items
      return { ...b, items: bi.map((x) => { const to = x && typeof x.key === 'string' ? keys.get(`${String(x.type)}/${x.key}`) : undefined; return to ? { ...x, key: to } : x }) }
    })
    localBundles = { ...localBundles, bundles: next }
  }
  set({ ws: { ...state.ws, items, localBundles }, drafts }); persist()
}
export function select(uid: string | null) { set({ selected: uid }) }

/** A new item starts as a draft: it joins the list when saved. */
export function addItem(it: Item) { set({ drafts: { ...state.drafts, [it.uid]: it }, selected: it.uid }); persist() }
/** Changes go to the item's draft, made from the saved item on the first change. */
export function updateItem(uid: string, fn: (it: Item) => Item) {
  const base = current(uid)
  if (!base) return
  set({ drafts: { ...state.drafts, [uid]: fn(base) } }); persist()
}
export const patchEntry = (uid: string, patch: Partial<Entry>) => updateItem(uid, (it) => ({ ...it, entry: { ...it.entry, ...patch } }))

/** The draft becomes the saved item (a new one goes at the end of its kind's list). */
export function saveDraft(uid: string) {
  const d = state.drafts[uid]
  if (!d) return
  const exists = state.ws.items.some((i) => i.uid === uid)
  const items = exists ? state.ws.items.map((i) => (i.uid === uid ? d : i)) : [...state.ws.items, d]
  set({ ws: { ...state.ws, items }, drafts: without(uid) }); persist()
}
/** Throw the draft away: an edited item goes back to how it was saved, a new one is gone. */
export function discardDraft(uid: string) {
  const fresh = isNewDraft(uid)
  set({ drafts: without(uid), selected: fresh && state.selected === uid ? null : state.selected }); persist()
}
/** Delete an item: its saved version and any draft. */
export function removeItem(uid: string) {
  const i = state.ws.items.findIndex((x) => x.uid === uid)
  const items = state.ws.items.filter((x) => x.uid !== uid)
  const next = state.selected === uid ? (i >= 0 ? items[Math.min(i, items.length - 1)]?.uid ?? null : null) : state.selected
  const { [uid]: _m, ...marks } = state.marks
  set({ ws: { ...state.ws, items }, drafts: without(uid), marks, selected: next }); persist()
}
export function moveItem(uid: string, by: -1 | 1) {
  const items = [...state.ws.items]
  const i = items.findIndex((x) => x.uid === uid)
  // Within its kind: metadata.json order is the order Parley's pickers show.
  let j = i + by
  while (j >= 0 && j < items.length && items[j].kind !== items[i].kind) j += by
  if (i < 0 || j < 0 || j >= items.length) return
  ;[items[i], items[j]] = [items[j], items[i]]
  set({ ws: { ...state.ws, items } }); persist()
}
