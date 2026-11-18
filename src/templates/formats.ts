import { writePsd, type Layer, type Psd } from 'ag-psd'
import UPNG from 'upng-js'
import { bounds, render, type Box } from './raster'
import type { Shape, TemplateKind } from './spec'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const n = (v: number) => +v.toFixed(2)

/** #rrggbbaa → an SVG colour and its opacity. */
function paint(hex: string | undefined, prop: 'fill' | 'stroke') {
  if (!hex) return `${prop}="none"`
  const h = hex.replace('#', '')
  const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
  return `${prop}="#${h.slice(0, 6)}"${a < 1 ? ` ${prop}-opacity="${n(a)}"` : ''}`
}

function svgShape(s: Shape): string {
  if (s.t === 'text') {
    return `<text x="${n(s.x)}" y="${n(s.y)}" font-size="${n(s.size)}" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-weight="600" ${paint(s.color, 'fill')}${s.anchor ? ` text-anchor="${s.anchor}"` : ''}>${esc(s.text)}</text>`
  }
  const stroke = s.stroke ? `${paint(s.stroke, 'stroke')} stroke-width="${n(s.width ?? 1)}"${s.dash ? ' stroke-dasharray="10 10"' : ''}` : ''
  if (s.t === 'circle') return `<circle cx="${n(s.cx)}" cy="${n(s.cy)}" r="${n(s.r)}" ${paint(s.fill, 'fill')} ${stroke}/>`
  return `<rect x="${n(s.x)}" y="${n(s.y)}" width="${n(s.w)}" height="${n(s.h)}"${s.r ? ` rx="${n(s.r)}"` : ''} ${paint(s.fill, 'fill')} ${stroke}/>`
}

/**
 * A layered SVG: each guide in its own locked layer inside a "GUIDES" layer, and an empty layer per file to draw in.
 * Inkscape reads the layers (inkscape:groupmode), Illustrator and Affinity read the groups by their ids.
 * `view` crops it to one piece (a frame's staple, say) at that piece's exact size.
 */
