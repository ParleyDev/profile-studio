import type { Kind } from '../format/kinds'

/*
 * Where things land on each kind's canvas, measured from how Parley draws them (frontend/src/components) and from
 * the files in Parley's own assets folder. Every template format (PSD, SVG, PNG overlay, motion spec) is drawn from
 * these numbers, so they all agree.
 *
 * The card: Parley's profile card in the DM panel is PANEL_CARD_WIDTH = 304 px wide (ProfileFrame.tsx), with
 * `rounded-2xl` (16 px) corners, a 105 px banner, and an 80 px avatar pulled up 44 px over the banner's edge, 16 px in
 * from the left, with a 6 px ring (ProfileCard.tsx: `h-[105px]`, `-mt-11`, `px-4`, `ring-[6px]`, avatar 80). The name
 * follows 12 px below the avatar (`pt-3`).
 */

export type Shape =
  | { t: 'rect'; x: number; y: number; w: number; h: number; r?: number; fill?: string; stroke?: string; width?: number; dash?: boolean }
  | { t: 'circle'; cx: number; cy: number; r: number; fill?: string; stroke?: string; width?: number; dash?: boolean }
  | { t: 'text'; x: number; y: number; text: string; size: number; color: string; anchor?: 'start' | 'middle' | 'end' }

/** One guide: its own layer in the PSD and SVG, named so the layer list explains it. */
export interface Guide { id: string; name: string; note: string; shapes: Shape[] }

/** A file Parley expects, cut from the canvas at this rectangle (frames: each piece is its own file size). */
export interface Slot { id: string; title: string; x: number; y: number; w: number; h: number; files: string[]; note: string }

export interface ArtGroup { name: string; layers: string[] }

export interface MotionSpec {
  fps: number
  frame_ms: number
  typical_duration_ms: [number, number]
  formats: string[]
  notes: string[]
  /** Effects: the layer fields Parley plays them by, with an example. */
  layer_fields?: Record<string, string>
  example_layers?: Record<string, unknown>[]
  ffmpeg?: Record<string, string>
}

export interface TemplateKind {
  kind: Kind
  title: string
  /** The canvas, in the file's own pixels. */
  width: number
  height: number
  /** Other sizes Parley's files come in. */
  also: string[]
  guides: Guide[]
  art: ArtGroup[]
  slots: Slot[]
  /** Photoshop ruler guides: horizontal lines at these y, vertical at these x. */
  rulers: { h: number[]; v: number[] }
  howTo: string[]
  motion: MotionSpec
  /** Where the numbers come from, in Parley. */
  sources: string[]
}

// Colours, as #rrggbbaa: one per kind of thing, the same in every template.
const C = {
  edge: '#ffffffcc',
  avatar: '#ff3d8bff', avatarFill: '#ff3d8b2e',
  ring: '#ff9ec4cc',
  banner: '#38d6ffcc', bannerFill: '#38d6ff1f',
  text: '#ffd84acc', textFill: '#ffd84a24',
  out: '#ff8a3dcc', outFill: '#ff8a3d24',
  safe: '#3ccf7dcc',
  slot: '#a78bfaff',
  label: '#ffffffe6',
}

// --- avatar decorations -------------------------------------------------------------------------------------------

