import { describe, expect, it } from 'vitest'
import { bundleIndex, bundlesOf, bundlesWith, deletedBundles, refOf, revertBundle, shopOf, themeLabel, themeLabels, withBundle, withoutBundle } from './shop'
import { suggestTags } from './suggest'
import { matchesQuery, parseQuery } from './tags'
import { metadataJson, readFolder, writeFolder, type Item } from './workspace'

const file = (path: string, v: unknown, indent: string | number = 2, newline = false) => ({ path, blob: new Blob([JSON.stringify(v, null, indent) + (newline ? '\n' : '')]) })
const png = (path: string) => ({ path, blob: new Blob(['x'], { type: 'image/png' }) })

// A made-up folder shaped like a shop sync script's output.
const decorations = {
  source: 'test', item_count: 3,
  items: [
    { file: 'moon.png', name: 'Moon', description: null, in_shop: true, shop_item_id: '11', price: { amount: 1, currency: 'XYZ', display: 'X1' }, collection_id: 'c1', colors: ['blue', 'white'], themes: ['cute_cozy', 'sci_fi'], bundles: [{ id: 'b1', name: 'Night Bundle' }] },
    { file: 'star.png', name: 'Star', in_shop: true, shop_item_id: '12', collection_id: 'c1' },
    { file: 'old.png', name: 'Old', in_shop: false, shop_item_id: null, price: null },
  ],
  collections: { c1: { items: ['moon.png', 'star.png'], note: 'kept' } },
  tag_labels: ['Blue', 'Cute & Cozy', 'Sci-Fi'],
}
const bundles = { source: 'test', bundle_count: 1, bundles: [{ id: 'b1', name: 'Night Bundle', price: { display: 'X3' }, owned: false, collection_id: 'c1', items: [{ shop_item_id: '11', name: 'Moon', type: 'avatar_decoration' }, { shop_item_id: '21', name: 'Night Sky', type: 'nameplate' }] }] }
const nameplates = { items: [{ file: 'sky.webm', name: 'Night Sky', shop_item_id: '21' }] }

async function open() {
  return readFolder([
    file('assets/bundles.json', bundles, 2, true),
    file('assets/avatar-decorations/metadata.json', decorations),
    png('assets/avatar-decorations/moon.png'), png('assets/avatar-decorations/star.png'), png('assets/avatar-decorations/old.png'),
    file('assets/nameplates/metadata.json', nameplates, 1, true), png('assets/nameplates/sky.webm'),
  ])
}

describe('shop sync shapes', () => {
  it('reads bundles.json and writes everything back as it was laid out', async () => {
    const { workspace: ws, notes } = await open()
    expect(notes).toEqual([])
    expect(ws.bundles).toEqual(bundles)
    expect(metadataJson(ws, 'decoration')).toBe(JSON.stringify(decorations, null, 2))
    expect(metadataJson(ws, 'nameplate')).toBe(`${JSON.stringify(nameplates, null, 1)}\n`)
    const out = writeFolder(ws)
    expect(await out.find((f) => f.path === 'bundles.json')!.blob.text()).toBe(`${JSON.stringify(bundles, null, 2)}\n`)
  })

  it('keeps collections true when items are renamed, added or removed', async () => {
    const { workspace: ws } = await open()
    const [moon, star] = ws.items
    const items = [{ ...star, entry: { ...star.entry, file: 'star2.png' } }, moon, { ...moon, uid: 'n', entry: { file: 'new.png', collection_id: 'c2' } }]
    const meta = JSON.parse(metadataJson({ ...ws, items }, 'decoration'))
    expect(meta.collections).toEqual({ c1: { items: ['star2.png', 'moon.png'], note: 'kept' }, c2: { items: ['new.png'] } })
    expect(meta.item_count).toBe(3)
    expect(Object.keys(meta)).toEqual(['source', 'item_count', 'items', 'collections', 'tag_labels'])
  })

  it('reads shop details, theme labels and bundles', async () => {
    const { workspace: ws } = await open()
    const moon = ws.items[0]
    expect(shopOf(moon)).toMatchObject({ shopId: '11', inShop: true, price: { display: 'X1' }, themes: ['cute_cozy', 'sci_fi'], bundles: [{ id: 'b1' }] })
    expect(shopOf(ws.items[2])).toMatchObject({ shopId: undefined, inShop: false, price: null })
    const labels = themeLabels(ws)
    expect(themeLabel('cute_cozy', labels)).toBe('Cute & Cozy')
    expect(themeLabel('sci_fi', labels)).toBe('Sci-Fi')
    expect(themeLabel('dark_moody', labels)).toBe('Dark Moody')
    expect(bundleIndex(ws, ws.items).get('b1')?.items.map((x) => x.shop_item_id)).toEqual(['11', '21'])
  })

  it('searches and suggests from shop colours and themes', async () => {
    const { workspace: ws } = await open()
    const moon: Item = ws.items[0]
    expect(matchesQuery(moon, parseQuery('#sci-fi'), 'moon.png')).toBe(true)
    expect(matchesQuery(moon, parseQuery('#blue cozy'), 'moon.png')).toBe(true)
    expect(matchesQuery(ws.items[1], parseQuery('#blue'), 'star.png')).toBe(false)
    // Colours and themes it has already aren't offered again, as plain tags or special ones.
    const got = suggestTags(moon, ws.items, undefined, { labels: themeLabels(ws) }).map((s) => s.tag)
    expect(got.filter((t) => /blue|cozy|sci/.test(t))).toEqual([])
  })

  it('adds colours and themes from color: and theme: tags', async () => {
    const { workspace: ws } = await open()
    const home: Item = { uid: 'h', kind: 'decoration', entry: { file: 'home.png', name: 'Cozy Home', tags: ['color:light_blue', 'theme:holiday', 'theme:sci_fi', 'cozy'] }, files: {} }
    const s = shopOf(home)
    expect([s.colors, s.tagColors, s.allThemes]).toEqual([[], ['light_blue'], ['holiday', 'sci_fi']])
    expect(matchesQuery(home, parseQuery('#holiday #light-blue'), 'home.png')).toBe(true)
    // Synced values come first; a tag naming one adds nothing.
    const moon = { ...ws.items[0], entry: { ...ws.items[0].entry, tags: ['theme:sci_fi', 'color:gold'] } }
    expect([shopOf(moon).tagThemes, shopOf(moon).allColors.at(-1)]).toEqual([[], 'gold'])
    // Theme words in its name suggest the theme as a special tag.
    expect(suggestTags({ ...home, entry: { name: 'Cozy cute nook', file: 'n.png' } }, [...ws.items, home], undefined, { labels: themeLabels(ws) }).map((x) => x.tag)).toContain('theme:cute_cozy')
  })
})

