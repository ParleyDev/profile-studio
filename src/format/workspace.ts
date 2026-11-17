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
  /** Each kind's metadata.json beyond its items (e.g. `item_count`), kept as it was read. */
  extras: Partial<Record<Kind, Record<string, unknown>>>
}

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
  for (const f of files) {
    const parts = f.path.split('/').filter(Boolean)
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
  for (const kind of KINDS) {
    const slot = byKind.get(kind)
    if (!slot) continue
    const dir = KIND_DIRS[kind]
    let meta: Record<string, unknown> = {}
    if (!slot.meta) notes.push(`${dir}/ has no metadata.json, so Parley would skip what's in it. Its files are listed as new items to describe.`)
    else {
      try { meta = JSON.parse(await slot.meta.text()) } catch { notes.push(`${dir}/metadata.json isn't valid JSON, so it was left out.`) }
      if (meta && !Array.isArray(meta.items)) { notes.push(`${dir}/metadata.json has no items list.`); meta = {} }
    }
    const { items: list = [], ...extras } = meta as { items?: unknown[] }
    if (Object.keys(extras).length) ws.extras[kind] = extras
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

/** A kind's metadata.json as Parley writes it: one-space indent, a trailing newline, `item_count` kept true. */
export function metadataJson(ws: Workspace, kind: Kind): string {
  const items = ws.items.filter((i) => i.kind === kind).map((i) => i.entry)
  const meta: Record<string, unknown> = { ...ws.extras[kind], items }
  if ('item_count' in meta) meta.item_count = items.length
  return `${JSON.stringify(meta, null, 1)}\n`
}

/**
 * The workspace as an assets folder: each kind that has items gets its folder and metadata.json. Only files an entry
 * uses are written for decorations and nameplates; an effect's or frame's folder is written whole.
 */
export function writeFolder(ws: Workspace): FolderFile[] {
  const out: FolderFile[] = []
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
