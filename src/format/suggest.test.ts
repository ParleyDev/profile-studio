import { describe, expect, it } from 'vitest'
import { fromPixels, similarity, suggestTags, wordsOf, type Features } from './suggest'
import type { Item } from './workspace'

const item = (uid: string, entry: Item['entry'], kind: Item['kind'] = 'decoration'): Item => ({ uid, kind, entry, files: {} })
/** A w×h picture from a function giving each pixel's RGBA. */
const paint = (w: number, h: number, f: (x: number, y: number) => [number, number, number, number]) => {
  const px = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px.set(f(x, y), (y * w + x) * 4)
  return px
}
const look = (px: Uint8ClampedArray, animated = false): Features => ({ ...fromPixels(px, 32, 32), animated })

describe('tag suggestions', () => {
  it('reads words from the name, file name and description', () => {
    expect([...wordsOf(item('a', { file: 'SantaHat_red.png', name: 'Jolly Hats', description: 'Snowflakes!' }))]).toEqual(['jolly', 'hat', 'santa', 'red', 'snowflake'])
  })

  it('offers tags in use whose words appear, and built-in ones', () => {
    const pool = [item('x', { file: 'x.png', tags: ['winter sports', 'gold'] })]
    const got = suggestTags(item('a', { file: 'ski_hat.png', name: 'Winter Sports Hat', description: 'With a santa bobble' }), pool)
    expect(got.map((s) => s.tag)).toEqual(['winter sports', 'christmas', 'sports', 'winter'])
    expect(got[0].why).toContain('“winter sports” in its name or description')
    // Tags it already has aren't offered.
    expect(suggestTags(item('a', { file: 'santa.png', tags: ['christmas'] }), pool)).toEqual([])
  })

  it('names the main colours and whether it moves', () => {
    const red = look(paint(32, 32, () => [220, 20, 30, 255]), true)
    const got = suggestTags(item('a', { file: 'a.png' }), [], new Map([['a', red]]))
    expect(got.map((s) => s.tag)).toEqual(['color:red', 'animated'])
    // A colour it has already (from the shop or a tag) isn't offered again.
    expect(suggestTags(item('a', { file: 'a.png', colors: ['Red'] }), [], new Map([['a', red]])).map((s) => s.tag)).toEqual(['animated'])
    // See-through pixels don't count.
    expect(fromPixels(paint(32, 32, (x) => (x < 24 ? [0, 0, 0, 0] : [30, 60, 230, 255])), 32, 32).colors).toEqual(['blue'])
    const stripes = fromPixels(paint(32, 32, (x) => [[255, 0, 0], [255, 140, 0], [255, 230, 0], [0, 200, 0], [0, 80, 255], [160, 0, 255]][x % 6].concat(255) as [number, number, number, number]), 32, 32)
    expect(stripes.colors).toContain('colorful')
  })

  it('offers what similar items share', () => {
    const ring = (r: number, g: number, b: number, off = 0) => paint(32, 32, (x, y) => (Math.abs(Math.hypot(x - 16 - off, y - 16) - 11) < 3 ? [r, g, b, 255] : [0, 0, 0, 0]))
    const feats = new Map<string, Features>([
      ['a', look(ring(240, 200, 40))],
      ['n1', look(ring(235, 195, 45, 1))],
      ['n2', look(ring(245, 205, 35))],
      ['far', look(paint(32, 32, (x, y) => (x > y ? [20, 30, 200, 255] : [250, 250, 250, 255])))],
    ])
    expect(similarity(feats.get('a')!, feats.get('n1')!)).toBeGreaterThan(0.9)
    expect(similarity(feats.get('a')!, feats.get('far')!)).toBeLessThan(0.8)
    const pool = [item('n1', { file: 'n1.png', tags: ['halo', 'gold'] }), item('n2', { file: 'n2.png', tags: ['halo'] }), item('far', { file: 'f.png', tags: ['flag'] }), item('o', { file: 'o.png', tags: ['halo'] }, 'nameplate')]
    const got = suggestTags(item('a', { file: 'a.png' }), pool, feats)
    expect(got.find((s) => s.tag === 'halo')?.why).toEqual(['2 similar items have it'])
    expect(got.find((s) => s.tag === 'gold')?.why[0]).toMatch(/^looks like/)
    expect(got.some((s) => s.tag === 'flag')).toBe(false)
  })
})
