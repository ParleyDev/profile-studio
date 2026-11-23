/*
 * Publishing and pulling what isn't an item: the assets folder's bundles.json and bundles.local.json, and each kind's
 * metadata.json fields beyond its items (tag_labels and the like). Each is compared whole and goes one way at a time,
 * Push or Pull, guarded by the instance's etag so a change made there in between isn't overwritten.
 */
import { KINDS, type Kind } from '../format/kinds'
import type { Workspace } from '../format/workspace'
import { deleteBundleFile, patchMetadata, putBundleFile, remoteBundleFiles, remoteMetadata, type BundleFileName, type Conn, type RemoteJsonFile } from './parley'

const canon = (v: unknown) => JSON.stringify(v ?? null, (_k, x: unknown) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x))
/** Worked out from the items on both sides, so never compared or sent. */
const DERIVED = new Set(['items', 'item_count', 'collections'])

export type RootKey = 'bundles' | 'localBundles'
export const ROOT_NAME: Record<RootKey, BundleFileName> = { bundles: 'bundles.json', localBundles: 'bundles.local.json' }
export type FolderStatus = 'same' | 'differs' | 'here' | 'there' | 'error'
export type FolderRow =
  | { type: 'file'; root: RootKey; status: FolderStatus; notes: string[]; mine: Record<string, unknown> | null; theirs: RemoteJsonFile | null }
  | { type: 'meta'; kind: Kind; status: FolderStatus; notes: string[]; changes: Record<string, unknown>; pulled: Record<string, unknown>; etag: string | null }
export interface FolderPlan { bundles: boolean; metadata: boolean; rows: FolderRow[] }

/** bundles.local.json as it'd be written: none when it holds no bundles. */
const localFile = (ws: Workspace) => (ws.localBundles && Array.isArray(ws.localBundles.bundles) && ws.localBundles.bundles.length ? ws.localBundles : null)
/** A kind's own top-level fields (not the derived ones). */
export function ownFields(fields: Record<string, unknown> | undefined): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields ?? {}).filter(([k]) => !DERIVED.has(k)))
}

/** In words: which bundles differ between two bundle files. */
export function bundleNotes(a: Record<string, unknown> | null | undefined, b: Record<string, unknown> | null | undefined): string[] {
  const list = (f: Record<string, unknown> | null | undefined) => new Map((Array.isArray(f?.bundles) ? (f.bundles as { id?: unknown }[]) : []).filter((x) => typeof x?.id === 'string').map((x) => [x.id as string, x]))
  const mine = list(a), theirs = list(b)
  let added = 0, removed = 0, changed = 0
  for (const [id, x] of mine) { if (!theirs.has(id)) added++; else if (canon(x) !== canon(theirs.get(id))) changed++ }
  for (const id of theirs.keys()) if (!mine.has(id)) removed++
  const out: string[] = []
  if (added) out.push(`${added} only here`)
  if (removed) out.push(`${removed} only there`)
  if (changed) out.push(`${changed} different`)
  if (!out.length) out.push('the same bundles, other fields differ')
  return out
}

/** Compare the open folder's bundle files and folder settings with the instance's. */
export function planFolder(ws: Workspace, files: Record<BundleFileName, RemoteJsonFile | null> | null, metas: Partial<Record<Kind, { fields: Record<string, unknown>; etag: string | null } | null>>): FolderPlan {
  const rows: FolderRow[] = []
  if (files) {
    for (const root of ['bundles', 'localBundles'] as RootKey[]) {
      const mine = root === 'bundles' ? ws.bundles ?? null : localFile(ws)
      const theirs = files[ROOT_NAME[root]]
      if (!mine && !theirs) continue
      if (theirs?.error) { rows.push({ type: 'file', root, status: 'error', notes: [`The instance's copy can't be read: ${theirs.error}`], mine, theirs }); continue }
      const status: FolderStatus = !theirs ? 'here' : !mine ? 'there' : canon(mine) === canon(theirs.json) ? 'same' : 'differs'
      const count = (f: Record<string, unknown> | null | undefined) => (Array.isArray(f?.bundles) ? f.bundles.length : 0)
      const n = (k: number) => `${k} bundle${k === 1 ? '' : 's'}`
      const notes = status === 'differs' ? bundleNotes(mine, theirs?.json) : status === 'here' ? [`${n(count(mine))}, not on the instance`] : status === 'there' ? [`${n(count(theirs?.json))}, only on the instance`] : []
      rows.push({ type: 'file', root, status, notes, mine, theirs })
    }
  }
  let metadata = false
  for (const kind of KINDS) {
    const r = metas[kind]
    if (!r) continue
    metadata = true
    const mine = ownFields(ws.extras[kind]), theirs = ownFields(r.fields)
    const changes: Record<string, unknown> = {}, pulled: Record<string, unknown> = {}
    for (const k of new Set([...Object.keys(mine), ...Object.keys(theirs)])) {
      if (canon(mine[k]) === canon(theirs[k])) continue
      changes[k] = k in mine ? mine[k] : null
      pulled[k] = k in theirs ? theirs[k] : null
    }
    const keys = Object.keys(changes)
    if (!keys.length && !Object.keys(mine).length) continue
    rows.push({ type: 'meta', kind, status: keys.length ? 'differs' : 'same', notes: keys.sort(), changes, pulled, etag: r.etag })
  }
  return { bundles: !!files, metadata, rows }
}

/** Read the instance's bundle files and folder settings for the kinds open here (or there). */
export async function readFolder(c: Conn, ws: Workspace, kinds: Kind[] = KINDS) {
  const files = await remoteBundleFiles(c)
  const metas: Partial<Record<Kind, { fields: Record<string, unknown>; etag: string | null } | null>> = {}
  for (const k of kinds) {
    metas[k] = await remoteMetadata(c, k)
    if (metas[k] === null) break // an instance without the API answers the same for every kind
  }
  return planFolder(ws, files, metas)
}

/** Send one row's open side to the instance. */
export async function pushRow(c: Conn, row: FolderRow): Promise<void> {
  if (row.type === 'meta') { await patchMetadata(c, row.kind, row.changes, row.etag); return }
  const name = ROOT_NAME[row.root]
  if (row.mine) await putBundleFile(c, name, row.mine, row.theirs?.etag ?? null)
  else if (row.theirs) await deleteBundleFile(c, name, row.theirs.etag)
}