describe('bundle changes in bundles.local.json', () => {
  const sync = { bundles: [{ id: 'b1', name: 'Night', price: { display: 'X3' }, items: [{ shop_item_id: '11', name: 'Moon', type: 'avatar_decoration' }, { shop_item_id: '21', name: 'Sky', type: 'nameplate' }] }, { id: 'b2', name: 'Day', items: [] }] }
  const items: Item[] = [
    { uid: 'm', kind: 'decoration', entry: { file: 'moon.png', name: 'Moon', shop_item_id: '11', bundles: [{ id: 'b1', name: 'Night' }] }, files: {} },
    { uid: 's', kind: 'nameplate', entry: { file: 'sky.png', name: 'Sky', shop_item_id: '21', bundles: [{ id: 'b1', name: 'Night' }] }, files: {} },
    { uid: 'h', kind: 'decoration', entry: { file: 'home.png', name: 'Homemade' }, files: {} },
  ]

  it('keeps only what differs from bundles.json, and nothing once it\'s back as synced', () => {
    let ws: { bundles: Record<string, unknown>; localBundles?: Record<string, unknown> } = { bundles: sync }
    const b1 = bundlesOf(ws).find((b) => b.id === 'b1')!
    ws = { ...ws, localBundles: withBundle(ws, { ...b1, name: 'Night Pack', items: [b1.items[1], refOf(items[2])] }) }
    expect(ws.localBundles).toEqual({ bundles: [{ id: 'b1', name: 'Night Pack', items: [{ shop_item_id: '21', name: 'Sky', type: 'nameplate' }, { type: 'avatar_decoration', key: 'home.png', name: 'Homemade' }] }] })
    const now = bundlesOf(ws).find((b) => b.id === 'b1')!
    expect(now).toMatchObject({ name: 'Night Pack', price: { display: 'X3' }, source: 'edited' })
    expect(sync.bundles[0].name).toBe('Night')
    // Moon left the bundle even though its own entry still names it; Homemade (no shop id) joined by file name.
    const index = bundleIndex(ws, items)
    expect(bundlesWith(items[0], index)).toEqual([])
    expect(bundlesWith(items[2], index).map((b) => b.id)).toEqual(['b1'])
    ws = { ...ws, localBundles: withBundle(ws, { ...now, name: 'Night', items: b1.items }) }
    expect(ws.localBundles).toEqual({ bundles: [] })
  })

  it('hides deleted synced bundles, drops deleted ones made here, and brings them back', () => {
    let ws: { bundles: Record<string, unknown>; localBundles?: Record<string, unknown> } = { bundles: sync }
    ws = { ...ws, localBundles: withBundle(ws, { id: 'local-1', name: 'Mine', items: [refOf(items[2])], source: 'local' }) }
    expect(bundlesOf(ws).map((b) => [b.id, b.source])).toEqual([['b1', 'sync'], ['b2', 'sync'], ['local-1', 'local']])
    ws = { ...ws, localBundles: withoutBundle(ws, 'b2') }
    ws = { ...ws, localBundles: withoutBundle(ws, 'local-1') }
    expect(ws.localBundles).toEqual({ bundles: [{ id: 'b2', deleted: true }] })
    expect(bundlesOf(ws).map((b) => b.id)).toEqual(['b1'])
    expect(deletedBundles(ws)).toEqual([{ id: 'b2', name: 'Day' }])
    ws = { ...ws, localBundles: revertBundle(ws, 'b2') }
    expect(bundlesOf(ws).map((b) => b.id)).toEqual(['b1', 'b2'])
  })

  it('reads and writes bundles.local.json beside bundles.json, leaving bundles.json alone', async () => {
    const local = { bundles: [{ id: 'b1', name: 'Renamed' }] }
    const { workspace: ws } = await readFolder([file('a/bundles.json', bundles, 2, true), file('a/bundles.local.json', local, 2, true), file('a/nameplates/metadata.json', nameplates), png('a/nameplates/sky.webm')])
    expect(ws.localBundles).toEqual(local)
    expect(bundlesOf(ws)[0].name).toBe('Renamed')
    const out = writeFolder(ws)
    expect(await out.find((f) => f.path === 'bundles.json')!.blob.text()).toBe(`${JSON.stringify(bundles, null, 2)}\n`)
    expect(await out.find((f) => f.path === 'bundles.local.json')!.blob.text()).toBe(`${JSON.stringify(local, null, 2)}\n`)
    expect(writeFolder({ ...ws, localBundles: { bundles: [] } }).some((f) => f.path === 'bundles.local.json')).toBe(false)
  })
})