export function toSvg(t: TemplateKind, view: Box = { x: 0, y: 0, w: t.width, h: t.height }, artLayers = t.art): string {
  const guides = t.guides.map((g) => `    <g id="guide-${g.id}" inkscape:groupmode="layer" inkscape:label="${esc(g.name)}" sodipodi:insensitive="true">\n      <desc>${esc(g.note)}</desc>\n      ${g.shapes.map(svgShape).join('\n      ')}\n    </g>`).join('\n')
  const art = artLayers.map((grp) => `  <g id="${slug(grp.name)}" inkscape:groupmode="layer" inkscape:label="${esc(grp.name)}">\n${grp.layers.map((l) => `    <g id="${l}" inkscape:groupmode="layer" inkscape:label="${l}"/>`).join('\n')}\n  </g>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"
  width="${view.w}" height="${view.h}" viewBox="${view.x} ${view.y} ${view.w} ${view.h}">
  <title>Parley ${esc(t.title)} template, ${view.w}×${view.h}</title>
  <desc>Draw in the artwork layers; hide or delete the GUIDES layer before exporting. Made by Profile Studio from Parley's own layout.</desc>
${art}
  <g id="guides" inkscape:groupmode="layer" inkscape:label="GUIDES – hide before export" sodipodi:insensitive="true" style="pointer-events:none">
${guides}
  </g>
</svg>
`
}

/** Every guide drawn into one transparent picture of `view`, to lay over art in any app. */
export function guidePixels(t: TemplateKind, view: Box = { x: 0, y: 0, w: t.width, h: t.height }) {
  return render(t.guides.flatMap((g) => g.shapes), view)
}

export function toPng(t: TemplateKind, view?: Box): ArrayBuffer {
  const p = guidePixels(t, view)
  return UPNG.encode([p.data.buffer as ArrayBuffer], p.width, p.height, 0)
}

/** Photoshop's ruler guides at the lines that matter, inside `view`. */
function rulers(t: TemplateKind, view: Box) {
  const out: { location: number; direction: 'horizontal' | 'vertical' }[] = []
  for (const y of t.rulers.h) if (y > view.y && y < view.y + view.h) out.push({ location: y - view.y, direction: 'horizontal' })
  for (const x of t.rulers.v) if (x > view.x && x < view.x + view.w) out.push({ location: x - view.x, direction: 'vertical' })
  return out
}

/**
 * A layered PSD: a "GUIDES" group on top (one locked layer per guide, named for what it marks) over the artwork
 * groups, with an empty layer per file Parley expects, plus Photoshop ruler guides. Opens in Photoshop, Photopea,
 * Affinity Photo, Krita and GIMP.
 */
export function toPsd(t: TemplateKind, view: Box = { x: 0, y: 0, w: t.width, h: t.height }, artLayers = t.art): ArrayBuffer {
  const guideLayers: Layer[] = []
  for (const g of t.guides) {
    const b = bounds(g.shapes, view)
    if (!b) continue
    guideLayers.push({ name: g.name, left: b.x - view.x, top: b.y - view.y, imageData: render(g.shapes, b), protected: { all: true }, layerColor: 'magenta' })
  }
  const art: Layer[] = artLayers.map((grp) => ({ name: grp.name, opened: true, layerColor: 'blue', children: [...grp.layers].reverse().map((l) => ({ name: l })) }))
  const psd: Psd = {
    width: view.w,
    height: view.h,
    // ag-psd lists bottom first: artwork under the guides.
    children: [...art, { name: 'GUIDES – hide before export', opened: true, layerColor: 'magenta', children: guideLayers.reverse() }],
    imageData: guidePixels(t, view),
    imageResources: { gridAndGuidesInformation: { guides: rulers(t, view) } },
  }
  return writePsd(psd, { generateThumbnail: false, noBackground: true })
}

// --- motion spec and readme ---------------------------------------------------------------------------------------

export function motionJson(t: TemplateKind): string {
  return `${JSON.stringify({
    kind: t.kind,
    canvas: { width: t.width, height: t.height },
    also: t.also,
    frame_rate: t.motion.fps,
    frame_ms: t.motion.frame_ms,
    typical_duration_ms: t.motion.typical_duration_ms,
    max_duration_ms: 600000,
    formats: t.motion.formats,
    files: t.slots.map((s) => ({ piece: s.title, width: s.w, height: s.h, files: s.files, note: s.note })),
    ...(t.motion.layer_fields ? { layer_fields: t.motion.layer_fields, example_layers: t.motion.example_layers } : {}),
    notes: t.motion.notes,
    ffmpeg: t.motion.ffmpeg,
  }, null, 1)}\n`
}

const COMP: Record<string, string> = {
  decoration: 'one comp at the canvas size, transparent background',
  nameplate: 'one comp at the canvas size, transparent background; render with alpha',
  effect: 'one comp per layer (layer_01, layer_02, …), all at the canvas size, transparent background',
  frame: 'one comp per piece at its own size (see the pieces below)',
}

export function readme(t: TemplateKind, formats: string[]): string {
  const f = new Set(formats)
  const files: string[] = []
  if (f.has('psd')) files.push(`- \`${t.kind}.psd\`: layered, for Photoshop, Photopea, Affinity Photo, Krita or GIMP.`)
  if (f.has('svg')) files.push(`- \`${t.kind}.svg\`: layered, for Illustrator, Inkscape, Affinity Designer or Figma.`)
  if (f.has('png')) files.push('- `guides.png`: a transparent overlay of the guides, for any other app (Procreate, Aseprite, Clip Studio…). Put it on a layer above your art.')
  if (f.has('motion')) files.push('- `motion.json`: sizes, frame rate, timing and export settings, for After Effects, Premiere, DaVinci Resolve or a script.')
  if (f.has('vectorcraft')) files.push(`- \`${t.kind}.vctemplate\`: for VectorCraft. Opens as a new document; the guides are template layers (locked, left out of export)${t.slots.length > 1 ? ', with an artboard per piece so Export for Screens writes each file at its size' : ''}. ${t.slots.length > 1 ? 'To export the files at their exact sizes, show only the front layers and use Export for Screens → Artboards with the file name `front_<name>` (it writes front_staple_top.png, front_staple_bottom.png, front_rail_center.png), then the same with only the back layers and `back_<name>`. A border shares the rail artboard: export it on its own as front_border_center.png.' : 'To export at its exact size, hide the guides and export the artboard (Export for Screens → Artboards), named after the Parley file.'} Exporting a layer instead crops it to its art.`)
  if (f.has('anicraft') && t.kind !== 'frame') files.push(`- \`${t.kind}.anicraft\`: for AniCraft. The stage at this size and frame rate with a see-through background; the guides are guide layers (locked, not exported) and there is a layer per file. Export a PNG sequence, then use Profile Studio's "from frames" to make the animated PNG.`)
  if (f.has('effectcraft') && t.kind !== 'frame') files.push(`- \`${t.kind}.ecproj\`: for EffectCraft (and \`${t.kind}.ectemplate\`, the same as a template: File → New from template). A comp at this size and frame rate with comp guides, and a placeholder layer per file, switched off: replace each with your art (its in and out points are its timing). Render with alpha (RGBA): ${t.kind === 'nameplate' ? 'WebM VP9' : 'PNG sequence, then Profile Studio\'s "from frames" turns it into an animated PNG'}.`)
  if (t.slots.length > 1) files.push('- `pieces/`: the same templates cut to each piece\'s exact size.')
  return `# Parley ${t.title} template

Canvas: **${t.width} × ${t.height} px**. Also: ${t.also.join('; ')}.

## Files

${files.join('\n')}

## The guides

${t.guides.map((g) => `- **${g.name}**: ${g.note}`).join('\n')}

The guides are their own layer group, **GUIDES – hide before export**. Hide or delete it before you export.

## What to export

${t.slots.map((s) => `- **${s.title}** (${s.w} × ${s.h}): ${s.files.map((x) => `\`${x}\``).join(', ')}. ${s.note}`).join('\n')}

${t.howTo.map((h) => `- ${h}`).join('\n')}

## Motion

- ${t.motion.fps} fps (${t.motion.frame_ms} ms a frame), usually ${t.motion.typical_duration_ms[0] / 1000}–${t.motion.typical_duration_ms[1] / 1000} s.
- Formats: ${t.motion.formats.join('; ')}.
${t.motion.notes.map((x) => `- ${x}`).join('\n')}
${t.motion.layer_fields ? `\nEach layer's timing (set in the Studio, saved in metadata.json):\n\n${Object.entries(t.motion.layer_fields).map(([k, v]) => `- \`${k}\`: ${v}`).join('\n')}\n` : ''}
### After Effects, Premiere or DaVinci Resolve

1. Make ${COMP[t.kind]}, at ${t.motion.fps} fps.
2. Import \`guides.png\` (or the PSD) as a guide layer over everything and turn it off for rendering (After Effects: make it a guide layer; Resolve: disable the clip before rendering).
3. Render a PNG sequence with alpha (or ProRes 4444), then convert:
${Object.entries(t.motion.ffmpeg ?? {}).map(([k, v]) => `   - ${k.replace(/_/g, ' ')}: \`${v}\``).join('\n')}

## Into Parley

Open the files in Profile Studio (New → ${t.title}), check the preview, then Export zip and import it in Parley under Admin → Cosmetics → Import, or copy the folder into the instance's assets folder.
`
}
