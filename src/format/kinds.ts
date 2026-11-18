/*
 * Parley's assets-folder standard: the instance's ASSETS_DIR holds a subfolder per kind of profile cosmetic, each with
 * a metadata.json (`{items: [...]}`) describing what is in it. Parley reads this layout at runtime (backend
 * routes/assets.rs and routes/asset_layers.rs), writes it from the admin console (routes/asset_admin.rs), and imports
 * whole folders laid out like it (Admin → Cosmetics → Import). The limits below are Parley's, so anything the Studio
 * lets through Parley takes as it is.
 */

export type Kind = 'decoration' | 'nameplate' | 'effect' | 'frame'
export const KINDS: Kind[] = ['decoration', 'nameplate', 'effect', 'frame']

/** Each kind's folder under the assets folder. */
export const KIND_DIRS: Record<Kind, string> = { decoration: 'avatar-decorations', nameplate: 'nameplates', effect: 'profile-effects', frame: 'profile-frames' }

export const KIND_LABELS: Record<Kind, { one: string; many: string; blurb: string }> = {
  decoration: { one: 'Avatar decoration', many: 'Avatar decorations', blurb: 'A square picture drawn around an avatar, 1.2× its size, with a see-through middle.' },
  nameplate: { one: 'Nameplate', many: 'Nameplates', blurb: 'A short loop or picture behind a member\'s name in lists, faded in from the left.' },
  effect: { one: 'Profile effect', many: 'Profile effects', blurb: 'Timed, animated layers played over the profile card.' },
  frame: { one: 'Profile frame', many: 'Profile frames', blurb: 'Pictures stapled to the card\'s top and bottom, and rails or borders along its sides.' },
}

/** Effects and frames are folders of layers; decorations and nameplates are single files. */
export const layered = (k: Kind) => k === 'effect' || k === 'frame'

/** The file types Parley serves per kind (asset_admin.rs clean_file_name). */
export const FILE_EXTS: Record<Kind, string[]> = {
  decoration: ['png', 'apng', 'gif', 'webp'],
  nameplate: ['png', 'apng', 'gif', 'webp', 'webm', 'mp4'],
  effect: ['png', 'apng', 'gif', 'webp'],
  frame: ['png', 'apng', 'gif', 'webp'],
}

/** Largest file Parley's importer sends (asset_admin.rs MAX_FILE). */
export const MAX_FILE = 8 * 1024 * 1024
export const MAX_NAME = 60
export const MAX_DESCRIPTION = 300
export const MAX_LAYERS = 32
export const MAX_MS = 600_000
export const MAX_Z = 10_000
export const MAX_LAYOUT = 4096

/** Pictures in an effect's folder Parley picks up by name: the picker's still, reduced motion's still, the thumbnail. */
export const EFFECT_SPECIAL_FILES = ['static.png', 'reduced_motion.png', 'thumbnail.png'] as const

export const extOf = (name: string) => (name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '')

/** A file name Parley writes as it is: letters, digits, '.', '_' and '-', up to 100, with an extension the kind uses. */
export function okFileName(kind: Kind, name: string) {
  return name.length > 0 && name.length <= 100 && !name.startsWith('.') && /^[A-Za-z0-9._-]+$/.test(name) && FILE_EXTS[kind].includes(extOf(name))
}
/** A layered item's folder name Parley takes. */
export const okFolderName = (name: string) => name.length > 0 && name.length <= 100 && /^[A-Za-z0-9_-]+$/.test(name)

/** The id Parley gives an item (assets.rs asset_id): the file stem or folder, lower-cased, other characters as `_`. */
export function assetId(key: string, kind: Kind) {
  const stem = layered(kind) || !key.includes('.') ? key : key.slice(0, key.lastIndexOf('.'))
  return [...stem.trim().toLowerCase()].map((c) => (/[a-z0-9_-]/.test(c) ? c : '_')).slice(0, 64).join('')
}

