import { assetId, checkName, extOf, layered, NAME_PUNCT, type Kind } from './kinds'
import { keyOf, type Item } from './workspace'

/*
 * Tidying names Parley's Import (and its layer check) refuses: anything but letters, digits, '.', '_', '-' and NAME_PUNCT
 * (folders: no '.') becomes '_', runs of '_' collapse, and the ends are trimmed. "café:1.png" → "caf_1.png".
 */

/** A name Parley takes, from one it may not: a file keeps its extension (lower-cased). */
export function tidyName(name: string, folder: boolean): string {
  const ext = folder ? '' : extOf(name)
  const raw = ext ? name.slice(0, -(ext.length + 1)) : name
  const ok = (c: string) => /[A-Za-z0-9_-]/.test(c) || NAME_PUNCT.includes(c) || (!folder && c === '.')
  const stem = [...raw].map((c) => (ok(c) ? c : '_')).join('').replace(/_{2,}/g, '_').replace(/^[._\- ]+|[._\- ]+$/g, '').slice(0, folder ? 100 : 90) || (folder ? 'item' : 'file')
  return ext ? `${stem}.${ext}` : stem
}

export interface NameFix {
  uid: string
  kind: Kind
  /** The item's new file or folder name, when it changes. */
  key?: { from: string; to: string }
  /** A layered item's files renamed (the layers follow). */
  files: { from: string; to: string }[]
}

const bad = (name: string, folder: boolean) => checkName(name, folder).level !== 'ok'

/**
 * The renames that let these items publish. An item already on the instance keeps its file or folder name (members
 * wearing it store its id); only a layered one's files are tidied, as Parley checks every layer's name when layers are
 * sent. New items are tidied whole, to names whose ids clash with nothing in `taken` (kind/id) or with each other.
 */
export function nameFixes(items: Item[], onInstance: (it: Item) => boolean, taken: Set<string>): NameFix[] {
  const used = new Set(taken)
  const out: NameFix[] = []
  for (const it of items) {
    const fix: NameFix = { uid: it.uid, kind: it.kind, files: [] }
    const key = keyOf(it)
    const folder = layered(it.kind)
    if (!onInstance(it) && key && bad(key, folder)) {
      used.delete(`${it.kind}/${assetId(key, it.kind)}`)
      let to = tidyName(key, folder)
      const ext = folder ? '' : extOf(to)
      const stem = ext ? to.slice(0, -(ext.length + 1)) : to
      for (let n = 2; used.has(`${it.kind}/${assetId(to, it.kind)}`); n++) to = ext ? `${stem}_${n}.${ext}` : `${stem}_${n}`
      used.add(`${it.kind}/${assetId(to, it.kind)}`)
      fix.key = { from: key, to }
    }
    if (folder) {
      const names = new Set(Object.keys(it.files))
      for (const f of Object.keys(it.files).sort()) {
        if (!bad(f, false)) continue
        names.delete(f)
        let to = tidyName(f, false)
        const ext = extOf(to), stem = ext ? to.slice(0, -(ext.length + 1)) : to
        for (let n = 2; names.has(to); n++) to = ext ? `${stem}_${n}.${ext}` : `${stem}_${n}`
        names.add(to)
        fix.files.push({ from: f, to })
      }
    }
    if (fix.key || fix.files.length) out.push(fix)
  }
  return out
}

/** The item with a fix applied: its key, its files, and its layers' file and random-variant names. */
export function applyFix(it: Item, fix: NameFix): Item {
  const map = new Map(fix.files.map((f) => [f.from, f.to]))
  let files = Object.fromEntries(Object.entries(it.files).map(([n, b]) => [map.get(n) ?? n, b]))
  const entry = { ...it.entry }
  if (fix.key) {
    if (layered(it.kind)) entry.folder = fix.key.to
    else {
      entry.file = fix.key.to
      if (files[fix.key.from]) { const { [fix.key.from]: b, ...rest } = files; files = { ...rest, [fix.key.to]: b } }
    }
  }
  if (map.size && Array.isArray(entry.layers)) {
    entry.layers = (entry.layers as Record<string, unknown>[]).map((l) => {
      const out = { ...l }
      if (typeof l.file === 'string') out.file = map.get(l.file) ?? l.file
      if (Array.isArray(l.random_variants)) out.random_variants = l.random_variants.map((v) => (typeof v === 'string' ? map.get(v) ?? v : v))
      return out
    })
  }
  return { ...it, entry, files }
}
