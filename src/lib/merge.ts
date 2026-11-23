/*
 * Bringing items into what's open without replacing it: from another folder or zip, or pulled from a Parley instance.
 * Items match the way Parley matches them, by kind and id (assetId), so `Foo Bar.png` meets `foo_bar.webp`. A match
 * that differs replaces the open item's saved version (it keeps its place, and a draft of it stays on top); one that
 * doesn't match is added. Nothing open is removed.
 */
import { assetId, KINDS, layered, type Kind } from '../format/kinds'
import { cleanTags } from '../format/tags'
import { keyOf, newUid, typed, type Item } from '../format/workspace'
import { remoteFile, remoteItems, ParleyError, type Conn, type RemoteItem } from './parley'
import { loadKnown, MANAGED_FIELDS, saveKnown, sha256 } from './sync'

export type MergeAction = 'new' | 'changed' | 'same' | 'skip'

export interface MergeRow {
  kind: Kind
  id: string
  action: MergeAction
  /** What differs, in words, or why it's skipped. */
  notes: string[]
  /** The open item it matches. */
  local?: Item
  incoming: Item
  /** The open item has a draft: it stays, on top of the new saved version. */
  draft: boolean
}

export const idOf = (it: Item) => assetId(keyOf(it), it.kind)

/** JSON with object keys sorted, so the same entry read from two files compares equal. */
const canon = (v: unknown) => JSON.stringify(v, (_k, x: unknown) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x))

const LABELS: Record<string, string> = { file: 'file name', folder: 'folder name' }

/** How two versions of an item differ, in words; empty when they're the same. */
export async function differences(a: Item, b: Item): Promise<string[]> {
  const notes: string[] = []
  const first = ['file', 'folder', 'name', 'description']
  const rank = (k: string) => (first.includes(k) ? first.indexOf(k) : first.length)
  const keys = [...new Set([...Object.keys(a.entry), ...Object.keys(b.entry)])].sort((x, y) => rank(x) - rank(y) || (x < y ? -1 : 1))
  for (const k of keys) {
    if (canon(a.entry[k]) === canon(b.entry[k])) continue
    if (k === 'name') notes.push(`name: "${String(a.entry.name ?? '')}" → "${String(b.entry.name ?? '')}"`)
    else if (k === 'file' || k === 'folder') notes.push(`${LABELS[k]}: ${String(a.entry[k] ?? '')} → ${String(b.entry[k] ?? '')}`)
    else notes.push(k)
  }
  const added = Object.keys(b.files).filter((f) => !(f in a.files))
  const removed = Object.keys(a.files).filter((f) => !(f in b.files))
  const changed: string[] = []
  for (const f of Object.keys(b.files)) if (f in a.files && a.files[f] !== b.files[f] && (await sha256(a.files[f])) !== (await sha256(b.files[f]))) changed.push(f)
  const list = (what: string, l: string[]) => { if (l.length) notes.push(l.length <= 2 ? `${what}: ${l.join(', ')}` : `${l.length} files ${what}`) }
  list('new file', added); list('changed', changed); list('removed', removed)
  return notes
}

/** What merging these items into the open ones would do. */
export async function planMerge(open: Item[], drafts: Record<string, unknown>, incoming: Item[], onProgress?: (done: number, total: number) => void): Promise<MergeRow[]> {
  const byId = new Map<string, Item>()
  for (const it of open) { const k = `${it.kind}/${idOf(it)}`; if (!byId.has(k)) byId.set(k, it) }
  const seen = new Map<string, Item>()
  const rows: MergeRow[] = []
  let done = 0
  for (const item of incoming) {
    onProgress?.(done++, incoming.length)
    const id = idOf(item)
    const k = `${item.kind}/${id}`
    const local = byId.get(k)
    const base = { kind: item.kind, id, incoming: item, local, draft: !!local && local.uid in drafts }
    if (!id) { rows.push({ ...base, action: 'skip', notes: [`It has no ${layered(item.kind) ? 'folder' : 'file'} name.`] }); continue }
    const first = seen.get(k)
    if (first) { rows.push({ ...base, action: 'skip', notes: [`Same id as ${keyOf(first)}, which comes first: only that one is used.`] }); continue }
    seen.set(k, item)
    if (!local) { rows.push({ ...base, action: 'new', notes: [] }); continue }
    // Fields the incoming entry doesn't have (ones another tool added here, say) stay as they are.
    const merged: Item = { ...item, entry: { ...local.entry, ...item.entry } }
    const notes = await differences(local, merged)
    rows.push({ ...base, incoming: merged, action: notes.length ? 'changed' : 'same', notes })
  }
  onProgress?.(done, incoming.length)
  return rows
}

// --- pulling from Parley --------------------------------------------------------------------------------------------

/** Every file an instance's item uses, by name: decorations and nameplates one, effects and frames their layers' and stills. */
export function remoteFiles(kind: Kind, r: RemoteItem): string[] {
  if (!layered(kind)) return r.data.file ? [r.data.file] : []
  const d = r.data as RemoteItem['data'] & { still?: string | null; thumbnail?: string | null; reduced_motion?: string | null }
  const out = new Set<string>()
  for (const l of d.layers ?? []) {
    if (typeof l.file === 'string') out.add(l.file)
    if (Array.isArray(l.random_variants)) for (const v of l.random_variants) if (typeof v === 'string') out.add(v)
  }
  for (const s of [d.still, d.reduced_motion, d.thumbnail]) if (s) out.add(s)
  return [...out]
}

