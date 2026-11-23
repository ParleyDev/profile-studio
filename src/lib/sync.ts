/*
 * Publishing to a Parley instance: compare the saved items with what the instance has, then add the new ones and
 * update the changed ones. Nothing on the instance is deleted. Items are matched by the id Parley gives them
 * (assetId), so `Foo Bar.png` here updates `foo_bar.webp` there.
 *
 * Telling whether a file changed means comparing bytes, and the instance doesn't say a file's size or hash, so the
 * first comparison downloads the files of items both sides have. What matched or was sent is remembered per
 * instance (a SHA-256 of the file), so later comparisons only download files that changed here since.
 */
import { assetId, checkName, extOf, NAME_RULE, KINDS, layered, type Kind } from '../format/kinds'
import { cleanTags, tagsOf } from '../format/tags'
import { keyOf, type Item } from '../format/workspace'
import { hex, sha256Bytes } from './sha256'
import { editItem, importItem, remoteFile, remoteItems, type Conn, type RemoteItem } from './parley'

export type Action = 'add' | 'update' | 'same' | 'blocked'

export interface PlanRow {
  item: Item
  id: string
  action: Action
  /** What differs, in words, or why it can't go. */
  notes: string[]
  /** Update: the entry fields to send. */
  meta: Record<string, unknown>
  /** Files to send (add: all of them). */
  files: string[]
  remote?: RemoteItem
}

// --- remembering what the instance has ------------------------------------------------------------------------------

const KEY = (base: string) => `parley-profile-studio:published:${base}`
type Known = Record<string, string>
export function loadKnown(base: string): Known {
  try { return JSON.parse(localStorage.getItem(KEY(base)) ?? '{}') as Known } catch { return {} }
}
export function saveKnown(base: string, known: Known) {
  try { localStorage.setItem(KEY(base), JSON.stringify(known)) } catch { /* comparisons download again next time */ }
}
const knownKey = (kind: Kind, id: string, file: string) => `${kind}/${id}/${file}`

const hashes = new WeakMap<Blob, Promise<string>>()
export function sha256(b: Blob): Promise<string> {
  let h = hashes.get(b)
  if (!h) {
    h = b.arrayBuffer().then((buf) => sha256Bytes(new Uint8Array(buf))).then(hex)
    hashes.set(b, h)
  }
  return h
}

// --- comparing entries ----------------------------------------------------------------------------------------------

const EFFECT_FIELDS = ['file', 'start_ms', 'duration_ms', 'loop', 'loop_delay_ms', 'z_index'] as const
const FRAME_FIELDS = ['file', 'order', 'type', 'anchor'] as const
const LAYOUT_FIELDS = ['inner_width', 'overflow_top', 'overflow_bottom', 'overflow_horizontal'] as const

/** A layer as Parley's editor takes it: the fields it edits, nothing else. */
export function cleanLayer(kind: Kind, l: Record<string, unknown>) {
  const out: Record<string, unknown> = {}
  if (kind === 'effect') {
    for (const k of EFFECT_FIELDS) out[k] = l[k]
    out.loop = l.loop === true
    if (Array.isArray(l.random_variants) && l.random_variants.length) out.random_variants = l.random_variants
  } else {
    for (const k of FRAME_FIELDS) out[k] = l[k]
    out.responsive = l.responsive === true
  }
  return out
}
const cleanLayout = (l: unknown) => Object.fromEntries(LAYOUT_FIELDS.map((k) => [k, (l as Record<string, unknown> | undefined)?.[k]]))
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const canon = (v: unknown) => JSON.stringify(v, (_k, x: unknown) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x))

/** Entry fields Parley handles itself (each with its own meta key or none); the rest travel as `meta.fields`. */
export const MANAGED_FIELDS = new Set(['file', 'folder', 'name', 'description', 'layers', 'layout', 'tags', 'items'])
/** The unmanaged fields that differ: the open value, or null where the open entry has none. */
export function entryFieldChanges(mine: Record<string, unknown>, theirs: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of new Set([...Object.keys(mine), ...Object.keys(theirs)])) {
    if (MANAGED_FIELDS.has(k)) continue
    const a = mine[k] === undefined ? null : mine[k], b = theirs[k] === undefined ? null : theirs[k]
    if (canon(a) !== canon(b)) out[k] = a
  }
  return out
}
const text = (s: unknown) => (typeof s === 'string' ? s.trim() : '')

