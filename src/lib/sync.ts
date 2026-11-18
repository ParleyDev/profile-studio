/*
 * Publishing to a Parley instance: compare the saved items with what the instance has, then add the new ones and
 * update the changed ones. Nothing on the instance is deleted. Items are matched by the id Parley gives them
 * (assetId), so `Foo Bar.png` here updates `foo_bar.webp` there.
 *
 * Telling whether a file changed means comparing bytes, and the instance doesn't say a file's size or hash, so the
 * first comparison downloads the files of items both sides have. What matched or was sent is remembered per
 * instance (a SHA-256 of the file), so later comparisons only download files that changed here since.
 */
import { assetId, checkName, KINDS, layered, type Kind } from '../format/kinds'
import { keyOf, type Item } from '../format/workspace'
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
    h = b.arrayBuffer().then((buf) => crypto.subtle.digest('SHA-256', buf)).then((d) => [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join(''))
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
const text = (s: unknown) => (typeof s === 'string' ? s.trim() : '')

/** Parley's Import takes file and folder names of letters, digits, '.', '_' and '-' only, up to 8 MB a file. */
function blockers(it: Item): string[] {
  const out: string[] = []
  const key = keyOf(it)
  if (checkName(key, layered(it.kind)).level !== 'ok') out.push(`Rename ${layered(it.kind) ? 'the folder' : 'the file'} "${key}": Parley takes letters, digits${layered(it.kind) ? '' : ', \'.\''}, '_' and '-' only.`)
  for (const [f, b] of Object.entries(it.files)) {
    if (layered(it.kind) && checkName(f, false).level !== 'ok') out.push(`Rename ${f}: Parley takes letters, digits, '.', '_' and '-' only.`)
    if (b.size > 8 * 1024 * 1024) out.push(`${f} is over 8 MB, Parley's limit. Optimize it first.`)
  }
  if (!text(it.entry.name)) out.push('It needs a name.')
  return out
}

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
    const block = blockers(item)
    if (block.length) return { item, id, action: 'blocked', notes: block, meta: {}, files: [], remote: r }
    if (!r) return { item, id, action: 'add', notes: [], meta: {}, files: Object.keys(item.files), remote: r }

    const notes: string[] = [], meta: Record<string, unknown> = {}
    if (text(item.entry.name) !== text(r.name)) { notes.push(`name: "${text(r.name)}" → "${text(item.entry.name)}"`); meta.name = text(item.entry.name) }
    if (text(item.entry.description) !== text(r.description)) { notes.push('description'); meta.description = text(item.entry.description) }
    if (layered(item.kind)) {
      const mine = (Array.isArray(item.entry.layers) ? item.entry.layers : []).map((l) => cleanLayer(item.kind, l as Record<string, unknown>))
      const theirs = (r.data.layers ?? []).map((l) => cleanLayer(item.kind, l))
      if (!same(mine, theirs)) { notes.push(mine.length === theirs.length ? 'layer settings' : `layers: ${theirs.length} → ${mine.length}`); meta.layers = mine }
      if (item.kind === 'frame' && !same(cleanLayout(item.entry.layout), cleanLayout(r.data.layout))) { notes.push('layout'); meta.layout = cleanLayout(item.entry.layout) }
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
    row.files = files.sort()
    row.notes.push(files.length === 1 ? `file: ${files[0]}` : `${files.length} files`)
    if (row.action === 'same') row.action = 'update'
  }
}

/** Everything publishing needs to know about the instance, compared with these items. */
export async function plan(c: Conn, items: Item[], onProgress: (label: string, done: number, total: number) => void, signal?: AbortSignal) {
  const remote: Partial<Record<Kind, RemoteItem[]>> = {}
  let n = 0
  for (const k of KINDS) { onProgress('Reading the instance', n++, KINDS.length); remote[k] = await remoteItems(c, k) }
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
      else await editItem(c, item.kind, row.id, row.meta, files)
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