/** "a_hint_of_clove" → "A Hint Of Clove" (assets.rs display_name): the name Parley shows when an entry has none. */
export const displayName = (stem: string) => stem.split(/[_\- ]/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ')

// --- names: what Parley's Import takes, and what an assets folder on disk takes ----------------------------------------

/*
 * Parley serves whatever is in its assets folder, so a file copied in can be named almost anything. Its Import is
 * stricter (asset_admin.rs clean_file_name): letters, digits, '.', '_' and '-' only, files up to 8 MB. The Studio
 * checks against the rules below: characters you allow are warnings (Import would refuse them), unless you say you
 * use Import, when they are errors again.
 */
export interface Rules {
  /** Characters allowed in names beyond letters, digits, '.', '_' and '-'. */
  extraChars: string
  /** Checking for Parley's Import: what it refuses is an error, not a warning. */
  strictImport: boolean
  /** Files bigger than this (MB) get a warning. */
  maxFileMB: number
}
/** The extra characters Parley's own assets folder uses in names. */
export const DEFAULT_EXTRA_CHARS = " !&'(),"
export const DEFAULT_RULES: Rules = { extraChars: DEFAULT_EXTRA_CHARS, strictImport: false, maxFileMB: 8 }
/** Never allowed: they break paths, or some systems refuse them in file names. */
export const BANNED_CHARS = '/\\:*?"<>|'
const BASE_FILE = /[A-Za-z0-9._-]/, BASE_FOLDER = /[A-Za-z0-9_-]/
// eslint-disable-next-line no-control-regex
const control = (c: string) => /[\u0000-\u001f\u007f]/.test(c)

/** The extra characters a rule allows, cleaned: each once, none banned, none already allowed. */
export const cleanExtras = (s: string) => [...new Set(s)].filter((c) => !BASE_FILE.test(c) && !BANNED_CHARS.includes(c) && !control(c)).join('')

/** How a file or folder name fares: fine everywhere, fine on disk but refused by Import, or not usable. */
export interface NameVerdict { level: 'ok' | 'import' | 'bad'; chars: string[]; reason?: string }
export function checkName(name: string, folder: boolean, rules: Rules = DEFAULT_RULES): NameVerdict {
  if (!name) return { level: 'bad', chars: [], reason: 'empty' }
  if (name.length > 100) return { level: 'bad', chars: [], reason: 'longer than 100 characters' }
  if (name.startsWith('.')) return { level: 'bad', chars: ['.'], reason: 'starts with a dot' }
  if (name !== name.trim()) return { level: 'bad', chars: [' '], reason: 'starts or ends with a space' }
  const odd = [...new Set([...name].filter((c) => !(folder ? BASE_FOLDER : BASE_FILE).test(c)))]
  if (!odd.length) return { level: 'ok', chars: [] }
  const allowed = cleanExtras(rules.extraChars)
  const bad = odd.filter((c) => !allowed.includes(c) || BANNED_CHARS.includes(c) || control(c))
  return bad.length ? { level: 'bad', chars: bad } : { level: 'import', chars: odd }
}

/** A file name made safe, keeping its extension: characters the rules don't allow become '_'. Strict by default. */
export function safeFileName(name: string, extra = '') {
  const ok = cleanExtras(extra)
  const ext = extOf(name)
  const raw = ext ? name.slice(0, -(ext.length + 1)) : name
  const stem = [...raw].map((c) => (BASE_FILE.test(c) || ok.includes(c) ? c : '\0')).join('').replace(/\0+/g, '_').trim().replace(/^[._]+/, '').slice(0, 90) || 'file'
  return ext ? `${stem}.${ext}` : stem
}
export const safeFolderName = (name: string, extra = '') => {
  const ok = cleanExtras(extra)
  return [...name].map((c) => (BASE_FOLDER.test(c) || ok.includes(c) ? c : '\0')).join('').replace(/\0+/g, '_').trim().replace(/^[_.]+|_+$/g, '').slice(0, 100) || 'item'
}

export const isVideo = (name: string) => ['webm', 'mp4'].includes(extOf(name))
export function mimeOf(name: string) {
  const ext = extOf(name)
  return ({ png: 'image/png', apng: 'image/png', gif: 'image/gif', webp: 'image/webp', webm: 'video/webm', mp4: 'video/mp4', json: 'application/json' } as Record<string, string>)[ext] ?? 'application/octet-stream'
}

// --- the entries in metadata.json ----------------------------------------------------------------------------------

export interface EffectLayer { file: string; start_ms: number; duration_ms: number; loop: boolean; loop_delay_ms: number; z_index: number; random_variants?: string[] }
export type FrameOrder = 'front' | 'back'
export type FrameType = 'staple' | 'rail' | 'border'
export type FrameAnchor = 'top' | 'bottom' | 'center'
export interface FrameLayer { file: string; order: FrameOrder; type: FrameType; anchor: FrameAnchor; responsive?: boolean }
export interface FrameLayout { inner_width: number; overflow_top: number; overflow_bottom: number; overflow_horizontal: number }

/** Parley's admin console starts a new frame with Discord's 4x card layout. */
export const DEFAULT_LAYOUT: FrameLayout = { inner_width: 1200, overflow_top: 304, overflow_bottom: 212, overflow_horizontal: 56 }
export const newEffectLayer = (file: string, z = 100): EffectLayer => ({ file, start_ms: 0, duration_ms: 3000, loop: true, loop_delay_ms: 0, z_index: z })
export const newFrameLayer = (file: string): FrameLayer => {
  // Discord's file names say where a layer goes (front_staple_top.png): read them when they do.
  const w = file.toLowerCase()
  const order: FrameOrder = w.includes('back') ? 'back' : 'front'
  const type: FrameType = w.includes('rail') ? 'rail' : w.includes('border') ? 'border' : 'staple'
  const anchor: FrameAnchor = w.includes('bottom') ? 'bottom' : w.includes('center') || w.includes('centre') ? 'center' : 'top'
  return { file, order, type, anchor, responsive: false }
}
