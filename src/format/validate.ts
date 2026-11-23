import { assetId, type Rules, EFFECT_SPECIAL_FILES, KIND_DIRS, layered, MAX_DESCRIPTION, checkName, DEFAULT_RULES, extOf, FILE_EXTS, MAX_FILE, MAX_LAYERS, MAX_LAYOUT, MAX_MS, MAX_NAME, MAX_Z, type EffectLayer, type FrameLayer, type FrameLayout } from './kinds'
import { cleanTags, MAX_TAGS } from './tags'
import { keyOf, type Item, type Workspace } from './workspace'

/**
 * What Parley would say about an item. `error`: Parley refuses it (it won't read it from the folder, or, when the
 * rules say you use Import, Import rejects it). `warning`: it works, but probably not as meant, or Import would refuse
 * it while a copy into the assets folder works.
 */
export interface Problem { level: 'error' | 'warning'; message: string; /** The field or layer it is about, for the editor. */ at?: string }

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`
const int = (v: unknown, max: number) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max

/** Pixel sizes of an item's pictures, when known (the editor measures them), for the checks that need them. */
export type Sizes = Record<string, { w: number; h: number }>

export function validateItem(it: Item, ws?: Workspace, sizes: Sizes = {}, index?: WorkspaceIndex, rules: Rules = DEFAULT_RULES): Problem[] {
  const out: Problem[] = []
  const err = (message: string, at?: string) => out.push({ level: 'error', message, at })
  const warn = (message: string, at?: string) => out.push({ level: 'warning', message, at })
  const e = it.entry
  const key = keyOf(it)
  const field = layered(it.kind) ? 'folder' : 'file'

  const name = typeof e.name === 'string' ? e.name.trim() : ''
  if (!name) err('It needs a name.', 'name')
  else if (name.length > MAX_NAME) err(`Names are up to ${MAX_NAME} characters.`, 'name')
  if (typeof e.description === 'string' && e.description.trim().length > MAX_DESCRIPTION) err(`Descriptions are up to ${MAX_DESCRIPTION} characters.`, 'description')
  if (e.tags !== undefined) {
    const raw = Array.isArray(e.tags) ? e.tags : null
    if (!raw) warn('Tags should be a list of words.', 'tags')
    else {
      const clean = cleanTags(raw)
      if (raw.length > MAX_TAGS) warn(`Up to ${MAX_TAGS} tags: the rest are dropped when you edit them.`, 'tags')
      else if (raw.length !== clean.length || raw.some((t, i) => t !== clean[i])) warn('Some tags aren\'t tidy (tags are lower case letters, digits, spaces, \'-\' and \'_\'): editing them tidies them.', 'tags')
    }
  }

  /** A file or folder name against the rules; `label` says which name it is. */
  const name_ = (n: string, folder: boolean, label: string, at: string) => {
    const v = checkName(n, folder, rules)
    const list = v.chars.map((c) => (c === ' ' ? 'spaces' : `'${c}'`)).join(', ')
    if (v.level === 'bad') err(v.reason ? `${label} ${v.reason}.` : `${label} has ${list}, which ${v.chars.length === 1 ? 'isn\'t' : 'aren\'t'} allowed (Settings lists the characters you allow).`, at)
    else if (v.level === 'import') (rules.strictImport ? err : warn)(`${label} has ${list}: fine copied into an assets folder, but Parley's Import refuses ${v.chars.length === 1 ? 'it' : 'them'}.`, at)
    if (!folder && !FILE_EXTS[it.kind].includes(extOf(n))) err(`${label} needs to end in ${extList(it)}.`, at)
  }
  if (!key) err(`It needs a ${field} name.`, field)
  else name_(key, layered(it.kind), layered(it.kind) ? 'The folder name' : 'The file name', field)
  if (ws && key) {
    const idx = index ?? indexWorkspace(ws)
    if ((idx.keys.get(`${it.kind}\0${key}`) ?? 0) > 1) err(`Another ${field} in ${KIND_DIRS[it.kind]} has this name.`, field)
    else if ((idx.ids.get(`${it.kind}\0${assetId(key, it.kind)}`) ?? 0) > 1) err(`Parley would give this the same id as another one (${assetId(key, it.kind)}), and keep only one.`, field)
  }

  for (const [f, b] of Object.entries(it.files)) {
    if (rules.strictImport && b.size > MAX_FILE) err(`${f} is ${mb(b.size)}; Parley's Import takes files up to ${mb(MAX_FILE)}. Optimize can shrink it.`, `file:${f}`)
    else if (b.size > rules.maxFileMB * 1024 * 1024) warn(`${f} is ${mb(b.size)}, over ${rules.maxFileMB} MB: slow to load${b.size > MAX_FILE ? ', and Parley\'s Import refuses it (a copy into the assets folder works)' : ''}. Optimize can shrink it.`, `file:${f}`)
    if (b.size === 0) err(`${f} is empty.`, `file:${f}`)
  }

  if (!layered(it.kind)) {
    if (key && !it.files[key]) err('Its file is missing.', 'file')
    const sz = sizes[key]
    if (it.kind === 'decoration' && sz) {
      if (sz.w !== sz.h) warn(`It is ${sz.w}×${sz.h}; decorations are square, or they get squashed.`, 'file')
      else if (sz.w < 240) warn(`It is ${sz.w}×${sz.h}; at least 240×240 stays sharp on profile cards.`, 'file')
    }
    if (it.kind === 'nameplate' && sz && sz.w < sz.h * 2) warn(`It is ${sz.w}×${sz.h}; nameplates are wide strips, and the left of it fades out.`, 'file')
    return out
  }

  for (const f of Object.keys(it.files)) name_(f, false, f, `file:${f}`)
  const layers = Array.isArray(e.layers) ? (e.layers as (EffectLayer | FrameLayer)[]) : []
  if (!layers.length) err('It needs at least one layer.', 'layers')
  if (layers.length > MAX_LAYERS) err(`Items have up to ${MAX_LAYERS} layers.`, 'layers')
  const used = new Set<string>()
  layers.forEach((l, i) => {
    const at = `layer:${i}`
    const n = `Layer ${i + 1}`
    if (!l || typeof l.file !== 'string' || !l.file) { err(`${n} has no picture.`, at); return }
    used.add(l.file)
    if (!it.files[l.file]) err(`${n}'s picture ${l.file} isn't in the folder.`, at)
    if (it.kind === 'effect') {
      const fx = l as EffectLayer
      for (const k of ['start_ms', 'duration_ms', 'loop_delay_ms'] as const) if (!int(fx[k], MAX_MS)) err(`${n}: ${k} is a whole number from 0 to ${MAX_MS}.`, at)
      if (!int(fx.z_index, MAX_Z)) err(`${n}: z_index is a whole number from 0 to ${MAX_Z}.`, at)
      if (typeof fx.loop !== 'boolean') err(`${n}: loop is on or off.`, at)
      if (fx.duration_ms === 0) warn(`${n} plays for 0 ms, so it never shows.`, at)
      for (const v of fx.random_variants ?? []) { used.add(v); if (!it.files[v]) err(`${n}'s variant ${v} isn't in the folder.`, at) }
    } else {
      const fr = l as FrameLayer
      if (!['front', 'back'].includes(fr.order)) err(`${n}: order is front or back.`, at)
      if (!['staple', 'rail', 'border'].includes(fr.type)) err(`${n}: type is staple, rail or border.`, at)
      if (!['top', 'bottom', 'center'].includes(fr.anchor)) err(`${n}: anchor is top, bottom or center.`, at)
      if (fr.type === 'staple' && fr.anchor === 'center') warn(`${n}: a staple hangs from the top or bottom; center places it at the top.`, at)
    }
  })
  if (it.kind === 'frame') {
    const L = e.layout as FrameLayout | undefined
    if (!L || typeof L !== 'object') err('A frame needs its layout.', 'layout')
    else for (const k of ['inner_width', 'overflow_top', 'overflow_bottom', 'overflow_horizontal'] as const) if (!int(L[k], MAX_LAYOUT)) err(`The layout's ${k} is a whole number from 0 to ${MAX_LAYOUT}.`, 'layout')
    if (L && L.inner_width === 0) err('The layout\'s inner_width can\'t be 0.', 'layout')
  }
  const special = new Set<string>(it.kind === 'effect' ? EFFECT_SPECIAL_FILES : [])
  for (const f of Object.keys(it.files)) if (!used.has(f) && !special.has(f)) warn(`${f} is in the folder but no layer uses it.`, `file:${f}`)
  if (it.kind === 'effect' && !it.files['static.png'] && !it.files['thumbnail.png']) warn('No static.png or thumbnail.png: Parley\'s picker has nothing still to show for it.', 'still')
  return out
}