function decoration(): TemplateKind {
  const W = 288, A = W / 1.2, o = (W - A) / 2, c = W / 2
  // The status dot on a profile card: 0.32 of the avatar, 1 px past its bottom-right corner (Avatar.tsx `dot`,
  // `right: -1, bottom: -1`), with a 3 px ring, measured at the 80 px card avatar and scaled to this canvas.
  const k = A / 80, dot = 80 * 0.32 * k, ring = 3 * k
  const dx = o + A + 1 * k - dot / 2
  return {
    kind: 'decoration',
    title: 'Avatar decoration',
    width: W, height: W,
    also: ['576×576 (2×), drawn the same way', 'any square: Parley scales it to 1.2× the avatar'],
    guides: [
      { id: 'edge', name: 'Canvas = 1.2× the avatar', note: 'The whole picture. Parley draws it 120% of the avatar\'s size, centred on it.', shapes: [{ t: 'rect', x: 0.5, y: 0.5, w: W - 1, h: W - 1, stroke: C.edge, width: 1, dash: true }] },
      { id: 'avatar', name: `Avatar (${A} px circle) – keep see-through`, note: 'The member\'s picture shows through here. Keep it transparent, or only let art overlap its edge.', shapes: [{ t: 'circle', cx: c, cy: c, r: A / 2, fill: C.avatarFill, stroke: C.avatar, width: 2 }, { t: 'text', x: c, y: c + 4, text: 'avatar', size: 13, color: C.label, anchor: 'middle' }] },
      { id: 'band', name: `Decoration band (${o} px around the avatar)`, note: 'Between the avatar\'s edge and the canvas edge: where most decorations sit.', shapes: [{ t: 'circle', cx: c, cy: c, r: W / 2 - 0.5, stroke: C.safe, width: 1, dash: true }] },
      { id: 'status', name: 'Status dot – covers this on cards', note: 'On profile cards and the member list the online/away dot sits here, over the decoration.', shapes: [{ t: 'circle', cx: dx, cy: dx, r: dot / 2 + ring, fill: C.outFill, stroke: C.out, width: 1.5 }] },
      { id: 'centre', name: 'Centre', note: 'The middle of the avatar.', shapes: [{ t: 'rect', x: c - 6, y: c - 0.5, w: 12, h: 1, fill: C.edge }, { t: 'rect', x: c - 0.5, y: c - 6, w: 1, h: 12, fill: C.edge }] },
    ],
    art: [{ name: 'Artwork', layers: ['decoration'] }],
    rulers: { h: [o, c, o + A], v: [o, c, o + A] },
    slots: [{ id: 'decoration', title: 'The decoration', x: 0, y: 0, w: W, h: W, files: ['<name>.png'], note: 'One square picture: PNG, animated PNG, GIF or WebP.' }],
    howTo: [
      'Draw around the pink avatar circle and keep its middle transparent.',
      'Export the whole canvas as one PNG (or animated PNG) named after the decoration, e.g. `starlight_halo.png`. The file name is its id in Parley.',
      'Square only: anything else gets squashed. 288×288 matches Discord\'s; 576×576 stays sharp on big screens.',
    ],
    motion: {
      fps: 12, frame_ms: 83, typical_duration_ms: [3000, 5000],
      formats: ['Animated PNG (APNG), looping forever', 'PNG (still)', 'GIF or animated WebP'],
      notes: ['Parley shows the first frame in lists and plays it on hover, on profile cards, and in previews; reduced motion keeps it still. Make the first frame a good still.', 'Discord\'s decorations are 60 frames at 83 ms (5 s).'],
      ffmpeg: { apng_from_frames: 'ffmpeg -framerate 12 -i frame_%04d.png -plays 0 -f apng decoration.png' },
    },
    sources: ['frontend/src/components/Avatar.tsx: decoration `width/height 120%, left/top -10%`; status dot `size * 0.32`, `right/bottom -1`, `ring-[3px]`', 'media/avatar-decorations: 908 of 938 files are 288×288, 60 frames × 83 ms'],
  }
}

// --- nameplates ---------------------------------------------------------------------------------------------------

