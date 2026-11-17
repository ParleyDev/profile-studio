import { describe, expect, it } from 'vitest'
import { assetId, newFrameLayer, okFileName, okFolderName, safeFileName } from './kinds'
import { validateItem } from './validate'
import { metadataJson, readFolder, writeFolder, type FolderFile } from './workspace'
import { readZip, writeZip } from './zip'

const png = (n = 8) => new Blob([new Uint8Array(n).fill(1)], { type: 'image/png' })
const json = (v: unknown) => new Blob([JSON.stringify(v)], { type: 'application/json' })

const folder = (): FolderFile[] => [
  { path: 'assets/avatar-decorations/metadata.json', blob: json({ item_count: 9, items: [{ file: 'Halo.png', name: 'Halo', description: 'Shiny', sku_id: '123' }, { file: 'gone.png', name: 'Gone' }] }) },
  { path: 'assets/avatar-decorations/Halo.png', blob: png() },
  { path: 'assets/avatar-decorations/loose.webp', blob: png() },
  { path: 'assets/profile-effects/metadata.json', blob: json({ items: [{ folder: 'rain', name: 'Rain', layers: [{ file: 'layer_01.png', start_ms: 0, duration_ms: 1000, loop: true, loop_delay_ms: 0, z_index: 100 }] }] }) },
  { path: 'assets/profile-effects/rain/layer_01.png', blob: png() },
  { path: 'assets/profile-effects/rain/static.png', blob: png() },
  { path: 'assets/profile-frames/metadata.json', blob: json({ items: [{ folder: 'vines', name: 'Vines', layout: { inner_width: 1200, overflow_top: 304, overflow_bottom: 0, overflow_horizontal: 56 }, layers: [{ file: 'front_staple_top.png', order: 'front', type: 'staple', anchor: 'top' }] }] }) },
  { path: 'assets/profile-frames/vines/front_staple_top.png', blob: png() },
  { path: 'assets/.DS_Store', blob: png() },
  { path: 'assets/nameplates/__MACOSX/x.png', blob: png() },
]

describe('Parley\'s naming rules', () => {
  it('match the server\'s', () => {
    expect(okFileName('effect', 'layer_01.png')).toBe(true)
    expect(okFileName('effect', '../x.png')).toBe(false)
    expect(okFileName('effect', '.hidden.png')).toBe(false)
    expect(okFileName('effect', 'clip.webm')).toBe(false)
    expect(okFileName('nameplate', 'clip.webm')).toBe(true)
    expect(okFolderName('alt_raccoon')).toBe(true)
    expect(okFolderName('a b')).toBe(false)
    expect(assetId('A Hint Of Clove.PNG', 'decoration')).toBe('a_hint_of_clove')
    expect(assetId('Rain.Drops', 'effect')).toBe('rain_drops')
    expect(safeFileName('My cool pic!.png')).toBe('My_cool_pic_.png')
  })
  it('read layer placement from Discord\'s file names', () => {
    expect(newFrameLayer('back_rail_center.png')).toMatchObject({ order: 'back', type: 'rail', anchor: 'center' })
    expect(newFrameLayer('front_staple_bottom.png')).toMatchObject({ order: 'front', type: 'staple', anchor: 'bottom' })
  })
})

