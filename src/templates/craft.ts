import type { Box } from './raster'
import type { ArtGroup, Shape, TemplateKind } from './spec'

/*
 * Native files for the ArtCraft apps, from samples their own apps saved:
 *
 * - VectorCraft `.vctemplate` (format "vectorcraft" v4, document v3): the same JSON as a `.vectorcraft`, with
 *   `"template": true`, so it opens as a new untitled document. Units are pixels (1 px = 1 unit), y down. Layers are
 *   listed bottom to top; ids are one counter shared by artboards, layers, objects and guides. Template layers are
 *   locked, dimmed and left out of export, which is what guides want.
 * - EffectCraft `.ecproj` (schema 2): a project with one comp, times in ticks (254,016,000,000 per second), and
 *   placeholder layers for the artwork, switched off so they don't render until you put art in them.
 */

// --- VectorCraft ----------------------------------------------------------------------------------------------------

/** '#rrggbbaa' as VectorCraft's 0–1 RGB (it has no alpha on a paint; guides are strokes, so none is needed). */
const rgb = (hex: string) => ({ model: 'rgb', r: parseInt(hex.slice(1, 3), 16) / 255, g: parseInt(hex.slice(3, 5), 16) / 255, b: parseInt(hex.slice(5, 7), 16) / 255 })
const round = (n: number) => Math.round(n * 100) / 100

/** A shape as the corner points of a closed path; round corners and circles as short straight runs. */
function outline(s: Shape, ox: number, oy: number): [number, number][] | null {
  if (s.t === 'circle') return Array.from({ length: 64 }, (_, i) => { const a = (i / 64) * Math.PI * 2; return [round(s.cx - ox + Math.cos(a) * s.r), round(s.cy - oy + Math.sin(a) * s.r)] })
  if (s.t !== 'rect') return null
  const x = s.x - ox, y = s.y - oy, r = Math.min(s.r ?? 0, s.w / 2, s.h / 2)
  if (!r) return [[x, y], [x + s.w, y], [x + s.w, y + s.h], [x, y + s.h]].map(([a, b]) => [round(a), round(b)])
  const pts: [number, number][] = []
  const corner = (cx: number, cy: number, from: number) => { for (let i = 0; i <= 6; i++) { const a = from + (i / 6) * (Math.PI / 2); pts.push([round(cx + Math.cos(a) * r), round(cy + Math.sin(a) * r)]) } }
  corner(x + s.w - r, y + r, -Math.PI / 2)
  corner(x + s.w - r, y + s.h - r, 0)
  corner(x + r, y + s.h - r, Math.PI / 2)
  corner(x + r, y + r, Math.PI)
  return pts
}

/**
 * A VectorCraft template: one artboard per file Parley expects (a frame's pieces each get theirs, placed where they
 * sit around the card), an empty layer per Parley file, and each guide as a template layer on top, plus ruler guides.
 */
export function toVectorCraft(t: TemplateKind, view: Box = { x: 0, y: 0, w: t.width, h: t.height }, art: ArtGroup[] = t.art, template = true): string {
  let id = 0
  const next = () => ++id
  const inView = (s: { x: number; y: number; w: number; h: number }) => s.x >= view.x && s.y >= view.y && s.x + s.w <= view.x + view.w && s.y + s.h <= view.y + view.h
  const slots = t.slots.length > 1 ? t.slots.filter(inView) : []
  const artboards = (slots.length ? slots : [{ id: t.kind, x: view.x, y: view.y, w: view.w, h: view.h }]).map((s) => ({
    id: next(), name: s.id, rect: { x0: s.x - view.x, y0: s.y - view.y, x1: s.x - view.x + s.w, y1: s.y - view.y + s.h },
  }))
  // Bottom to top, as the spec lists them (the PSD's order): back before front, then the guides over everything.
  const artLayers = art.flatMap((g) => g.layers).map((name, i) => ({ id: next(), name, kind: { type: 'layer', color: { Preset: (i % 8) + 1 }, children: [] } }))
  const guideLayers = t.guides.map((g) => {
    const lid = next()
    const children = g.shapes.flatMap((s) => {
      if (s.t === 'text') return []
      const pts = outline(s, view.x, view.y)
      const color = s.stroke ?? s.fill
      if (!pts || !color) return []
      return [{
        id: next(), name: s.t === 'circle' ? 'circle' : 'rect',
        appearance: { items: [{ kind: 'fill', paint: { type: 'none' } }, { kind: 'stroke', paint: { type: 'solid', color: rgb(color) }, width: Math.max(1, s.width ?? 2) }] },
        kind: { type: 'path', path: { subpaths: [{ anchors: pts.map((p) => ({ p })), closed: true }] } },
      }]
    })
    return { id: lid, name: `GUIDE · ${g.name}`, locked: true, kind: { type: 'layer', color: { Preset: 0 }, template: true, children } }
  })
  const top = guideLayers[guideLayers.length - 1]?.id ?? artLayers[artLayers.length - 1]?.id
  const guides = [
    ...t.rulers.h.filter((y) => y >= view.y && y <= view.y + view.h).map((y) => ({ vertical: false, pos: round(y - view.y), layer: top, id: next() })),
    ...t.rulers.v.filter((x) => x >= view.x && x <= view.x + view.w).map((x) => ({ vertical: true, pos: round(x - view.x), layer: top, id: next() })),
  ]
  const doc = {
    format: 'vectorcraft', version: 4,
    document: {
      version: 3, title: `Parley ${t.title}`, ...(template ? { template: true } : {}), units: 'Pixels', color_mode: 'Rgb',
      artboards, layers: [...artLayers, ...guideLayers], guides, next_id: id + 1,
    },
  }
  return `${JSON.stringify(doc)}\n`
}