function nameplate(): TemplateKind {
  const W = 448, H = 84
  // A member-list row: `px-2 py-1.5`, a 32 px avatar, `gap-3`, then the name (text-sm) over a status line (text-xs):
  // 44 px tall. The plate is scaled to the row's height and pinned to its right (`inset-y-0 right-0 h-full w-auto`).
  const row = 44, k = H / row, rowW = 240, plateW = W / k, left = rowW - plateW
  const x = (v: number) => (v - left) * k
  const fade = W * 0.35
  return {
    kind: 'nameplate',
    title: 'Nameplate',
    width: W, height: H,
    also: ['672×126 (1.5×)', 'any wide strip about 5.3:1: Parley fits it to the row\'s height'],
    guides: [
      { id: 'edge', name: 'Canvas = one row, 44 px tall', note: 'Parley scales the strip to the row\'s height and pins it to the row\'s right edge.', shapes: [{ t: 'rect', x: 0.5, y: 0.5, w: W - 1, h: H - 1, stroke: C.edge, width: 1, dash: true }] },
      { id: 'fade', name: 'Fade-in (left 35%)', note: 'Parley fades the strip in from transparent across its left 35%, so art here only half shows.', shapes: [{ t: 'rect', x: 0, y: 0, w: fade, h: H, fill: C.outFill }, { t: 'rect', x: fade - 0.5, y: 0, w: 1, h: H, fill: C.out }, { t: 'text', x: 6, y: H - 6, text: 'fades in', size: 10, color: C.label }] },
      { id: 'avatar', name: 'Avatar (in a 240 px row)', note: 'The member\'s avatar covers this in a 240 px member-list row. Wider rows push it further left.', shapes: [{ t: 'circle', cx: x(24), cy: 22 * k, r: 16 * k, fill: C.avatarFill, stroke: C.avatar, width: 1.5 }] },
      { id: 'name', name: 'Name and status text', note: 'The name and status line sit here; keep it calm enough to read white text over it.', shapes: [{ t: 'rect', x: x(52), y: 6 * k, w: x(232) - x(52), h: 17.5 * k, fill: C.textFill, stroke: C.text, width: 1 }, { t: 'rect', x: x(52), y: 23.5 * k, w: (x(232) - x(52)) * 0.6, h: 15 * k, fill: C.textFill, stroke: C.text, width: 1 }, { t: 'text', x: x(56), y: 18 * k, text: 'Name', size: 13, color: C.label }] },
    ],
    art: [{ name: 'Artwork', layers: ['nameplate'] }],
    rulers: { h: [], v: [fade, x(52)] },
    slots: [{ id: 'nameplate', title: 'The nameplate', x: 0, y: 0, w: W, h: H, files: ['<name>.webm'], note: 'A short loop (WebM with transparency) or a picture.' }],
    howTo: [
      'Put the eye-catching part on the right: the left fades out and the name covers the middle.',
      'Export a looping WebM (VP9 with alpha) named after the nameplate, e.g. `aurora.webm`, or a PNG, APNG, GIF or WebP. MP4 has no transparency.',
      'Parley plays it at 75% opacity while the row is hovered (and in your own panel), and shows its first frame otherwise.',
    ],
    motion: {
      fps: 12, frame_ms: 83, typical_duration_ms: [3000, 5000],
      formats: ['WebM, VP9 with alpha (yuva420p), looping', 'PNG, APNG, GIF or WebP', 'MP4 (H.264, no transparency)'],
      notes: ['Discord\'s are 448×84 VP9 at 12 fps, 3–5 s long.', 'Phones get an animated WebP Parley makes from the video.', 'Keep it seamless: the last frame should flow into the first.'],
      ffmpeg: {
        webm_from_frames: 'ffmpeg -framerate 12 -i frame_%04d.png -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 0 -crf 30 -an nameplate.webm',
        webm_from_prores4444: 'ffmpeg -i nameplate.mov -vf scale=448:84,fps=12 -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 0 -crf 30 -an nameplate.webm',
      },
    },
    sources: ['frontend/src/components/Nameplate.tsx: `absolute inset-y-0 right-0 h-full w-auto`', 'frontend/src/index.css: `.np-fit` mask `linear-gradient(90deg, transparent, #000 35%)`, `.np-video { opacity: .75 }`', 'frontend/src/components/MemberList.tsx: row `px-2 py-1.5`, avatar 32, `gap-3`', 'media/nameplates: 448×84 VP9, 12 fps (24997/2083), 3–5 s'],
  }
}

// --- the profile card, drawn at a scale ---------------------------------------------------------------------------

