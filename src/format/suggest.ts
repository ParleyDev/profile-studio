import { shopOf } from './shop'
import { allTags, cleanTag, facetCode, tagsOf } from './tags'
import { keyOf, type Item } from './workspace'

/*
 * Tag suggestions, worked out in the browser: words in an item's name, file and description (matched against tags
 * already in use and a small built-in vocabulary), what its picture looks like (main colours, whether it moves), and
 * which tags the items that look most like it share. Suggestions are only offered; nothing is added unasked.
 */

/** What a picture looks like, from its first frame scaled down. */
export interface Features {
  /** Colour mix: 4×4×4 RGB bins, weighted by opacity, summing to 1 (all 0 when nothing is opaque). */
  hist: number[]
  /** A 64-bit difference hash of the picture over grey: near pictures differ in few bits. */
  hash: number[]
  /** Colour names covering much of the picture, most first. */
  colors: string[]
  animated: boolean
}

/** Built-in tags and the words that suggest them. */
const VOCAB: Record<string, string[]> = {
  christmas: ['christmas', 'xmas', 'santa', 'reindeer', 'elf', 'elves', 'ornament', 'mistletoe', 'holly', 'wreath', 'noel', 'candycane', 'gingerbread', 'present', 'gift'],
  winter: ['winter', 'snow', 'snowy', 'snowflake', 'snowman', 'ice', 'icy', 'frost', 'frosty', 'frozen', 'blizzard', 'penguin', 'icicle'],
  halloween: ['halloween', 'pumpkin', 'ghost', 'ghoul', 'spooky', 'witch', 'bat', 'skeleton', 'skull', 'zombie', 'haunted', 'jackolantern', 'cauldron'],
  spring: ['spring', 'blossom', 'bloom', 'tulip', 'sakura', 'cherry'],
  easter: ['easter', 'egg', 'bunny', 'chick'],
  summer: ['summer', 'beach', 'sunny', 'surf', 'tropical', 'palm', 'sunshine'],
  autumn: ['autumn', 'fall', 'leaf', 'leaves', 'maple', 'harvest', 'acorn'],
  valentines: ['valentine', 'valentines', 'heart', 'love', 'cupid', 'kiss'],
  'new year': ['newyear', 'firework', 'fireworks', 'champagne', 'countdown'],
  nature: ['flower', 'floral', 'tree', 'forest', 'vine', 'garden', 'plant', 'leaf', 'leaves', 'rose', 'mushroom'],
  animals: ['cat', 'kitty', 'kitten', 'dog', 'puppy', 'fox', 'rabbit', 'bunny', 'bird', 'owl', 'bear', 'wolf', 'panda', 'penguin', 'frog', 'fish', 'butterfly'],
  fantasy: ['dragon', 'magic', 'wizard', 'fairy', 'unicorn', 'crystal', 'rune', 'enchanted', 'mythic'],
  space: ['space', 'star', 'galaxy', 'planet', 'moon', 'rocket', 'cosmic', 'nebula', 'astronaut', 'orbit'],
  gaming: ['game', 'gaming', 'gamer', 'controller', 'pixel', 'arcade', 'retro', '8bit'],
  music: ['music', 'musical', 'note', 'guitar', 'headphone', 'dj', 'beat'],
  food: ['food', 'cake', 'cookie', 'candy', 'donut', 'pizza', 'sweet', 'cupcake'],
  fire: ['fire', 'flame', 'burning', 'lava', 'ember', 'blaze', 'inferno'],
  water: ['water', 'rain', 'ocean', 'sea', 'wave', 'bubble', 'underwater', 'aqua'],
  neon: ['neon', 'glow', 'glowing', 'cyber', 'cyberpunk', 'synthwave', 'vaporwave'],
  cute: ['cute', 'kawaii', 'chibi'],
  sparkle: ['sparkle', 'sparkly', 'glitter', 'shimmer', 'twinkle'],
  pride: ['pride', 'rainbow', 'lgbt', 'lgbtq'],
  sports: ['sport', 'ball', 'soccer', 'football', 'basketball', 'baseball', 'tennis', 'hockey'],
  'winter sports': ['ski', 'skiing', 'snowboard', 'snowboarding', 'skate', 'skating', 'sled', 'sledding', 'hockey'],
}