const RULE = `Parley takes ${NAME_RULE} only.`
const okName = (f: string) => checkName(f, false).level === 'ok'
/** A layered item's file names Parley would check: the layers' files and random variants. */
const layerFiles = (layers: unknown) => (Array.isArray(layers) ? layers : []).flatMap((l) => {
  const o = (l ?? {}) as Record<string, unknown>
  return [o.file, ...(Array.isArray(o.random_variants) ? o.random_variants : [])].filter((x): x is string => typeof x === 'string')
})

/**
 * What stops an item being published. Parley's Import (new items) takes file and folder names of NAME_RULE only
 * (folders: no '.'), up to 8 MB a file. An item already on the instance keeps its name there whatever it is:
 * only files Parley would write under their own names (a layered item's sent layers and files) have to pass.
 */
function blockers(it: Item, onInstance: boolean): string[] {
  const out: string[] = []
  const key = keyOf(it)
  if (!onInstance && checkName(key, layered(it.kind)).level !== 'ok') out.push(`Rename ${layered(it.kind) ? 'the folder' : 'the file'} "${key}": ${RULE}${layered(it.kind) ? ' (no \'.\' in folder names)' : ''}`)
  for (const [f, b] of Object.entries(it.files)) {
    if (!onInstance && layered(it.kind) && !okName(f)) out.push(`Rename ${f}: ${RULE}`)
    if (b.size > 8 * 1024 * 1024) out.push(`${f} is over 8 MB, Parley's limit. Optimize it first.`)
  }
  if (!text(it.entry.name)) out.push('It needs a name.')
  return out
}

/** A single-file item's upload name for an edit: Parley keeps the item's own name and only takes the extension. */
export const uploadName = (f: string) => `file.${extOf(f) || 'png'}`

/**
 * What publishing would do for each item, before looking at files: new, blocked, or there already with these entry
 * differences. `compareFiles` then settles which of the files differ.
 */
export function planEntries(items: Item[], remote: Partial<Record<Kind, RemoteItem[]>>): PlanRow[] {
  const byValue = new Map<string, RemoteItem>()
  for (const k of KINDS) for (const r of remote[k] ?? []) byValue.set(`${k}/${r.value}`, r)
  return items.map((item) => {
    const id = assetId(keyOf(item), item.kind)
    const r = byValue.get(`${item.kind}/asset:${id}`)
    const block = blockers(item, !!r)
    if (block.length) return { item, id, action: 'blocked', notes: block, meta: {}, files: [], remote: r }
    if (!r) return { item, id, action: 'add', notes: [], meta: {}, files: Object.keys(item.files), remote: r }

    const notes: string[] = [], meta: Record<string, unknown> = {}
    if (text(item.entry.name) !== text(r.name)) { notes.push(`name: "${text(r.name)}" → "${text(item.entry.name)}"`); meta.name = text(item.entry.name) }
    if (text(item.entry.description) !== text(r.description)) { notes.push('description'); meta.description = text(item.entry.description) }
    if (layered(item.kind)) {
      const mine = (Array.isArray(item.entry.layers) ? item.entry.layers : []).map((l) => cleanLayer(item.kind, l as Record<string, unknown>))
      const theirs = (r.data.layers ?? []).map((l) => cleanLayer(item.kind, l))
      if (!same(mine, theirs)) {
        const bad = layerFiles(mine).filter((f) => !okName(f))
        if (bad.length) return { item, id, action: 'blocked', notes: [`The layers changed, and Parley checks their file names: rename ${bad.join(', ')}. ${RULE}`], meta: {}, files: [], remote: r }
        notes.push(mine.length === theirs.length ? 'layer settings' : `layers: ${theirs.length} → ${mine.length}`); meta.layers = mine
      }
      if (item.kind === 'frame' && !same(cleanLayout(item.entry.layout), cleanLayout(r.data.layout))) { notes.push('layout'); meta.layout = cleanLayout(item.entry.layout) }
    }
    // Tags sync with instances that report them; older ones keep whatever Import wrote.
    if (r.tags !== undefined) {
      const mine = tagsOf(item), theirs = cleanTags(r.tags ?? [])
      if (!same(mine, theirs)) { notes.push('tags'); meta.tags = mine }
    }
    // Every other entry field (shop details, colours, themes, bundles, …) with instances that report the whole entry.
    if (r.entry) {
      const fields = entryFieldChanges(item.entry, r.entry)
      if (Object.keys(fields).length) { notes.push(...Object.keys(fields).sort()); meta.fields = fields }
    }
    if (r.deleted) notes.push('Deleted in Parley: updates apply, but it stays deleted there.')
    return { item, id, action: notes.length ? 'update' : 'same', notes, meta, files: [], remote: r }
  })
}

