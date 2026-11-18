import { describe, expect, it } from 'vitest'
import { KINDS } from '../format/kinds'
import { buildTemplatePack, TEMPLATE_KINDS, toAniCraft, toEffectCraft, toVectorCraft } from '.'

/** Every id in a VectorCraft document, which share one counter. */
function ids(v: unknown, out: number[] = []): number[] {
  if (Array.isArray(v)) v.forEach((x) => ids(x, out))
  else if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (typeof o.id === 'number') out.push(o.id)
    Object.values(o).forEach((x) => ids(x, out))
  }
  return out
}

describe('VectorCraft templates', () => {
  it('are templates in pixels, with unique ids below next_id', () => {
    for (const k of KINDS) {
      const d = JSON.parse(toVectorCraft(TEMPLATE_KINDS[k])).document
      expect(d.template).toBe(true)
      expect(d.units).toBe('Pixels')
      const all = ids(d)
      expect(new Set(all).size).toBe(all.length)
      expect(d.next_id).toBeGreaterThan(Math.max(...all))
      // Every layer carries its colour (VectorCraft refuses one without).
      for (const l of d.layers) expect(l.kind.color).toBeDefined()
      // Guides are template layers on top of the artwork.
      const firstGuide = d.layers.findIndex((l: { kind: { template?: boolean } }) => l.kind.template)
      expect(d.layers.slice(firstGuide).every((l: { kind: { template?: boolean } }) => l.kind.template)).toBe(true)
    }
  })
  it('give a frame an artboard per piece, where it sits around the card', () => {
    const d = JSON.parse(toVectorCraft(TEMPLATE_KINDS.frame)).document
    expect(d.artboards.map((a: { name: string }) => a.name)).toEqual(['staple_top', 'staple_bottom', 'rail_center'])
    expect(d.artboards[0].rect).toEqual({ x0: 0, y0: 0, x1: 1312, y1: 716 })
    expect(d.layers.map((l: { name: string }) => l.name)).toContain('front_staple_top')
  })
})

describe('EffectCraft projects', () => {
  it('make a comp at the kind\'s size and frame rate, with timed placeholders switched off', () => {
    const p = JSON.parse(toEffectCraft(TEMPLATE_KINDS.effect))
    const comp = p.items[1].kind
    expect([comp.width, comp.height, comp.frame_rate.num]).toEqual([900, 1760, TEMPLATE_KINDS.effect.motion.fps])
    expect(comp.layers.length).toBeGreaterThan(0)
    for (const l of comp.layers) {
      expect(l.switches.video).toBe(false)
      expect(l.out_point).toBeGreaterThan(l.in_point)
      expect(p.items[l.source.item].kind.type).toBe('Solid')
    }
    expect(p.next_id).toBeGreaterThan(Math.max(...Object.keys(p.items).map(Number), ...comp.layers.map((l: { id: number }) => l.id)))
  })
  it('are left out for frames, which are stills', async () => {
    const files = (await buildTemplatePack('frame', ['effectcraft', 'vectorcraft'])).map((f) => f.path)
    expect(files.some((f) => f.endsWith('.ecproj'))).toBe(false)
    expect(files).toContain('parley-frame-template/frame.vctemplate')
  })
})

describe('AniCraft documents', () => {
  it('put guide layers on top, locked, with shapes pointing into the path pool', () => {
    const d = JSON.parse(toAniCraft(TEMPLATE_KINDS.decoration))
    const layers = d.document.scenes[0].timeline.layers
    expect(d.document.stage).toMatchObject({ width: 288, height: 288, background: { a: 0 } })
    const guides = layers.filter((l: { kind: string }) => l.kind === 'Guide')
    expect(guides.length).toBeGreaterThan(0)
    expect(layers.slice(0, guides.length).every((l: { kind: string; locked: boolean }) => l.kind === 'Guide' && l.locked)).toBe(true)
    expect(layers[layers.length - 1].name).toBe('decoration')
    for (const g of guides) for (const e of g.keyframes[0].elements) expect(typeof d.paths[e.kind.Shape.path]).toBe('string')
    expect(d.document.next_id).toBeGreaterThan(Math.max(...ids(layers)))
  })
})

describe('EffectCraft templates', () => {
  it('zip a manifest with a control per placeholder, the project and a poster', async () => {
    const files = await buildTemplatePack('nameplate', ['effectcraft'])
    const tpl = files.find((f) => f.path.endsWith('.ectemplate'))!
    const { readZip } = await import('../format/zip')
    const parts = await readZip(tpl.blob)
    expect(parts.map((p) => p.path)).toEqual(['manifest.json', 'project.ecproj', 'poster.png'])
    const m = JSON.parse(await parts[0].blob.text())
    expect(m).toMatchObject({ format: 'effectcraft-template', comp: 1, width: 448, height: 84, poster: 'poster.png' })
    const proj = JSON.parse(await parts[1].blob.text())
    const layer = proj.items[1].kind.layers[0]
    expect(m.controls[0]).toMatchObject({ layer: layer.id, path: 'transform/opacity' })
    // EffectCraft loads controls from the comp's essential block, with ids of their own.
    const essential = proj.items[1].kind.essential
    expect(essential.controls[0]).toMatchObject({ id: m.controls[0].id, kind: { type: 'Property', layer: layer.id, prop: m.controls[0].prop } })
    expect(m.controls[0].id).not.toBe(m.controls[0].prop)
    expect(proj.next_id).toBeGreaterThan(m.controls[0].id)
  })
})
