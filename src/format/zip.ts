import type { FolderFile } from './workspace'

/*
 * Just enough zip for an assets folder: writing stores files as they are (pictures and videos are compressed
 * already), reading takes stored and deflated entries, which is what every zip tool makes by default.
 */

const CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 }
  return t
})()
export function crc32(data: Uint8Array) {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = CRC[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** DOS date and time for the entries' timestamps. */
function dosTime(d: Date) {
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() }
}

export async function writeZip(files: FolderFile[], when = new Date()): Promise<Blob> {
  const enc = new TextEncoder()
  const { time, date } = dosTime(when)
  const parts: BlobPart[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const f of files) {
    const name = enc.encode(f.path)
    const data = new Uint8Array(await f.blob.arrayBuffer())
    const crc = crc32(data)
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); local.setUint16(8, 0, true)
    local.setUint16(10, time, true); local.setUint16(12, date, true); local.setUint32(14, crc, true)
    local.setUint32(18, data.length, true); local.setUint32(22, data.length, true); local.setUint16(26, name.length, true); local.setUint16(28, 0, true)
    parts.push(local.buffer, name, data)
    const c = new DataView(new ArrayBuffer(46))
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true)
    c.setUint16(12, time, true); c.setUint16(14, date, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true)
    c.setUint16(28, name.length, true); c.setUint32(38, 0o100644 << 16, true); c.setUint32(42, offset, true)
    const entry = new Uint8Array(46 + name.length); entry.set(new Uint8Array(c.buffer)); entry.set(name, 46)
    central.push(entry)
    offset += 30 + name.length + data.length
  }
  const size = central.reduce((s, c) => s + c.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true)
  end.setUint32(12, size, true); end.setUint32(16, offset, true)
  return new Blob([...parts, ...central.map((c) => c.slice().buffer), end.buffer], { type: 'application/zip' })
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data.slice().buffer]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** Every file in a zip (folders skipped), by its path inside it. */
export async function readZip(zip: Blob): Promise<FolderFile[]> {
  const buf = new Uint8Array(await zip.arrayBuffer())
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let end = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) if (v.getUint32(i, true) === 0x06054b50) { end = i; break }
  if (end < 0) throw new Error('This isn\'t a zip file.')
  const count = v.getUint16(end + 10, true)
  let p = v.getUint32(end + 16, true)
  const dec = new TextDecoder()
  const out: FolderFile[] = []
  for (let i = 0; i < count; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('This zip is damaged.')
    const method = v.getUint16(p + 10, true), csize = v.getUint32(p + 20, true)
    const nlen = v.getUint16(p + 28, true), xlen = v.getUint16(p + 30, true), clen = v.getUint16(p + 32, true)
    const local = v.getUint32(p + 42, true)
    const path = dec.decode(buf.subarray(p + 46, p + 46 + nlen))
    p += 46 + nlen + xlen + clen
    if (path.endsWith('/')) continue
    if (csize === 0xffffffff) throw new Error('Zips over 4 GB aren\'t supported.')
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true)
    const raw = buf.subarray(start, start + csize)
    if (method === 0) out.push({ path, blob: new Blob([raw.slice().buffer]) })
    else if (method === 8) out.push({ path, blob: new Blob([(await inflate(raw)).slice().buffer]) })
    else throw new Error(`${path} uses a compression this can't read.`)
  }
  return out
}