/** Download the instance's copy of each file that may have changed (a few at a time), and mark the ones that did. */
export async function compareFiles(c: Conn, rows: PlanRow[], onProgress: (done: number, total: number) => void, signal?: AbortSignal) {
  const known = loadKnown(c.base)
  const jobs: { row: PlanRow; file: string }[] = []
  for (const row of rows) {
    if (!row.remote || row.action === 'blocked') continue
    for (const file of Object.keys(row.item.files)) jobs.push({ row, file })
  }
  let done = 0
  onProgress(0, jobs.length)
  const changed = new Map<PlanRow, string[]>()
  const run = async (j: { row: PlanRow; file: string }) => {
    if (signal?.aborted) return
    const { row, file } = j
    const k = knownKey(row.item.kind, row.id, file)
    const mine = await sha256(row.item.files[file])
    let differs = known[k] !== mine
    if (differs) {
      const theirs = await remoteFile(c, row.item.kind, row.id, layered(row.item.kind) ? file : undefined)
      differs = !theirs || (await sha256(theirs)) !== mine
      if (!differs) known[k] = mine
    }
    if (differs) changed.set(row, [...(changed.get(row) ?? []), file])
    onProgress(++done, jobs.length)
  }
  const queue = [...jobs]
  await Promise.all(Array.from({ length: 4 }, async () => { for (let j = queue.shift(); j; j = queue.shift()) await run(j) }))
  saveKnown(c.base, known)
  if (signal?.aborted) throw new DOMException('Stopped', 'AbortError')
  for (const [row, files] of changed) {
    const bad = layered(row.item.kind) ? files.filter((f) => !okName(f)) : []
    if (bad.length) { Object.assign(row, { action: 'blocked', notes: [`Changed files Parley would write under their own names: rename ${bad.join(', ')}. ${RULE}`], meta: {}, files: [] }); continue }
    row.files = files.sort()
    row.notes.push(files.length === 1 ? `file: ${files[0]}` : `${files.length} files`)
    if (row.action === 'same') row.action = 'update'
  }
}

/** Everything publishing needs to know about the instance, compared with these items. */
export async function plan(c: Conn, items: Item[], onProgress: (label: string, done: number, total: number) => void, signal?: AbortSignal) {
  const remote: Partial<Record<Kind, RemoteItem[]>> = {}
  // Only the kinds being published: one item reads one list.
  const kinds = KINDS.filter((k) => items.some((i) => i.kind === k))
  let n = 0
  for (const k of kinds) { onProgress('Reading the instance', n++, kinds.length); remote[k] = await remoteItems(c, k) }
  const rows = planEntries(items, remote)
  await compareFiles(c, rows, (d, t) => onProgress('Comparing files', d, t), signal)
  return rows
}

export interface Outcome { row: PlanRow; ok: boolean; error?: string }

/** Send the rows, one at a time (Parley writes its folder one change at a time anyway). */
export async function publish(c: Conn, rows: PlanRow[], onProgress: (done: number, total: number, label: string) => void, signal?: AbortSignal): Promise<Outcome[]> {
  const known = loadKnown(c.base)
  const out: Outcome[] = []
  for (const [i, row] of rows.entries()) {
    if (signal?.aborted) break
    onProgress(i, rows.length, text(row.item.entry.name) || keyOf(row.item))
    const { item } = row
    try {
      const files = Object.fromEntries(row.files.map((f) => [f, item.files[f]]))
      if (row.action === 'add') await importItem(c, item.kind, item.entry, files)
      else await editItem(c, item.kind, row.id, row.meta, layered(item.kind) ? files : Object.fromEntries(Object.entries(files).map(([f, b]) => [uploadName(f), b])))
      for (const f of row.files) known[knownKey(item.kind, row.id, f)] = await sha256(item.files[f])
      out.push({ row, ok: true })
    } catch (e) {
      out.push({ row, ok: false, error: e instanceof Error ? e.message : String(e) })
    }
    saveKnown(c.base, known)
  }
  onProgress(rows.length, rows.length, '')
  return out
}