// --- EffectCraft ----------------------------------------------------------------------------------------------------

const TICKS = 254_016_000_000
const ticks = (ms: number) => Math.round((ms / 1000) * TICKS)

type Json = Record<string, unknown>
const prop = (uid: number, match: string, name: string, value: Json, ui: Json, flags: Json = {}): Json =>
  ({ node: 'Prop', uid, match, name, value, ui, spatial: false, hold_only: false, three_d_only: false, two_d_only: false, shown_dims: 0, static_only: false, ...flags })

/** What a layer's own property tree holds in a fresh EffectCraft layer (masks, effects, transform, material). */
function layerProps(next: () => number, name: string, w: number, h: number): Json {
  const group = (match: string, gname: string, children: Json[]) => ({ node: 'Group', uid: next(), match, name: gname, kind: { kind: 'Plain' }, enabled: true, children })
  const self = next()
  const masks = group('masks', 'Masks', [])
  const effects = group('effects', 'Effects', [])
  const t = [
    prop(next(), 'anchor', 'Anchor Point', { t: 'Vec3', v: [w / 2, h / 2, 0] }, { kind: 'Point' }, { spatial: true, shown_dims: 2 }),
    prop(next(), 'position', 'Position', { t: 'Vec3', v: [w / 2, h / 2, 0] }, { kind: 'Point' }, { spatial: true, shown_dims: 2 }),
    prop(next(), 'scale', 'Scale', { t: 'Vec3', v: [100, 100, 100] }, { kind: 'Percent' }, { shown_dims: 2 }),
    prop(next(), 'orientation', 'Orientation', { t: 'Vec3', v: [0, 0, 0] }, { kind: 'Angle' }, { three_d_only: true }),
    prop(next(), 'rotationX', 'X Rotation', { t: 'Scalar', v: 0 }, { kind: 'Angle' }, { three_d_only: true }),
    prop(next(), 'rotationY', 'Y Rotation', { t: 'Scalar', v: 0 }, { kind: 'Angle' }, { three_d_only: true }),
    prop(next(), 'rotation', 'Rotation', { t: 'Scalar', v: 0 }, { kind: 'Angle' }),
    prop(next(), 'opacity', 'Opacity', { t: 'Scalar', v: 100 }, { kind: 'Slider', min: 0, max: 100, slider_min: 0, slider_max: 100, decimals: 0 }),
  ]
  const transform = group('transform', 'Transform', t)
  const popup = { kind: 'Popup', options: ['Off', 'On', 'Only'] }
  const material = group('materialOptions', 'Material Options', [
    prop(next(), 'castsShadows', 'Casts Shadows', { t: 'Enum', v: 0 }, popup, { hold_only: true }),
    prop(next(), 'lightTransmission', 'Light Transmission', { t: 'Scalar', v: 0 }, { kind: 'Percent' }),
    prop(next(), 'acceptsShadows', 'Accepts Shadows', { t: 'Enum', v: 1 }, popup, { hold_only: true }),
    prop(next(), 'acceptsLights', 'Accepts Lights', { t: 'Bool', v: true }, { kind: 'Checkbox' }, { hold_only: true }),
    prop(next(), 'ambient', 'Ambient', { t: 'Scalar', v: 100 }, { kind: 'Percent' }),
    prop(next(), 'diffuse', 'Diffuse', { t: 'Scalar', v: 50 }, { kind: 'Percent' }),
    prop(next(), 'specularIntensity', 'Specular Intensity', { t: 'Scalar', v: 50 }, { kind: 'Percent' }),
    prop(next(), 'specularShininess', 'Specular Shininess', { t: 'Scalar', v: 5 }, { kind: 'Percent' }),
    prop(next(), 'metal', 'Metal', { t: 'Scalar', v: 100 }, { kind: 'Percent' }),
  ])
  return { uid: self, match: 'layer', name, kind: { kind: 'Plain' }, enabled: true, children: [masks, effects, transform, material] }
}

