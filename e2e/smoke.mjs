// End-to-end smoke test: open an assets folder → edit → make a new item → export the zip, then check the zip is an
// assets folder Parley imports. Every picture here is drawn by this script (never real people's media).
//
//   npm run e2e            (headless Chromium; `npx playwright install chromium` once)
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { readZip } from '../src/format/zip.ts'

const root = new URL('..', import.meta.url).pathname
const out = join(root, 'e2e/out')
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

// --- synthetic pictures -------------------------------------------------------------------------------------------
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td))
  return Buffer.concat([len, td, c])
}
/** A w×h RGBA PNG: a coloured ring with a see-through middle. */
function png(w, h, [r, g, b]) {
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const d = Math.hypot(x - w / 2, y - h / 2) / (Math.min(w, h) / 2)
    const i = y * (w * 4 + 1) + 1 + x * 4
    raw.set([r, g, b, d > 0.75 && d < 1 ? 255 : 0], i)
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr.set([8, 6, 0, 0, 0], 8)
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

// --- an assets folder to open ---------------------------------------------------------------------------------------
const assets = join(out, 'assets')
const write = (p, data) => { mkdirSync(join(assets, p, '..'), { recursive: true }); writeFileSync(join(assets, p), data) }
write('avatar-decorations/blue_ring.png', png(256, 256, [60, 120, 255]))
write('avatar-decorations/metadata.json', `${JSON.stringify({ item_count: 1, items: [{ file: 'blue_ring.png', name: 'Blue Ring', description: 'A ring.', vendor_field: 'kept' }] }, null, 1)}\n`)
write('profile-effects/sparkle/layer_01.png', png(1200, 400, [255, 200, 40]))
write('profile-effects/sparkle/static.png', png(1200, 400, [255, 200, 40]))
write('profile-effects/metadata.json', `${JSON.stringify({ items: [{ folder: 'sparkle', name: 'Sparkle', description: '', layers: [{ file: 'layer_01.png', start_ms: 0, duration_ms: 2000, loop: true, loop_delay_ms: 0, z_index: 100 }] }] }, null, 1)}\n`)
const framePic = join(out, 'front_staple_top.png')
writeFileSync(framePic, png(1312, 304, [200, 60, 160]))

// --- run it -------------------------------------------------------------------------------------------------------
const server = await createServer({ root, logLevel: 'error', server: { port: 0 } })
await server.listen()
const url = server.resolvedUrls.local[0]
const browser = await chromium.launch()
const failures = []
const check = (ok, what) => { console.log(`${ok ? '✓' : '✗'} ${what}`); if (!ok) failures.push(what) }
try {
  const page = await browser.newPage({ acceptDownloads: true })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('dialog', (d) => d.accept())
  await page.goto(url)
  await page.locator('[data-welcome]').waitFor()

  await page.locator('[data-open-folder-input]').setInputFiles(assets)
  await page.locator('[data-row-key="blue_ring.png"]').waitFor()
  check(await page.locator('[data-row-key="sparkle"]').count() === 1, 'opened folder lists the decoration and the effect')

  // Edit the decoration.
  await page.locator('[data-row-key="blue_ring.png"]').click()
  await page.locator('[data-item-name]').fill('Bluer Ring')
  check(await page.locator('[data-item-title]').textContent() === 'Bluer Ring', 'renaming shows in the editor')

  // A new frame from a dropped-in picture.
  await page.locator('[data-new]').click()
  await page.locator('[data-new-kind="frame"]').click()
  await page.locator('[data-item-name]').fill('Pink Staple')
  await page.locator('[data-item-add-files] input[type=file]').setInputFiles(framePic)
  await page.locator('[data-layer="0"]').waitFor()
  check(await page.locator('[data-layer-frame="anchor"]').inputValue() === 'top', 'frame layer placed from its file name')
  await page.screenshot({ path: join(out, 'frame.png'), fullPage: true })

  const badges = await page.locator('[data-badge-error]').count()
  check(badges === 0, `no errors in the sidebar (${badges})`)

  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('[data-export]').click()])
  check(dl.suggestedFilename() === 'parley-assets.zip', 'export is parley-assets.zip')
  const zipPath = join(out, 'parley-assets.zip')
  await dl.saveAs(zipPath)

  const files = new Map((await readZip(new Blob([readFileSync(zipPath)]))).map((f) => [f.path, f.blob]))
  const json = async (p) => JSON.parse(await files.get(p).text())
  check(['avatar-decorations/blue_ring.png', 'profile-effects/sparkle/layer_01.png', 'profile-effects/sparkle/static.png', 'profile-frames/new_frame_1/front_staple_top.png'].every((p) => files.has(p)), 'zip has every file')
  const deco = await json('avatar-decorations/metadata.json')
  check(deco.items[0].name === 'Bluer Ring' && deco.items[0].vendor_field === 'kept' && deco.item_count === 1, 'decoration edited, unknown fields and item_count kept')
  const raw = await files.get('avatar-decorations/metadata.json').text()
  check(raw.startsWith('{\n "') && raw.endsWith('}\n'), 'metadata.json uses one-space indent and a trailing newline')
  const frame = (await json('profile-frames/metadata.json')).items[0]
  check(frame.folder === 'new_frame_1' && frame.layout?.inner_width === 1200 && frame.layers[0].type === 'staple', 'new frame written with layout and layer')

  // Autosave: a reload brings the work back.
  await page.waitForSelector('[data-saved="saved"]')
  await page.reload()
  await page.locator('[data-row-key="new_frame_1"]').waitFor()
  check(true, 'work restored after reload')
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join('; ')}` : ''}`)
} finally {
  await browser.close()
  await server.close()
}
if (failures.length) { console.error(`\n${failures.length} failed`); process.exit(1) }
console.log('\nall passed')