/** The card's banner, avatar and name block at scale `s` (canvas px per card px), offset by (ox, oy). */
function cardGuides(s: number, ox: number, oy: number, cardH: number, canvasW: number): Guide[] {
  const X = (v: number) => ox + v * s, Y = (v: number) => oy + v * s
  return [
    { id: 'card', name: 'Profile card (304 px wide, 16 px corners)', note: 'The card itself. Its height varies: 640 px in the DM panel, shorter in popouts.', shapes: [{ t: 'rect', x: X(0), y: Y(0), w: 304 * s, h: cardH * s, r: 16 * s, stroke: C.edge, width: 2 }] },
    { id: 'banner', name: 'Banner (105 px)', note: 'The member\'s banner picture or colour.', shapes: [{ t: 'rect', x: X(0), y: Y(0), w: 304 * s, h: 105 * s, fill: C.bannerFill, stroke: C.banner, width: 1.5, dash: true }, { t: 'text', x: X(296), y: Y(97), text: 'banner', size: Math.max(11, 9 * s), color: C.label, anchor: 'end' }] },
    { id: 'avatar', name: 'Avatar (80 px) and its 6 px ring', note: 'The avatar overlaps the banner\'s edge. Its decoration reaches 1.2× further.', shapes: [{ t: 'circle', cx: X(56), cy: Y(101), r: 46 * s, stroke: C.ring, width: 1.5, dash: true }, { t: 'circle', cx: X(56), cy: Y(101), r: 40 * s, fill: C.avatarFill, stroke: C.avatar, width: 2 }, { t: 'circle', cx: X(56), cy: Y(101), r: 48 * s, stroke: C.ring, width: 1, dash: true }] },
    { id: 'name', name: 'Name and handle', note: 'The display name (20 px bold) and the handle line under it: keep busy art away so they read.', shapes: [{ t: 'rect', x: X(16), y: Y(153), w: 272 * s, h: 25 * s, fill: C.textFill, stroke: C.text, width: 1.5 }, { t: 'rect', x: X(16), y: Y(178), w: 160 * s, h: 20 * s, fill: C.textFill, stroke: C.text, width: 1 }, { t: 'text', x: X(20), y: Y(171), text: 'Display name', size: Math.max(11, 13 * s), color: C.label }] },
    { id: 'content', name: 'Card content (about me, roles…)', note: 'Panels of text. Art here sits over them, so keep it light or around the edges.', shapes: [{ t: 'rect', x: X(16), y: Y(210), w: 272 * s, h: Math.max(0, Math.min(cardH, (canvasW / s) * 4) - 226) * s, stroke: C.text, width: 1, dash: true }] },
  ]
}

// --- profile effects ----------------------------------------------------------------------------------------------

function effect(): TemplateKind {
  // Layers are drawn the card's width and hung from its top (ProfileEffect.tsx `absolute inset-x-0 top-0 w-full`);
  // Discord's are 450×880 or 900×1760. This canvas is the 2× size: 900 px = the 304 px card.
  const W = 900, H = 1760, s = W / 304
  const card = cardGuides(s, 0, 0, 640, W)
  card.find((g) => g.id === 'content')!.shapes = [{ t: 'rect', x: 16 * s, y: 210 * s, w: 272 * s, h: H - 210 * s - 16 * s, stroke: C.text, width: 1, dash: true }]
  return {
    kind: 'effect',
    title: 'Profile effect',
    width: W, height: H,
    also: ['450×880 (1×): the same layout at half size', 'any width: Parley stretches every layer to the card\'s width, hung from its top'],
    guides: [
      { id: 'edge', name: 'Canvas = the card\'s width, from its top', note: 'Every layer is stretched to the card\'s width and hung from its top. The card cuts off what\'s past its rounded edges and its bottom.', shapes: [{ t: 'rect', x: 0.5, y: 0.5, w: W - 1, h: H - 1, stroke: C.edge, width: 1, dash: true }] },
      ...card,
    ],
    art: [
      { name: 'Layers – export each as layer_NN.png', layers: ['layer_01', 'layer_02', 'layer_03'] },
      { name: 'Stills – optional', layers: ['static', 'reduced_motion', 'thumbnail'] },
    ],
    rulers: { h: [105 * s, 153 * s, 198 * s], v: [16 * s, 288 * s] },
    slots: [{ id: 'effect', title: 'Every layer and still', x: 0, y: 0, w: W, h: H, files: ['layer_01.png', 'layer_02.png', '…', 'static.png', 'reduced_motion.png', 'thumbnail.png'], note: 'Each layer is a whole canvas: same size, same position.' }],
    howTo: [
      'Each layer is its own animated PNG the size of the whole canvas: layer_01.png, layer_02.png, … (up to 32).',
      'Timing is set per layer in the Studio (or metadata.json): when it starts, how long it plays, whether it loops and waits between loops, and which is on top.',
      'Optional stills, the same size: static.png (pickers), reduced_motion.png (shown instead of playing for people who turn motion off), thumbnail.png (pickers show it first).',
      'Make a folder named after the effect (its id in Parley), e.g. `profile-effects/starfall/`, and put the files in it.',
    ],
    motion: {
      fps: 12, frame_ms: 83, typical_duration_ms: [3000, 6000],
      formats: ['Animated PNG (APNG) per layer', 'GIF or animated WebP per layer', 'PNG stills: static.png, reduced_motion.png, thumbnail.png'],
      notes: [
        'Discord\'s effects are 12 fps (83 ms frames), each layer 3–6 s; an intro layer plays once and a looping layer takes over.',
        'A layer only shows while it plays: give one-shot layers loop: false, and looping ones loop: true with loop_delay_ms for a pause between plays.',
        'Times are whole milliseconds up to 600000 (10 minutes); z_index 0–10000, higher on top; up to 32 layers.',
        'Parley restarts an animated PNG each time it plays, from its first frame.',
      ],
      layer_fields: {
        file: 'The layer\'s picture in the effect\'s folder, e.g. layer_01.png',
        start_ms: 'How long after the card opens it first plays',
        duration_ms: 'How long one play lasts; usually the animation\'s own length',
        loop: 'true: play again after each play; false: play once, then go away',
        loop_delay_ms: 'Looping layers: how long to wait (hidden) between plays',
        z_index: 'Stacking order; higher draws on top',
        random_variants: 'Optional: other files to pick from at random each play',
      },
      example_layers: [
        { file: 'layer_01.png', start_ms: 0, duration_ms: 2000, loop: false, loop_delay_ms: 0, z_index: 100 },
        { file: 'layer_02.png', start_ms: 1500, duration_ms: 4000, loop: true, loop_delay_ms: 0, z_index: 101 },
        { file: 'layer_03.png', start_ms: 3000, duration_ms: 1000, loop: true, loop_delay_ms: 5000, z_index: 102 },
      ],
      ffmpeg: { apng_from_frames: 'ffmpeg -framerate 12 -i layer_01_%04d.png -plays 0 -f apng layer_01.png' },
    },
    sources: ['frontend/src/components/ProfileEffect.tsx: layers `absolute inset-x-0 top-0 w-full`, timing from start_ms/duration_ms/loop/loop_delay_ms', 'frontend/src/components/ProfileCard.tsx: card `rounded-2xl`, banner `h-[105px]`, avatar 80 `-mt-11 px-4 ring-[6px]`, name `pt-3`', 'frontend/src/components/ProfileFrame.tsx: PANEL_CARD_WIDTH = 304', 'media/profile-effects: 992 layers 450×880, 582 at 900×1760; 83 ms frames'],
  }
}

