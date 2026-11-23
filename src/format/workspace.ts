import { KIND_DIRS, KINDS, layered, mimeOf, type Kind } from './kinds'

/**
 * What the Studio edits: an assets folder in memory. Each item keeps its metadata.json entry whole, so fields the
 * Studio doesn't edit (anything Discord or another tool put there) go back out untouched, and its files as Blobs.
 */
export interface Item {
  /** The Studio's own handle for it; never written out. */
  uid: string
  kind: Kind
  /** Its metadata.json entry: `file` (decorations, nameplates) or `folder` (effects, frames), name, description, … */
  entry: Entry
  /** Decorations and nameplates: one file, under its file name; effects and frames: every file in the folder. */
  files: Record<string, Blob>
}

export interface Entry { file?: string; folder?: string; name?: string; description?: string; [k: string]: unknown }

export interface Workspace {
  items: Item[]
  /** Each kind's metadata.json beyond its items (e.g. `item_count`), kept as it was read (`items: null` keeps its place). */
  extras: Partial<Record<Kind, Record<string, unknown>>>
  /** The assets folder's bundles.json (shop bundles linking items of every kind by `shop_item_id`), kept as read. */
  bundles?: Record<string, unknown>
  /** bundles.local.json: the Studio's bundle changes, laid over bundles.json (see format/shop.ts). */
  localBundles?: Record<string, unknown>
  /** How each file was laid out when read (metadata.json by kind, and bundles.json), so saving back doesn't reformat it. */
  format?: Partial<Record<Kind | 'bundles' | 'localBundles', JsonFormat>>
}

/** Files at the assets folder's root, beside the kind folders. */
type RootFile = 'bundles' | 'localBundles'
const ROOT_FILES: [RootFile, string][] = [['bundles', 'bundles.json'], ['localBundles', 'bundles.local.json']]

/** A JSON file's layout: its indent and whether it ends with a newline. */
export interface JsonFormat { indent: string; newline: boolean }
/** Parley's own layout: one-space indent and a trailing newline. */
const PARLEY: JsonFormat = { indent: ' ', newline: true }
/** How a file is laid out; one on a single line gets Parley's layout. */
export const formatOf = (text: string): JsonFormat => {
  const indent = /\n([ \t]+)\S/.exec(text)?.[1]
  return indent ? { indent, newline: text.endsWith('\n') } : PARLEY
}
const asJson = (v: unknown, f: JsonFormat = PARLEY) => `${JSON.stringify(v, null, f.indent)}${f.newline ? '\n' : ''}`

export const emptyWorkspace = (): Workspace => ({ items: [], extras: {} })
export const keyOf = (it: Item) => String((layered(it.kind) ? it.entry.folder : it.entry.file) ?? '')

let n = 0
export const newUid = () => `i${Date.now().toString(36)}${(n++).toString(36)}${Math.random().toString(36).slice(2, 6)}`

/** One file in an assets folder, by its path from the folder's root (`profile-effects/rain/layer_01.png`). */
export interface FolderFile { path: string; blob: Blob }

export interface ReadResult { workspace: Workspace; notes: string[] }

/**
 * An assets folder (picked whole, dropped, or from a zip) read into a workspace. The folder can sit anywhere in the
 * paths: whatever comes before a kind's folder name is ignored. A kind folder without a metadata.json, an entry with
 * no files, and files no entry names are reported, not fatal.
 */