/** How many items of a kind share each key and each Parley id, so duplicate checks don't compare every pair. */
export interface WorkspaceIndex { keys: Map<string, number>; ids: Map<string, number> }
export function indexWorkspace(ws: Workspace): WorkspaceIndex {
  const keys = new Map<string, number>(), ids = new Map<string, number>()
  for (const o of ws.items) {
    const k = keyOf(o)
    if (!k) continue
    keys.set(`${o.kind}\0${k}`, (keys.get(`${o.kind}\0${k}`) ?? 0) + 1)
    const id = `${o.kind}\0${assetId(k, o.kind)}`
    ids.set(id, (ids.get(id) ?? 0) + 1)
  }
  return { keys, ids }
}

/**
 * Every item's problems. Items are immutable, so an item whose object and duplicate counts are unchanged since the
 * last run reuses its result: typing in one item re-checks that one, not the thousands around it.
 */
const memo = new WeakMap<Item, { sig: string; list: Problem[] }>()
let memoRules: Rules | null = null
export function validateWorkspace(ws: Workspace, rules: Rules = DEFAULT_RULES): Map<string, Problem[]> {
  const index = indexWorkspace(ws)
  // Other rules: nothing remembered applies.
  const fresh = memoRules !== rules
  memoRules = rules
  return new Map(ws.items.map((it) => {
    const k = keyOf(it)
    const sig = k ? `${index.keys.get(`${it.kind}\0${k}`)}/${index.ids.get(`${it.kind}\0${assetId(k, it.kind)}`)}` : ''
    const hit = memo.get(it)
    if (!fresh && hit && hit.sig === sig) return [it.uid, hit.list]
    const list = validateItem(it, ws, {}, index, rules)
    memo.set(it, { sig, list })
    return [it.uid, list]
  }))
}

const extList = (it: Item) => (it.kind === 'nameplate' ? 'png, apng, gif, webp, webm or mp4' : 'png, apng, gif or webp')
