import { assetId, EFFECT_SPECIAL_FILES, KIND_DIRS, layered, MAX_DESCRIPTION, MAX_FILE, MAX_LAYERS, MAX_LAYOUT, MAX_MS, MAX_NAME, MAX_Z, okFileName, okFolderName, type EffectLayer, type FrameLayer, type FrameLayout } from './kinds'
import { keyOf, type Item, type Workspace } from './workspace'

/**
 * What Parley would say about an item. `error`: Parley refuses it (the importer rejects it, or the server skips it
 * when it reads the folder). `warning`: it works, but probably not as meant.
 */
export interface Problem { level: 'error' | 'warning'; message: string; /** The field or layer it is about, for the editor. */ at?: string }

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`
const int = (v: unknown, max: number) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max

/** Pixel sizes of an item's pictures, when known (the editor measures them), for the checks that need them. */
export type Sizes = Record<string, { w: number; h: number }>

export function validateItem(it: Item, ws?: Workspace, sizes: Sizes = {}): Problem[] {
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

  if (!key) err(`It needs a ${field} name.`, field)
  else if (layered(it.kind) ? !okFolderName(key) : !okFileName(it.kind, key)) {
    err(layered(it.kind) ? 'Folder names are letters, digits, \'_\' and \'-\'.' : `File names are letters, digits, '.', '_' and '-', ending in ${extList(it)}.`, field)
  }
  if (ws && key) {
    const same = ws.items.filter((o) => o.kind === it.kind && o !== it)
    if (same.some((o) => keyOf(o) === key)) err(`Another ${field} in ${KIND_DIRS[it.kind]} has this name.`, field)
    else if (same.some((o) => keyOf(o) && assetId(keyOf(o), o.kind) === assetId(key, it.kind))) err(`Parley would give this the same id as another one (${assetId(key, it.kind)}), and keep only one.`, field)
  }

  for (const [f, b] of Object.entries(it.files)) {
    if (b.size > MAX_FILE) err(`${f} is ${mb(b.size)}; Parley takes files up to ${mb(MAX_FILE)}.`, `file:${f}`)
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

  for (const f of Object.keys(it.files)) if (!okFileName(it.kind, f)) err(`${f}: file names are letters, digits, '.', '_' and '-', ending in ${extList(it)}.`, `file:${f}`)
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

export function validateWorkspace(ws: Workspace): Map<string, Problem[]> {
  return new Map(ws.items.map((it) => [it.uid, validateItem(it, ws)]))
}

const extList = (it: Item) => (it.kind === 'nameplate' ? 'png, apng, gif, webp, webm or mp4' : 'png, apng, gif or webp')