/**
 * The instance's item as the Studio holds items. Built on the open item when there is one, so fields the instance
 * doesn't report stay as they are, and its file or folder name keeps its spelling.
 */
export function pulledItem(kind: Kind, r: RemoteItem, files: Record<string, Blob>, local?: Item): Item {
  const id = r.value.replace(/^asset:/, '')
  const entry = local ? structuredClone(local.entry) : {}
  const lk = local ? keyOf(local) : ''
  if (layered(kind)) entry.folder = lk || id
  else entry.file = lk && lk.toLowerCase() === (r.data.file ?? '').toLowerCase() ? lk : r.data.file
  const text = (s: unknown) => (typeof s === 'string' ? s.trim() : '')
  if (text(entry.name) !== text(r.name)) entry.name = r.name ?? ''
  if (text(entry.description) !== text(r.description)) entry.description = r.description ?? ''
  // Present (an array, or null for none) means the instance keeps tags; missing means it predates them.
  if (r.tags !== undefined) {
    const tags = cleanTags(Array.isArray(r.tags) ? r.tags : [])
    if (tags.length) entry.tags = tags
    else delete entry.tags
  }
  // The instance's whole entry, when it reports it: every field it doesn't handle itself comes from there.
  if (r.entry) {
    for (const k of Object.keys(entry)) if (!MANAGED_FIELDS.has(k) && !(k in r.entry)) delete entry[k]
    for (const [k, v] of Object.entries(r.entry)) if (!MANAGED_FIELDS.has(k)) entry[k] = structuredClone(v)
  }
  if (layered(kind)) {
    const mine = Array.isArray(entry.layers) ? (entry.layers as Record<string, unknown>[]) : []
    // Parley adds each layer's pixel size; the rest is the layer as its metadata.json has it.
    entry.layers = (r.data.layers ?? []).map((rl) => {
      const out: Record<string, unknown> = { ...mine.find((l) => l.file === rl.file) }
      for (const [k, v] of Object.entries(rl)) if (k !== 'width' && k !== 'height') out[k] = v
      return out
    })
    if (kind === 'frame' && r.data.layout && typeof r.data.layout === 'object') entry.layout = r.data.layout
  }
  const named = layered(kind) ? files : Object.fromEntries(Object.values(files).map((b) => [String(entry.file), b]))
  return { uid: local?.uid ?? newUid(), kind, entry, files: Object.fromEntries(Object.entries(named).map(([n, b]) => [n, typed(b, n)])) }
}

export interface PullResult { rows: MergeRow[]; notes: string[] }

/** Read the instance's assets-folder items and their files, and compare them with the open ones. */
export async function planPull(c: Conn, open: Item[], drafts: Record<string, unknown>, onProgress: (label: string, done: number, total: number) => void, signal?: AbortSignal): Promise<PullResult> {
  const notes: string[] = []
  const remote: { kind: Kind; r: RemoteItem }[] = []
  let deleted = 0
  for (const [i, k] of KINDS.entries()) {
    onProgress('Reading the instance', i, KINDS.length)
    for (const r of await remoteItems(c, k)) {
      if (r.deleted) { deleted++; continue }
      remote.push({ kind: k, r })
    }
  }
  if (deleted) notes.push(`${deleted} item${deleted === 1 ? ' deleted in Parley is' : 's deleted in Parley are'} left out.`)
  const jobs = remote.flatMap(({ kind, r }) => remoteFiles(kind, r).map((file) => ({ kind, r, file })))
  const got = new Map<RemoteItem, Record<string, Blob>>()
  const missing = new Set<RemoteItem>()
  let done = 0
  onProgress('Downloading files', 0, jobs.length)
  const queue = [...jobs]
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let j = queue.shift(); j && !signal?.aborted; j = queue.shift()) {
      const id = j.r.value.replace(/^asset:/, '')
      try {
        const b = await remoteFile(c, j.kind, id, layered(j.kind) ? j.file : undefined)
        if (b) got.set(j.r, { ...got.get(j.r), [j.file]: b })
        else missing.add(j.r)
      } catch (e) {
        if (e instanceof ParleyError && e.status) missing.add(j.r)
        else throw e
      }
      onProgress('Downloading files', ++done, jobs.length)
    }
  }))
  if (signal?.aborted) throw new DOMException('Stopped', 'AbortError')

  const byId = new Map(open.map((it) => [`${it.kind}/${idOf(it)}`, it]))
  const incoming: Item[] = []
  for (const { kind, r } of remote) {
    const label = r.name || r.value
    if (missing.has(r)) { notes.push(`${label}: some of its files couldn't be downloaded, so it's left out.`); continue }
    incoming.push(pulledItem(kind, r, got.get(r) ?? {}, byId.get(`${kind}/${r.value.replace(/^asset:/, '')}`)))
  }
  const rows = await planMerge(open, drafts, incoming, (d, t) => onProgress('Comparing', d, t))
  return { rows, notes }
}

/** After pulling: the instance has these files, so the next publish comparison needn't download them again. */
export async function rememberPulled(base: string, rows: MergeRow[]) {
  const known = loadKnown(base)
  for (const row of rows) {
    if (row.action === 'skip') continue
    for (const [f, b] of Object.entries(row.incoming.files)) known[`${row.kind}/${row.id}/${f}`] = await sha256(b)
  }
  saveKnown(base, known)
}