describe('an assets folder', () => {
  it('reads every kind, keeps unknown fields, and reports what Parley would skip', async () => {
    const { workspace: ws, notes } = await readFolder(folder())
    expect(ws.items.map((i) => `${i.kind}:${i.entry.file ?? i.entry.folder}`)).toEqual(['decoration:Halo.png', 'decoration:gone.png', 'decoration:loose.webp', 'effect:rain', 'frame:vines'])
    expect(ws.items[0].entry.sku_id).toBe('123')
    expect(Object.keys(ws.items[3].files).sort()).toEqual(['layer_01.png', 'static.png'])
    expect(notes.some((n) => n.includes('gone.png'))).toBe(true)
    expect(notes.some((n) => n.includes('loose.webp'))).toBe(true)
  })
  it('writes metadata.json the way Parley does', async () => {
    const { workspace: ws } = await readFolder(folder())
    const text = metadataJson(ws, 'decoration')
    expect(text.endsWith('\n')).toBe(true)
    expect(text).toContain('\n "items": [')
    expect(JSON.parse(text).item_count).toBe(3)
  })
  it('round-trips through a zip', async () => {
    const { workspace: ws } = await readFolder(folder())
    const zip = await writeZip(writeFolder(ws))
    const back = await readFolder(await readZip(zip))
    expect(back.workspace.items.map((i) => i.entry)).toEqual(ws.items.map((i) => i.entry))
    expect(Object.keys(back.workspace.items[3].files).sort()).toEqual(['layer_01.png', 'static.png'])
  })
  it('reads zips other tools deflated', async () => {
    const data = new TextEncoder().encode('{"items":[]}'.repeat(50))
    const deflated = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer())
    const stored = await writeZip([{ path: 'nameplates/metadata.json', blob: new Blob([data]) }])
    // Same zip with the entry deflated: patch the method and sizes, swap the data.
    const b = new Uint8Array(await stored.arrayBuffer())
    const v = new DataView(b.buffer)
    const nameLen = v.getUint16(26, true)
    const local = new Uint8Array(30 + nameLen); local.set(b.subarray(0, 30 + nameLen))
    const lv = new DataView(local.buffer); lv.setUint16(8, 8, true); lv.setUint32(18, deflated.length, true)
    const cStart = 30 + nameLen + data.length
    const central = new Uint8Array(b.subarray(cStart, b.length - 22)); const cv = new DataView(central.buffer)
    cv.setUint16(10, 8, true); cv.setUint32(20, deflated.length, true)
    const end = new Uint8Array(b.subarray(b.length - 22)); const ev = new DataView(end.buffer)
    ev.setUint32(16, local.length + deflated.length, true)
    const files = await readZip(new Blob([local, deflated, central, end]))
    expect(await files[0].blob.text()).toBe('{"items":[]}'.repeat(50))
  })
})

describe('checks', () => {
  it('catch what Parley would refuse', async () => {
    const { workspace: ws } = await readFolder(folder())
    expect(validateItem(ws.items[0], ws).filter((p) => p.level === 'error')).toEqual([])
    expect(validateItem(ws.items[1], ws).map((p) => p.message)).toContain('Its file is missing.')
    expect(validateItem(ws.items[2], ws).map((p) => p.message)).toContain('It needs a name.')
    const fx = ws.items[3]
    expect(validateItem(fx, ws).filter((p) => p.level === 'error')).toEqual([])
    fx.entry.layers = [{ file: 'nope.png', start_ms: -1, duration_ms: 1000, loop: true, loop_delay_ms: 0, z_index: 100 }]
    const msgs = validateItem(fx, ws).map((p) => p.message)
    expect(msgs.some((m) => m.includes('nope.png isn\'t in the folder'))).toBe(true)
    expect(msgs.some((m) => m.includes('start_ms'))).toBe(true)
    expect(msgs.some((m) => m.includes('layer_01.png is in the folder but no layer uses it'))).toBe(true)
  })
  it('catch two items Parley would give one id', async () => {
    const { workspace: ws } = await readFolder(folder())
    ws.items[2].entry.file = 'HALO.webp'
    ws.items[2].files = { 'HALO.webp': png() }
    expect(validateItem(ws.items[2], ws).some((p) => p.message.includes('same id'))).toBe(true)
  })
  it('flag pictures that aren\'t the right shape', async () => {
    const { workspace: ws } = await readFolder(folder())
    expect(validateItem(ws.items[0], ws, { 'Halo.png': { w: 300, h: 200 } }).some((p) => p.level === 'warning' && p.message.includes('square'))).toBe(true)
  })
})