/** Plurals folded, so "stars" finds "star" and "snowflakes" finds "snowflake". */
const fold = (w: string) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)
const WORD_TAGS = new Map<string, string[]>()
for (const [tag, words] of Object.entries(VOCAB)) for (const w of words) WORD_TAGS.set(fold(w), [...(WORD_TAGS.get(fold(w)) ?? []), tag])

/** The words in an item's name, file or folder name (without its extension) and description, plurals folded. */
export function wordsOf(it: Item): Set<string> {
  const key = keyOf(it).replace(/\.[a-z0-9]+$/i, '')
  const text = `${it.entry.name ?? ''} ${key} ${it.entry.description ?? ''}`.replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2').toLowerCase()
  return new Set(text.split(/[^\p{L}\p{N}]+/u).filter(Boolean).map(fold))
}

// Hue ranges (degrees) for colour names; black, white and grey come from brightness and saturation.
const HUES: [number, string][] = [[15, 'red'], [45, 'orange'], [70, 'yellow'], [160, 'green'], [195, 'teal'], [255, 'blue'], [290, 'purple'], [345, 'pink'], [360, 'red']]
function colorName(r: number, g: number, b: number): string {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), v = max / 255, s = max ? (max - min) / max : 0
  if (v < 0.2) return 'black'
  if (s < 0.18) return v > 0.85 ? 'white' : 'gray'
  const d = max - min
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  h = (h * 60 + 360) % 360
  return HUES.find(([to]) => h < to)![1]
}
const CHROMATIC = new Set(['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'])

/** Features of a picture from its RGBA pixels (any size; 32×32 is plenty). `animated` is filled in by the caller. */
export function fromPixels(px: ArrayLike<number>, w: number, h: number): Omit<Features, 'animated'> {
  const hist: number[] = Array.from({ length: 64 }, () => 0)
  const names = new Map<string, number>()
  let total = 0
  for (let i = 0; i < w * h; i++) {
    const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2], a = px[i * 4 + 3] / 255
    if (!a) continue
    hist[(r >> 6) * 16 + (g >> 6) * 4 + (b >> 6)] += a
    total += a
    if (a > 0.5) { const n = colorName(r, g, b); names.set(n, (names.get(n) ?? 0) + 1) }
  }
  if (total) for (let i = 0; i < 64; i++) hist[i] /= total
  // Colours covering at least a quarter of the opaque picture, at most two; many strong colours make it colourful.
  const opaque = [...names.values()].reduce((a, b) => a + b, 0)
  const ranked = [...names].sort((a, b) => b[1] - a[1])
  const colors = opaque ? ranked.filter(([, n]) => n / opaque >= 0.25).slice(0, 2).map(([c]) => c) : []
  if (ranked.filter(([c, n]) => CHROMATIC.has(c) && n / opaque >= 0.08).length >= 5) colors.push('colorful')
  // Difference hash: a 9×8 grid of average greys (see-through parts over mid grey), each cell against its right neighbour.
  const grid: number[] = []
  for (let gy = 0; gy < 8; gy++) for (let gx = 0; gx < 9; gx++) {
    const x0 = Math.floor((gx * w) / 9), x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * w) / 9))
    const y0 = Math.floor((gy * h) / 8), y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * h) / 8))
    let sum = 0, n = 0
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4, a = px[i + 3] / 255
      sum += a * (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) + (1 - a) * 128
      n++
    }
    grid.push(sum / n)
  }
  const hash: number[] = []
  for (let gy = 0; gy < 8; gy++) for (let gx = 0; gx < 8; gx++) hash.push(grid[gy * 9 + gx] > grid[gy * 9 + gx + 1] ? 1 : 0)
  return { hist, hash, colors }
}

/** How alike two pictures look, 0 to 1: half colour mix, half shape (the hash). */
export function similarity(a: Features, b: Features): number {
  let bits = 0
  for (let i = 0; i < 64; i++) if (a.hash[i] !== b.hash[i]) bits++
  const shape = 1 - bits / 64
  if (!a.hist.some(Boolean) || !b.hist.some(Boolean)) return shape
  let l1 = 0
  for (let i = 0; i < 64; i++) l1 += Math.abs(a.hist[i] - b.hist[i])
  return 0.5 * (1 - l1 / 2) + 0.5 * shape
}
/** Items this alike count as similar; one this alike is enough on its own. */
export const NEAR = 0.8
export const VERY_NEAR = 0.9

