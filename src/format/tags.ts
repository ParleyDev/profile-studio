import type { Item } from './workspace'

/*
 * Tags: `tags` in an item's metadata.json entry, a list of short lower-case words ("christmas", "winter sports") for
 * searching and grouping. Parley keeps fields it doesn't know, so tags travel in exports and imports now; once Parley
 * reads them, publishing and pulling sync them too.
 */

export const MAX_TAGS = 20
export const MAX_TAG = 32

/*
 * Special tags: `color:<code>` and `theme:<code>` give an item that colour or theme, on top of what a sync script wrote
 * in `colors` and `themes` (Parley's Discover filters by both). The code is tidied like a `tag_labels` label:
 * "theme:Cute & Cozy" → "theme:cute_cozy". Other "x:y" tags are plain tags.
 */
export type Facet = 'color' | 'theme'
/** A colour or theme code, the way Parley makes one from a label: lower case, other runs as '_'. */
export const facetCode = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
const SPECIAL = /^\s*#?\s*(colou?r|theme)\s*:\s*(.*)$/i
/** The colour or theme a tag gives, if it's a special tag. */
export function specialTag(t: string): { facet: Facet; code: string } | null {
  const m = /^(color|theme):([a-z0-9_]+)$/.exec(t)
  return m ? { facet: m[1] as Facet, code: m[2] } : null
}
/** The codes an item's special tags give for a facet. */
export const taggedFacet = (it: Item, facet: Facet) => tagsOf(it).map(specialTag).filter((x) => x?.facet === facet).map((x) => x!.code)

/** A tag as stored: lower case, letters, digits, spaces, '-' and '_', single spaces, up to 32 characters (special tags: see above). */
export function cleanTag(s: string): string {
  const m = SPECIAL.exec(s)
  if (m) { const code = facetCode(m[2]); return code ? `${m[1].toLowerCase().startsWith('colo') ? 'color' : 'theme'}:${code}`.slice(0, MAX_TAG).replace(/_+$/, '') : '' }
  return s.toLowerCase().replace(/[^\p{L}\p{N} _-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TAG).trim()
}

/** A list of tags made tidy: each cleaned, no blanks or repeats, at most 20. */
export function cleanTags(list: unknown[]): string[] {
  const out: string[] = []
  for (const t of list) {
    const c = typeof t === 'string' ? cleanTag(t) : ''
    if (c && !out.includes(c)) out.push(c)
  }
  return out.slice(0, MAX_TAGS)
}

/** An item's tags, read leniently (whatever isn't a usable tag is skipped). */
export function tagsOf(it: Item): string[] {
  const t = it.entry.tags
  return Array.isArray(t) ? cleanTags(t) : []
}

/** Every tag in use, most used first, with how many items have it. */
export function allTags(items: Item[]): [string, number][] {
  const n = new Map<string, number>()
  for (const it of items) for (const t of tagsOf(it)) n.set(t, (n.get(t) ?? 0) + 1)
  return [...n].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
}

/**
 * A search: `#tag` words must each be tags of the item (or its shop colours and themes) (spaces in a tag written as '-' or '_' match too, so
 * `#winter-sports` finds "winter sports"); the other words are looked for in its name, file, description and tags.
 */
export function parseQuery(q: string): { tags: string[]; text: string } {
  const tags: string[] = [], text: string[] = []
  for (const w of q.trim().toLowerCase().split(/\s+/).filter(Boolean)) {
    if (w.startsWith('#') && w.length > 1) tags.push(w.slice(1))
    else text.push(w)
  }
  return { tags, text: text.join(' ') }
}
const loose = (t: string) => t.replace(/[\s_-]+/g, '-')
/** Tags plus the shop colours and themes a sync script added (`colors`, `themes`), for searching. */
export function searchTagsOf(it: Item): string[] {
  const synced = [it.entry.colors, it.entry.themes].flatMap((v) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])).map(facetCode)
  const tagged = tagsOf(it).map(specialTag).filter(Boolean).map((x) => x!.code)
  const extra = [...synced, ...tagged].filter(Boolean)
  return extra.length ? [...new Set([...tagsOf(it), ...extra])] : tagsOf(it)
}
export function matchesQuery(it: Item, q: { tags: string[]; text: string }, key: string): boolean {
  const mine = searchTagsOf(it)
  if (q.tags.length && !q.tags.every((t) => mine.some((m) => loose(m) === loose(t)))) return false
  if (!q.text) return true
  return `${it.entry.name ?? ''}\n${key}\n${it.entry.description ?? ''}\n${mine.join('\n')}`.toLowerCase().includes(q.text)
}

/** The search with `#tag` added, or taken out when it's there. */
export function toggleTagInQuery(q: string, tag: string): string {
  const word = `#${tag.replace(/ /g, '-')}`
  const words = q.trim().split(/\s+/).filter(Boolean)
  const has = words.some((w) => w.toLowerCase() === word)
  return (has ? words.filter((w) => w.toLowerCase() !== word) : [...words, word]).join(' ') + (has ? '' : ' ')
}