// --- profile frames -----------------------------------------------------------------------------------------------

function frame(): TemplateKind {
  // Frames are drawn for a card `inner_width` 1200 wide (ProfileFrame.tsx), Parley's default layout: 304 above, 212
  // below, 56 each side; staples 1312 wide, centred. The card is 2528 tall here (Discord's rails), i.e. 640 px at 304.
  const IW = 1200, OT = 304, OB = 212, OH = 56, W = IW + 2 * OH, CH = 2528, H = OT + CH + OB, s = IW / 304
  const card = cardGuides(s, OH, OT, CH / s, W)
  card.find((g) => g.id === 'content')!.shapes = [{ t: 'rect', x: OH + 16 * s, y: OT + 210 * s, w: 272 * s, h: CH - 226 * s, stroke: C.text, width: 1.5, dash: true }]
  const TOP = 716, BOTTOM = 424
  return {
    kind: 'frame',
    title: 'Profile frame',
    width: W, height: H,
    also: ['Any inner_width: set the layout to match (the Studio\'s Layout fields)', 'Pieces 1312 wide: staples hang from the top or sit on the bottom, rails and borders run down the sides'],
    guides: [
      { id: 'reach', name: 'Overflow: 304 above, 212 below, 56 each side', note: 'How far the frame reaches past the card (the layout). Parley makes this much room around the card.', shapes: [{ t: 'rect', x: 0, y: 0, w: W, h: OT, fill: C.outFill }, { t: 'rect', x: 0, y: OT + CH, w: W, h: OB, fill: C.outFill }, { t: 'rect', x: 0, y: OT, w: OH, h: CH, fill: C.outFill }, { t: 'rect', x: W - OH, y: OT, w: OH, h: CH, fill: C.outFill }, { t: 'text', x: W / 2, y: OT / 2, text: 'overflow_top 304', size: 28, color: C.label, anchor: 'middle' }, { t: 'text', x: W / 2, y: OT + CH + OB / 2 + 10, text: 'overflow_bottom 212', size: 28, color: C.label, anchor: 'middle' }] },
      ...card,
      { id: 'slots', name: 'Pieces: staple_top 1312×716, staple_bottom 1312×424, rail/border 1312×2528', note: 'Each piece is its own file of exactly this size: export these rectangles.', shapes: [{ t: 'rect', x: 1, y: 1, w: W - 2, h: TOP - 2, stroke: C.slot, width: 3, dash: true }, { t: 'rect', x: 1, y: H - BOTTOM + 1, w: W - 2, h: BOTTOM - 2, stroke: C.slot, width: 3, dash: true }, { t: 'text', x: 12, y: TOP - 14, text: 'staple_top 1312×716', size: 26, color: C.slot }, { t: 'text', x: 12, y: H - BOTTOM + 34, text: 'staple_bottom 1312×424', size: 26, color: C.slot }, { t: 'rect', x: 4, y: OT, w: 6, h: CH, fill: C.slot }, { t: 'rect', x: W - 10, y: OT, w: 6, h: CH, fill: C.slot }] },
    ],
    art: [
      { name: 'Back – only shows outside the card', layers: ['back_staple_top', 'back_staple_bottom', 'back_rail_center'] },
      { name: 'Front – draws over the card', layers: ['front_staple_top', 'front_staple_bottom', 'front_rail_center', 'front_border_center'] },
    ],
    rulers: { h: [OT, TOP, H - BOTTOM, OT + CH, OT + 105 * s], v: [OH, W - OH] },
    slots: [
      { id: 'staple_top', title: 'Top staple', x: 0, y: 0, w: W, h: TOP, files: ['front_staple_top.png', 'back_staple_top.png'], note: 'Hangs from the card\'s top edge, reaching 304 above it.' },
      { id: 'staple_bottom', title: 'Bottom staple', x: 0, y: H - BOTTOM, w: W, h: BOTTOM, files: ['front_staple_bottom.png', 'back_staple_bottom.png'], note: 'Sits on the card\'s bottom edge, reaching 212 below it.' },
      { id: 'rail_center', title: 'Rail or border', x: 0, y: OT, w: W, h: CH, files: ['front_rail_center.png', 'back_rail_center.png', 'front_border_center.png'], note: 'Runs down the sides, the card\'s height; on taller cards the top and bottom 45% keep their size and the middle stretches.' },
    ],
    howTo: [
      'Each piece is its own file. Name it order_type_anchor: order front (over the card) or back (behind it, only showing around it), type staple, rail or border, anchor top, bottom or center. The Studio reads these names and places the layer for you.',
      'Staples are 1312 wide: top ones 716 tall (304 above the card, 412 over it), bottom ones 424 tall (212 over the card, 212 below).',
      'Rails and borders are 1312 × 2528: the card\'s full height plus the 56 px sides.',
      'Back layers never show on the card itself: Parley cuts the card\'s rounded shape out of them.',
      'Put the pieces in a folder named after the frame, e.g. `profile-frames/vines/`, and set the Layout to inner_width 1200, overflow 304 / 212 / 56 (the Studio\'s default).',
    ],
    motion: {
      fps: 12, frame_ms: 83, typical_duration_ms: [3000, 5000],
      formats: ['PNG (most frames are still)', 'Animated PNG, GIF or animated WebP for moving pieces'],
      notes: ['Discord\'s frames are still PNGs. Animated pieces loop forever; a front and back piece meant to line up should share frame counts and timing.'],
      ffmpeg: { apng_from_frames: 'ffmpeg -framerate 12 -i front_staple_top_%04d.png -plays 0 -f apng front_staple_top.png' },
    },
    sources: ['frontend/src/components/ProfileFrame.tsx: scale card width / inner_width; staples `width ?? 1312`, top at -overflow_top, bottom at -overflow_bottom; rails cropped or stretched (45%); back layers clipped to outside the card', 'Studio DEFAULT_LAYOUT (Parley admin default): inner_width 1200, overflow 304 / 212 / 56', 'media/profile-frames: front_staple_top 1312×716, *_staple_bottom 1312×424, rails/borders 1312×2528'],
  }
}

export const TEMPLATE_KINDS: Record<Kind, TemplateKind> = { decoration: decoration(), nameplate: nameplate(), effect: effect(), frame: frame() }