export async function readFolder(files: FolderFile[]): Promise<ReadResult> {
  const notes: string[] = []
  const byKind = new Map<Kind, { meta?: Blob; files: Map<string, Blob> }>()
  // bundles.json and bundles.local.json sit beside the kind folders; the shallowest wins when a zip holds more than one.
  const roots: Partial<Record<RootFile, { blob: Blob; depth: number }>> = {}
  for (const f of files) {
    const parts = f.path.split('/').filter(Boolean)
    const root = ROOT_FILES.find(([, name]) => name === parts.at(-1))?.[0]
    if (root && !parts.some((p) => KINDS.some((k) => KIND_DIRS[k] === p) || p.startsWith('.') || p === '__MACOSX')) {
      const was = roots[root]
      if (!was || parts.length < was.depth) roots[root] = { blob: f.blob, depth: parts.length }
      continue
    }
    let at = -1, kind: Kind | undefined
    for (let i = parts.length - 2; i >= 0; i--) { kind = KINDS.find((k) => KIND_DIRS[k] === parts[i]); if (kind) { at = i; break } }
    if (!kind) continue
    const rest = parts.slice(at + 1)
    if (rest.some((p) => p.startsWith('.') || p === '__MACOSX')) continue
    const slot: { meta?: Blob; files: Map<string, Blob> } = byKind.get(kind) ?? { files: new Map() }
    byKind.set(kind, slot)
    const rel = rest.join('/')
    if (rel === 'metadata.json') slot.meta = f.blob
    else slot.files.set(rel, f.blob)
  }
  const ws = emptyWorkspace()
  for (const [root, name] of ROOT_FILES) {
    const found = roots[root]
    if (!found) continue
    try {
      const text = await found.blob.text()
      const b = JSON.parse(text)
      if (b && typeof b === 'object' && Array.isArray(b.bundles)) { ws[root] = b; ws.format = { ...ws.format, [root]: formatOf(text) } }
      else notes.push(`${name} has no bundles list, so it was left out.`)
    } catch { notes.push(`${name} isn't valid JSON, so it was left out.`) }
  }
  for (const kind of KINDS) {
    const slot = byKind.get(kind)
    if (!slot) continue
    const dir = KIND_DIRS[kind]
    let meta: Record<string, unknown> = {}
    if (!slot.meta) notes.push(`${dir}/ has no metadata.json, so Parley would skip what's in it. Its files are listed as new items to describe.`)
    else {
      try { const text = await slot.meta.text(); meta = JSON.parse(text); ws.format = { ...ws.format, [kind]: formatOf(text) } } catch { notes.push(`${dir}/metadata.json isn't valid JSON, so it was left out.`) }
      if (meta && !Array.isArray(meta.items)) { notes.push(`${dir}/metadata.json has no items list.`); meta = {} }
    }
    const { items: list = [] } = meta as { items?: unknown[] }
    // `items: null` holds its place among the other fields, so it's written back where it was.
    const extras = Object.fromEntries(Object.entries(meta).map(([k, v]) => [k, k === 'items' ? null : v]))
    if (Object.keys(extras).some((k) => k !== 'items')) ws.extras[kind] = extras
    const used = new Set<string>()
    const field = layered(kind) ? 'folder' : 'file'
    for (const raw of list as unknown[]) {
      if (!raw || typeof raw !== 'object') continue
      const entry = { ...(raw as Entry) }
      const key = typeof entry[field] === 'string' ? (entry[field] as string).trim() : ''
      if (!key) { notes.push(`${dir}/metadata.json has an entry without a ${field}; it was left out.`); continue }
      if (used.has(key)) { notes.push(`${dir}/metadata.json lists ${key} twice; the second was left out.`); continue }
      used.add(key)
      const mine: Record<string, Blob> = {}
      if (layered(kind)) {
        for (const [rel, b] of slot.files) if (rel.startsWith(`${key}/`) && !rel.slice(key.length + 1).includes('/')) mine[rel.slice(key.length + 1)] = b
      } else if (slot.files.has(key)) mine[key] = slot.files.get(key)!
      if (!Object.keys(mine).length) notes.push(`${dir}/${key} is listed but its ${layered(kind) ? 'folder is empty or missing' : 'file is missing'}.`)
      ws.items.push({ uid: newUid(), kind, entry, files: mine })
    }
    // Files no entry names: offered as new items, since Parley would ignore them.
    const loose = new Map<string, Record<string, Blob>>()
    for (const [rel, b] of slot.files) {
      const top = rel.split('/')[0]
      if (used.has(top)) continue
      if (layered(kind)) {
        if (!rel.includes('/') || rel.split('/').length > 2) continue
        const folder = loose.get(top) ?? {}
        folder[rel.slice(top.length + 1)] = b
        loose.set(top, folder)
      } else if (!rel.includes('/')) loose.set(rel, { [rel]: b })
    }
    for (const [key, mine] of loose) {
      notes.push(`${dir}/${key} isn't in metadata.json; it was added so you can describe it.`)
      ws.items.push({ uid: newUid(), kind, entry: { [field]: key, name: '', description: '' }, files: mine })
    }
  }
  return { workspace: ws, notes }
}