/** The artwork placeholders for a kind, with their timing: an effect's example layers, else one layer for the whole comp. */
function placeholders(t: TemplateKind, duration: number): { name: string; start: number; end: number }[] {
  const ex = (t.motion.example_layers ?? []) as { file?: string; start_ms?: number; duration_ms?: number; loop?: boolean; z_index?: number }[]
  if (t.kind === 'effect' && ex.length) {
    return [...ex].sort((a, b) => (b.z_index ?? 0) - (a.z_index ?? 0)).map((l) => ({
      name: String(l.file ?? 'layer').replace(/\.png$/, ''),
      start: l.start_ms ?? 0,
      end: l.loop ? duration : Math.min(duration, (l.start_ms ?? 0) + (l.duration_ms ?? duration)),
    }))
  }
  return [{ name: t.kind === 'nameplate' ? 'nameplate' : t.kind, start: 0, end: duration }]
}

/** EffectCraft can't make a frame (stills around the card): those are drawn in VectorCraft or PhotoCraft. */
export const effectCraftKinds = (t: TemplateKind) => t.kind !== 'frame'

/** The project as an object, and its placeholder layers (for a template's controls). */
function effectCraftProject(t: TemplateKind) {
  const durationMs = Math.max(t.motion.typical_duration_ms[1], ...((t.motion.example_layers ?? []) as { start_ms?: number; duration_ms?: number }[]).map((l) => (l.start_ms ?? 0) + (l.duration_ms ?? 0)))
  const duration = ticks(durationMs)
  let id = 2
  const next = () => ++id
  const places = placeholders(t, durationMs)
  const solids: Record<string, Json> = {}
  const palette: [number, number, number][] = [[1, 0.24, 0.55], [0.22, 0.84, 1], [1, 0.85, 0.29], [0.24, 0.81, 0.49], [0.65, 0.55, 0.98]]
  const layers = places.map((p, i) => {
    const solid = next()
    solids[solid] = { id: solid, name: p.name, label: 'Red', comment: '', parent: 2, kind: { type: 'Solid', color: palette[i % palette.length], width: t.width, height: t.height, pixel_aspect: 1 } }
    const lid = next()
    return {
      id: lid, name: p.name, source: { type: 'Solid', item: solid }, label: 'Red', comment: '', start_time: 0, in_point: ticks(p.start), out_point: ticks(p.end), stretch: 100,
      // Off until you replace it with art: a solid would cover everything when rendered.
      switches: { video: false, audio: true, solo: false, locked: false, shy: false, collapse: false, quality: 'Best', sampling: 'Bilinear', effects: true, frame_blend: 'Off', motion_blur: false, adjustment: false, three_d: false, guide: false },
      blend_mode: 'Normal', preserve_transparency: false, track_matte: null, parent: null, markers: [], auto_orient: 'Off',
      props: layerProps(next, p.name, t.width, t.height),
    }
  })
  const light = (match: string, name: string, v: number) => ({ uid: 0, match, name, value: { t: 'Scalar', v }, ui: { kind: 'Angle' }, spatial: false, hold_only: false, three_d_only: false, two_d_only: false, shown_dims: 0, static_only: false })
  const project = {
    savedBy: '0.24.1', activeComp: 1, openComps: [1], schema: 2,
    settings: { bit_depth: 'Bpc8', linearize: false, working_space: null, blend_linear: false, time_display: 'Timecode', frame_start: 0, audio_sample_rate: 48000, gpu_acceleration: true, color_engine: 'Adobe', hdr: 'Clip', output_space: null, working_gamma: 2.2 },
    items: {
      1: {
        id: 1, name: `Parley ${t.title}`, label: 'Sandstone', comment: '', parent: null,
        kind: {
          type: 'Comp', width: t.width, height: t.height, pixel_aspect: 1, frame_rate: { num: t.motion.fps, den: 1 }, duration, display_start: 0, background: [0, 0, 0], work_area: [0, duration],
          layers, markers: [], shutter_angle: 180, shutter_phase: -90, motion_blur_samples: 16, motion_blur_adaptive_limit: 128, renderer: 'Classic3D', hide_shy: false, enable_motion_blur: true, enable_frame_blending: true, draft_3d: false, preserve_frame_rate: false, preserve_resolution: false, poster_time: 0,
          global_light: { angle: light('globalLightAngle', 'Global Light Angle', 120), altitude: light('globalLightAltitude', 'Global Light Altitude', 30) },
          guides: [...t.rulers.h.map((y) => ({ vertical: false, position: y })), ...t.rulers.v.map((x) => ({ vertical: true, position: x }))],
        },
      },
      2: { id: 2, name: 'Placeholders', label: 'Yellow', comment: '', parent: null, kind: { type: 'Folder' } },
      ...solids,
    },
    next_id: id + 1,
  }
  return { project, durationMs, layers }
}

