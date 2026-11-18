import { readPsd } from 'ag-psd'
import UPNG from 'upng-js'
import { describe, expect, it } from 'vitest'
import { KINDS } from '../format/kinds'
import { buildAllTemplates, buildTemplatePack, TEMPLATE_KINDS } from './index'
import { guidePixels } from './formats'

const text = (b: Blob) => b.text()

describe('templates', () => {
  it('build every format for every kind at the canvas size', async () => {
    for (const k of KINDS) {
      const t = TEMPLATE_KINDS[k]
      const files = await buildTemplatePack(k, ['psd', 'svg', 'png', 'motion'])
      const by = new Map(files.map((f) => [f.path.split('/').slice(1).join('/'), f.blob]))
      expect([...by.keys()]).toEqual(expect.arrayContaining(['README.md', `${k}.psd`, `${k}.svg`, 'guides.png', 'motion.json']))

      const svg = await text(by.get(`${k}.svg`)!)
      expect(svg).toContain(`viewBox="0 0 ${t.width} ${t.height}"`)
      expect(svg).toContain('inkscape:label="GUIDES – hide before export"')
      for (const g of t.art.flatMap((a) => a.layers)) expect(svg).toContain(`inkscape:label="${g}"`)

      const png = UPNG.decode(await by.get('guides.png')!.arrayBuffer())
      expect([png.width, png.height]).toEqual([t.width, t.height])

      const psd = readPsd(await by.get(`${k}.psd`)!.arrayBuffer(), { skipLayerImageData: true, skipCompositeImageData: true, skipThumbnail: true })
      expect([psd.width, psd.height]).toEqual([t.width, t.height])
      const top = psd.children!.map((c) => c.name)
      expect(top.at(-1)).toBe('GUIDES – hide before export')
      const names = psd.children!.flatMap((c) => c.children?.map((x) => x.name) ?? [])
      for (const l of t.art.flatMap((a) => a.layers)) expect(names).toContain(l)

      const motion = JSON.parse(await text(by.get('motion.json')!))
      expect(motion.canvas).toEqual({ width: t.width, height: t.height })
      expect(motion.frame_rate).toBe(12)
    }
  }, 60_000)

  it('cut frame pieces to the sizes Parley uses', async () => {
    const files = await buildTemplatePack('frame', ['svg', 'png'])
    const size = async (p: string) => { const i = UPNG.decode(await files.find((f) => f.path.endsWith(p))!.blob.arrayBuffer()); return [i.width, i.height] }
    expect(await size('pieces/staple_top_guides.png')).toEqual([1312, 716])
    expect(await size('pieces/staple_bottom_guides.png')).toEqual([1312, 424])
    expect(await size('pieces/rail_center_guides.png')).toEqual([1312, 2528])
    expect(await text(files.find((f) => f.path.endsWith('pieces/staple_top.svg'))!.blob)).toContain('inkscape:label="front_staple_top"')
  }, 30_000)

  it('match Parley\'s geometry', () => {
    expect([TEMPLATE_KINDS.decoration.width, TEMPLATE_KINDS.nameplate.width, TEMPLATE_KINDS.nameplate.height]).toEqual([288, 448, 84])
    expect([TEMPLATE_KINDS.frame.width, TEMPLATE_KINDS.frame.height]).toEqual([1312, 304 + 2528 + 212])
    // The decoration's avatar is the canvas / 1.2, centred, and stays see-through in the guide overlay's middle.
    const p = guidePixels(TEMPLATE_KINDS.decoration)
    const at = (x: number, y: number) => p.data[(y * p.width + x) * 4 + 3]
    expect(at(144, 24)).toBeGreaterThan(100) // on the avatar's edge (r = 120)
    expect(at(144, 2)).toBeLessThan(255)
  })

  it('put every kind in one set with a README', async () => {
    const files = await buildAllTemplates(['svg', 'motion'])
    expect(files[0].path).toBe('parley-templates/README.md')
    for (const k of KINDS) expect(files.some((f) => f.path === `parley-templates/parley-${k}-template/${k}.svg`)).toBe(true)
  }, 30_000)
})