/**
 * A kind's metadata.json: as Parley writes it (one-space indent, a trailing newline) unless the file read was laid out
 * another way; `item_count` and `collections` kept true.
 */
export function metadataJson(ws: Workspace, kind: Kind): string {
  const items = ws.items.filter((i) => i.kind === kind).map((i) => i.entry)
  const meta: Record<string, unknown> = { ...ws.extras[kind], items }
  if ('item_count' in meta) meta.item_count = items.length
  if (meta.collections && typeof meta.collections === 'object') meta.collections = collectionsOf(meta.collections as Record<string, unknown>, items, layered(kind) ? 'folder' : 'file')
  return asJson(meta, ws.format?.[kind])
}

/**
 * `collections` ({id: {items: [file or folder, …]}}) as the items now say: each item with a `collection_id` listed
 * under it in metadata.json order, so renames, new items and deletions keep it true. Other fields of a collection stay.
 */
export function collectionsOf(old: Record<string, unknown>, items: Entry[], field: 'file' | 'folder'): Record<string, unknown> {
  const out: Record<string, Record<string, unknown>> = {}
  for (const e of items) {
    const id = typeof e.collection_id === 'string' ? e.collection_id : ''
    const key = e[field]
    if (!id || typeof key !== 'string') continue
    const was = old[id] && typeof old[id] === 'object' ? (old[id] as Record<string, unknown>) : {}
    out[id] ??= { ...was, items: [] }
    ;(out[id].items as string[]).push(key)
  }
  return out
}

/**
 * The workspace as an assets folder: each kind that has items gets its folder and metadata.json. Only files an entry
 * uses are written for decorations and nameplates; an effect's or frame's folder is written whole.
 */
export function writeFolder(ws: Workspace): FolderFile[] {
  const out: FolderFile[] = []
  for (const [root, name] of ROOT_FILES) {
    const v = ws[root]
    // An empty bundles.local.json (every change undone) isn't worth a file.
    if (v && !(root === 'localBundles' && !(v.bundles as unknown[]).length && Object.keys(v).length === 1)) out.push({ path: name, blob: new Blob([asJson(v, ws.format?.[root] ?? { indent: '  ', newline: true })], { type: 'application/json' }) })
  }
  for (const kind of KINDS) {
    const items = ws.items.filter((i) => i.kind === kind)
    if (!items.length) continue
    const dir = KIND_DIRS[kind]
    out.push({ path: `${dir}/metadata.json`, blob: new Blob([metadataJson(ws, kind)], { type: 'application/json' }) })
    for (const it of items) {
      const key = keyOf(it)
      if (layered(kind)) for (const [name, b] of Object.entries(it.files)) out.push({ path: `${dir}/${key}/${name}`, blob: b })
      else if (it.files[key]) out.push({ path: `${dir}/${key}`, blob: it.files[key] })
    }
  }
  return out
}

/** A Blob with the type its name implies (files read from a zip or a folder may come without one). */
export const typed = (b: Blob, name: string) => (b.type ? b : new Blob([b], { type: mimeOf(name) }))
