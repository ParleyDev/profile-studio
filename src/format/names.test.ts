import { describe, expect, it } from 'vitest'
import { applyFix, nameFixes, tidyName } from './names'
import type { Item } from './workspace'

const b = () => new Blob(['x'])
describe('fixing names', () => {
  it('tidies names the way Parley takes them', () => {
    expect(tidyName('café:1.png', false)).toBe('caf_1.png')
    expect(tidyName('Rooftop (1)?.WEBM', false)).toBe('Rooftop (1).webm')
    expect(tidyName("Rock 'n' Roll!", true)).toBe("Rock 'n' Roll!")
    expect(tidyName('a.b c', true)).toBe('a_b c')
  })

  it('renames new items whole, and only the layer files of ones already on the instance', () => {
    const items: Item[] = [
      { uid: 'n', kind: 'nameplate', entry: { file: 'all_bark:_all_bite.webm' }, files: { 'all_bark:_all_bite.webm': b() } },
      { uid: 'o', kind: 'nameplate', entry: { file: 'old: kept.webm' }, files: { 'old: kept.webm': b() } },
      { uid: 'e', kind: 'effect', entry: { folder: 'snow', layers: [{ file: 'flake:1.png', random_variants: ['flake:1.png', 'flake*2.png'] }] }, files: { 'flake:1.png': b(), 'flake*2.png': b() } },
    ]
    const fixes = nameFixes(items, (it) => it.uid !== 'n', new Set(['nameplate/all_bark_all_bite']))
    expect(fixes).toEqual([
      { uid: 'n', kind: 'nameplate', key: { from: 'all_bark:_all_bite.webm', to: 'all_bark_all_bite_2.webm' }, files: [] },
      { uid: 'e', kind: 'effect', files: [{ from: 'flake*2.png', to: 'flake_2.png' }, { from: 'flake:1.png', to: 'flake_1.png' }] },
    ])
    const n = applyFix(items[0], fixes[0])
    expect(n.entry.file).toBe('all_bark_all_bite_2.webm')
    expect(Object.keys(n.files)).toEqual(['all_bark_all_bite_2.webm'])
    const e = applyFix(items[2], fixes[1])
    expect(e.entry.layers).toEqual([{ file: 'flake_1.png', random_variants: ['flake_1.png', 'flake_2.png'] }])
    expect(Object.keys(e.files).sort()).toEqual(['flake_1.png', 'flake_2.png'])
  })
})