/**
 * An EffectCraft project: one comp at the kind's size and frame rate, long enough for a typical one, with comp guides
 * from the rulers and a hidden placeholder layer per file (the first in the list is the top layer, as EffectCraft
 * reads it).
 */
export const toEffectCraft = (t: TemplateKind) => `${JSON.stringify(effectCraftProject(t).project)}\n`

/** A prop's uid by its match name, anywhere in a layer's property tree. */
function uidOf(node: Json, match: string): number | undefined {
  if (node.match === match && typeof node.uid === 'number') return node.uid
  for (const c of (node.children as Json[] | undefined) ?? []) { const u = uidOf(c, match); if (u !== undefined) return u }
  return undefined
}

/**
 * An EffectCraft template (`.ectemplate`): a zip, stored, of manifest.json, project.ecproj and poster.png, as
 * EffectCraft's Essential Graphics export writes it. It needs at least one control, so each placeholder's opacity
 * is one.
 */
export function effectCraftTemplateFiles(t: TemplateKind, poster: ArrayBuffer): { path: string; data: BlobPart; type: string }[] {
  const { project, durationMs, layers } = effectCraftProject(t)
  // Each control gets its own id from the shared counter; EffectCraft loads them from the comp's `essential` block
  // (the manifest's copy only describes them).
  let next = project.next_id
  const controls = layers.map((l) => ({ id: next++, layer: l.id, name: `${l.name} opacity`, layerName: l.name, prop: uidOf(l.props as Json, 'opacity')! }))
  const compName = `Parley ${t.title}`
  const comp = project.items[1].kind as Json
  comp.essential = { name: compName, controls: controls.map((c) => ({ id: c.id, name: c.name, kind: { type: 'Property', layer: c.layer, prop: c.prop } })) }
  project.next_id = next
  const { savedBy: _s, activeComp: _a, openComps: _o, ...inner } = project
  const manifest = {
    comp: 1, compName,
    controls: controls.map((c) => ({ group: null, id: c.id, kind: 'property', layer: c.layer, layerName: c.layerName, links: [], mirrors: [], missing: false, name: c.name, path: 'transform/opacity', prop: c.prop, type: 'slider', value: 100 })),
    duration: durationMs / 1000, format: 'effectcraft-template', frameRate: t.motion.fps,
    generator: 'Profile Studio', height: t.height, media: [], name: compName, poster: 'poster.png', version: 1, width: t.width,
  }
  return [
    { path: 'manifest.json', data: JSON.stringify(manifest), type: 'application/json' },
    { path: 'project.ecproj', data: JSON.stringify(inner), type: 'application/json' },
    { path: 'poster.png', data: poster, type: 'image/png' },
  ]
}

