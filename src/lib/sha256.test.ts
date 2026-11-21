import { describe, expect, it } from 'vitest'
import { hex, sha256Plain } from './sha256'

const subtle = async (d: Uint8Array) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', d as Uint8Array<ArrayBuffer>)))

describe('sha256 without crypto.subtle', () => {
  it('matches the browser\'s for every length around the block edges, and a big buffer', async () => {
    expect(hex(sha256Plain(new TextEncoder().encode('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    for (const n of [0, 1, 3, 55, 56, 63, 64, 65, 119, 120, 127, 128, 1000, 3 * 1024 * 1024 + 7]) {
      const data = new Uint8Array(n).map((_, i) => (i * 31 + 7) & 255)
      expect(hex(sha256Plain(data)), `length ${n}`).toBe(await subtle(data))
    }
    // A view into a bigger buffer hashes only its own bytes.
    const big = new Uint8Array(200).map((_, i) => i)
    expect(hex(sha256Plain(big.subarray(10, 150)))).toBe(await subtle(big.slice(10, 150)))
  })
})
