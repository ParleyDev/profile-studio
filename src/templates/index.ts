import { KINDS, type Kind } from '../format/kinds'
import type { FolderFile } from '../format/workspace'
import { aniCraftKinds, effectCraftKinds, effectCraftTemplateFiles, toAniCraft, toEffectCraft, toVectorCraft } from './craft'
import { writeZip } from '../format/zip'
import { motionJson, readme, toPng, toPsd, toSvg } from './formats'
import { TEMPLATE_KINDS, type TemplateKind } from './spec'

export { TEMPLATE_KINDS, type TemplateKind } from './spec'
export { toPng, toPsd, toSvg } from './formats'
export { effectCraftTemplateFiles, toAniCraft, toEffectCraft, toVectorCraft } from './craft'

export type TemplateFormat = 'psd' | 'svg' | 'png' | 'motion' | 'vectorcraft' | 'effectcraft' | 'anicraft'
export const TEMPLATE_FORMATS: { id: TemplateFormat; title: string; apps: string }[] = [
  { id: 'psd', title: 'Layered PSD', apps: 'PhotoCraft, Photoshop, Photopea, Affinity Photo, Krita, GIMP; EffectCraft imports it as a comp' },
  { id: 'svg', title: 'Layered SVG', apps: 'VectorCraft, Illustrator, Inkscape, Affinity Designer, Figma; AniCraft imports it' },
  { id: 'png', title: 'PNG guide overlay', apps: 'Any app: Procreate, Aseprite, Clip Studio…' },
  { id: 'vectorcraft', title: 'VectorCraft template', apps: 'VectorCraft .vctemplate: guides as template layers, an artboard per Parley file' },
  { id: 'effectcraft', title: 'EffectCraft project', apps: 'EffectCraft .ectemplate and .ecproj: comp at the size and frame rate, guides, timed placeholder layers (not frames)' },
  { id: 'anicraft', title: 'AniCraft document', apps: 'AniCraft .anicraft: stage at the size and frame rate, guide layers, a layer per file (not frames)' },
  { id: 'motion', title: 'Motion spec', apps: 'EffectCraft, AniCraft, After Effects, Premiere, DaVinci Resolve (JSON + ffmpeg commands)' },
]

const file = (path: string, data: BlobPart, type: string): FolderFile => ({ path, blob: new Blob([data], { type }) })
/** Lets the page paint between big PSDs (a frame's is ~1312×3044). */
const breathe = () => new Promise<void>((r) => setTimeout(r, 0))

/**
 * One kind's template pack, as files for a zip: `parley-<kind>-template/<kind>.psd|.svg`, `guides.png`,
 * `motion.json`, `README.md`, and for frames `pieces/<piece>.*` cut to each file's exact size.
 */
export async function buildTemplatePack(kind: Kind, formats: TemplateFormat[], root = `parley-${kind}-template`): Promise<FolderFile[]> {
  const t: TemplateKind = TEMPLATE_KINDS[kind]
  const f = new Set(formats)
  const out: FolderFile[] = [file(`${root}/README.md`, readme(t, formats), 'text/markdown')]
  if (f.has('psd')) { out.push(file(`${root}/${kind}.psd`, toPsd(t), 'image/vnd.adobe.photoshop')); await breathe() }
  if (f.has('svg')) out.push(file(`${root}/${kind}.svg`, toSvg(t), 'image/svg+xml'))
  if (f.has('png')) { out.push(file(`${root}/guides.png`, toPng(t), 'image/png')); await breathe() }
  if (f.has('motion')) out.push(file(`${root}/motion.json`, motionJson(t), 'application/json'))
  if (f.has('vectorcraft')) out.push(file(`${root}/${kind}.vctemplate`, toVectorCraft(t), 'application/json'))
  if (f.has('effectcraft') && effectCraftKinds(t)) {
    out.push(file(`${root}/${kind}.ecproj`, toEffectCraft(t), 'application/json'))
    const parts = effectCraftTemplateFiles(t, toPng(t)).map((p) => ({ path: p.path, blob: new Blob([p.data], { type: p.type }) }))
    out.push({ path: `${root}/${kind}.ectemplate`, blob: await writeZip(parts) })
    await breathe()
  }
  if (f.has('anicraft') && aniCraftKinds(t)) out.push(file(`${root}/${kind}.anicraft`, toAniCraft(t), 'application/json'))
  // Frames: each piece is its own file size, so each gets templates cut to it, with only its own layers.
  if (t.slots.length > 1) {
    for (const s of t.slots) {
      const art = t.art.map((g) => ({ ...g, layers: g.layers.filter((l) => s.files.includes(`${l}.png`)) })).filter((g) => g.layers.length)
      const view = { x: s.x, y: s.y, w: s.w, h: s.h }
      if (f.has('psd')) { out.push(file(`${root}/pieces/${s.id}.psd`, toPsd(t, view, art), 'image/vnd.adobe.photoshop')); await breathe() }
      if (f.has('svg')) out.push(file(`${root}/pieces/${s.id}.svg`, toSvg(t, view, art), 'image/svg+xml'))
      if (f.has('png')) { out.push(file(`${root}/pieces/${s.id}_guides.png`, toPng(t, view), 'image/png')); await breathe() }
    }
  }
  return out
}

/** Every kind's pack in one set of files, under `parley-templates/`, with a top-level README. */
export async function buildAllTemplates(formats: TemplateFormat[]): Promise<FolderFile[]> {
  const out: FolderFile[] = [file('parley-templates/README.md', `# Parley profile cosmetic templates

One folder per kind, each with its own README: what the guides mean, the sizes and file names Parley expects, and
how to export.

${KINDS.map((k) => `- \`parley-${k}-template/\`: ${TEMPLATE_KINDS[k].title}, ${TEMPLATE_KINDS[k].width} × ${TEMPLATE_KINDS[k].height}`).join('\n')}

Made by Profile Studio from how Parley draws each kind.
`, 'text/markdown')]
  for (const k of KINDS) out.push(...(await buildTemplatePack(k, formats, `parley-templates/parley-${k}-template`)))
  return out
}