// --- AniCraft -------------------------------------------------------------------------------------------------------

const f = (n: number) => Math.round(n * 1000) / 1000
/** '#rrggbbaa' as AniCraft's 0–1 RGBA. */
const rgba = (hex: string) => ({ r: f(parseInt(hex.slice(1, 3), 16) / 255), g: f(parseInt(hex.slice(3, 5), 16) / 255), b: f(parseInt(hex.slice(5, 7), 16) / 255), a: f(hex.length >= 9 ? parseInt(hex.slice(7, 9), 16) / 255 : 1) })

/** A shape as an SVG path centred on its own middle, and where that middle is: how AniCraft stores shapes. */
function aniShape(s: Shape, ox: number, oy: number): { path: string; tx: number; ty: number } | null {
  if (s.t === 'circle') {
    const r = s.r, k = r * 0.5522847498
    return { tx: f(s.cx - ox), ty: f(s.cy - oy), path: `M${f(r)} 0C${f(r)} ${f(k)} ${f(k)} ${f(r)} 0 ${f(r)}C${f(-k)} ${f(r)} ${f(-r)} ${f(k)} ${f(-r)} 0C${f(-r)} ${f(-k)} ${f(-k)} ${f(-r)} 0 ${f(-r)}C${f(k)} ${f(-r)} ${f(r)} ${f(-k)} ${f(r)} 0Z` }
  }
  if (s.t !== 'rect') return null
  const pts = outline({ ...s, x: -s.w / 2, y: -s.h / 2 }, 0, 0)!
  return { tx: f(s.x + s.w / 2 - ox), ty: f(s.y + s.h / 2 - oy), path: `M${pts.map(([x, y]) => `${f(x)} ${f(y)}`).join('L')}Z` }
}

/** AniCraft draws vector art frame by frame; frames are stills, so it makes the animated kinds. */
export const aniCraftKinds = (t: TemplateKind) => t.kind !== 'frame'

/**
 * An AniCraft document: the stage at the kind's size and frame rate with a see-through background, one guide layer
 * per guide (locked; guide layers aren't exported), then a layer per Parley file, each a blank keyframe as long as a
 * typical one. Layers are listed top first.
 */
export function toAniCraft(t: TemplateKind): string {
  let id = 0
  const next = () => ++id
  const paths: string[] = []
  const frames = Math.max(1, Math.round((t.motion.typical_duration_ms[1] / 1000) * t.motion.fps))
  const clear = { r: 0, g: 0, b: 0, a: 0 }
  const guideLayers = [...t.guides].reverse().map((g) => {
    const lid = next()
    const elements = g.shapes.flatMap((s) => {
      if (s.t === 'text') return []
      const shape = aniShape(s, 0, 0)
      const color = s.stroke ?? s.fill
      if (!shape || !color) return []
      paths.push(shape.path)
      return [{
        id: next(), name: '', transform: { m: [1, 0, 0, 1, shape.tx, shape.ty] },
        color: { alpha: 1, tint: { r: 1, g: 1, b: 1, a: 1 }, tint_amount: 0 },
        kind: { Shape: { path: paths.length - 1, fill: { Solid: clear }, stroke: { color: rgba(color), width: Math.max(1, s.width ?? 2) }, fill_rule: 'NonZero' } },
      }]
    })
    return { id: lid, name: `GUIDE · ${g.name}`, kind: 'Guide', visible: true, locked: true, outline: false, color: rgba('#ff3d8bff'), keyframes: [{ start: 0, duration: frames, elements, tween: null, label: '' }] }
  })
  // The spec lists artwork bottom first; AniCraft lists top first.
  const artLayers = t.art.flatMap((g) => g.layers).reverse().map((name) => ({
    id: next(), name, kind: 'Normal', visible: true, locked: false, outline: false, color: rgba('#4fa3ffff'),
    keyframes: [{ start: 0, duration: frames, elements: [], tween: null, label: '' }],
  }))
  const doc = {
    format: 'anicraft', version: 3, generator: 'Profile Studio', paths,
    document: {
      stage: { width: t.width, height: t.height, fps: t.motion.fps, background: clear },
      scenes: [{ name: `Parley ${t.title}`, timeline: { layers: [...guideLayers, ...artLayers] } }],
      library: [], next_id: id + 1,
    },
  }
  return `${JSON.stringify(doc)}\n`
}