export interface Suggestion {
  tag: string
  /** Why, in a few words each ("“santa” in its name", "3 similar items have it"). */
  why: string[]
  score: number
}

/**
 * Tags to offer an item, best first, leaving out ones it has. `pool` is every item (for tags in use and similar
 * items); `feats` holds the features worked out so far, by uid (without them only the words are used).
 */
export function suggestTags(it: Item, pool: Item[], feats?: Map<string, Features | null>, opts: { max?: number; labels?: Map<string, string> } = {}): Suggestion[] {
  const max = opts.max ?? 10
  const mine = shopOf(it)
  // Tags it has, and colours and themes it has already (from the shop or special tags) as their special tags.
  const have = new Set([...tagsOf(it), ...mine.allColors.map((c) => `color:${c}`), ...mine.allThemes.map((t) => `theme:${t}`)])
  const inUse = new Set(allTags(pool).map(([t]) => t))
  const out = new Map<string, Suggestion>()
  const add = (tag: string, why: string, score: number) => {
    const t = cleanTag(tag)
    if (!t || have.has(t)) return
    const s = out.get(t) ?? { tag: t, why: [], score: 0 }
    if (!s.why.includes(why)) s.why.push(why)
    s.score += score
    out.set(t, s)
  }
  // Every theme known: tag_labels' and the ones items have.
  const themes = new Set(opts.labels?.keys() ?? [])
  for (const o of pool) for (const t of shopOf(o).allThemes) themes.add(t)

  const words = wordsOf(it)
  for (const t of inUse) {
    const parts = t.split(/[\s_-]+/).map(fold)
    if (parts.every((w) => words.has(w))) add(t, `“${t}” in its name or description`, 3)
  }
  for (const w of words) for (const t of WORD_TAGS.get(w) ?? []) {
    add(t, `“${w}” in its name or description`, inUse.has(t) ? 2.5 : 2)
    if (themes.has(facetCode(t))) add(`theme:${facetCode(t)}`, `“${w}” in its name or description`, 2)
  }
  // A theme whose words are all in its name or description ("cute_cozy" wants both).
  for (const code of themes) {
    const parts = code.split('_').filter((w) => w.length > 2 && w !== 'and').map(fold)
    if (parts.length && parts.every((w) => words.has(w))) add(`theme:${code}`, `“${code.replace(/_/g, ' ')}” in its name or description`, 2.5)
  }

  const f = feats?.get(it.uid)
  if (f) {
    for (const c of f.colors) add(c === 'colorful' ? c : `color:${c}`, c === 'colorful' ? 'many strong colours' : `mostly ${c}`, 1.5)
    if (f.animated) add('animated', 'it moves', inUse.has('animated') ? 1.5 : 1)
    const near: [Item, number][] = []
    for (const o of pool) {
      const g = o.uid !== it.uid && o.kind === it.kind && (tagsOf(o).length || shopOf(o).themes.length) ? feats?.get(o.uid) : null
      if (!g) continue
      const s = similarity(f, g)
      if (s >= NEAR) near.push([o, s])
    }
    near.sort((a, b) => b[1] - a[1])
    const votes = new Map<string, { n: number; best: number; name: string }>()
    for (const [o, s] of near.slice(0, 5)) for (const t of new Set([...tagsOf(o), ...shopOf(o).themes.map((x) => `theme:${x}`)])) {
      const v = votes.get(t) ?? { n: 0, best: 0, name: String(o.entry.name || keyOf(o)) }
      votes.set(t, { n: v.n + 1, best: Math.max(v.best, s), name: v.name })
    }
    for (const [t, v] of votes) {
      if (v.n >= 2) add(t, `${v.n} similar items have it`, 1 + v.n)
      else if (v.best >= VERY_NEAR) add(t, `looks like “${v.name}”`, 2)
    }
  }
  return [...out.values()].sort((a, b) => b.score - a.score || (a.tag < b.tag ? -1 : 1)).slice(0, max)
}
