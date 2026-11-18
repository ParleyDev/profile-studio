import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Item } from '../format/workspace'
import { cleanBase, type Conn } from './parley'
import { plan, publish } from './sync'

const png = (s: string) => new Blob([s], { type: 'image/png' })
const conn: Conn = { base: 'https://parley.test', clientId: 'mcpc_x', tokenUrl: 'https://parley.test/oauth/token', access: 't0k', refresh: 'r', expires: Date.now() + 3_600_000 }

/** A pretend instance: the admin list and file routes, recording what was sent. */
function fakeParley() {
  const files: Record<string, string> = { '/api/assets/avatar-decorations/ring': 'old ring', '/api/assets/profile-effects/snow/layer_01.png': 'snow 1' }
  const lists: Record<string, unknown[]> = {
    decoration: [
      { value: 'asset:ring', source: 'folder', name: 'Ring', description: '', enabled: true, deleted: false, data: { file: 'ring.png' }, users: 3 },
      { value: 'heart', source: 'builtin', name: null, description: null, enabled: true, deleted: false, data: {}, users: 0 },
    ],
    nameplate: [],
    effect: [{ value: 'asset:snow', source: 'folder', name: 'Snow', description: 'Flakes', enabled: true, deleted: false, data: { layers: [{ file: 'layer_01.png', start_ms: 0, duration_ms: 3000, loop: true, loop_delay_ms: 0, z_index: 100, width: 900, height: 1760 }] }, users: 0 }],
    frame: [],
  }
  const sent: { method: string; path: string; json: unknown; files: string[] }[] = []
  const fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } })
    if (path.startsWith('/api/admin/') && new Headers(init.headers).get('authorization') !== 'Bearer t0k') return json({ error: 'Unauthorized' }, 401)
    const m = path.match(/^\/api\/admin\/cosmetics\/(\w+)$/)
    if (m) return json(lists[m[1]])
    if (files[path] !== undefined) return new Response(files[path], { headers: { 'content-type': 'image/png' } })
    if (path.startsWith('/api/assets/')) return json({ error: 'Not found' }, 404)
    if (init.body instanceof FormData) {
      const body = init.body
      const field = body.get('entry') ?? body.get('meta')
      sent.push({ method: init.method ?? 'GET', path, json: JSON.parse(String(field)), files: body.getAll('file').map((f) => (f as File).name) })
      return json({ value: 'asset:x' }, init.method === 'POST' ? 201 : 200)
    }
    return json({ error: 'No route' }, 404)
  })
  return { fetch, sent }
}

afterEach(() => vi.unstubAllGlobals())

describe('publishing to Parley', () => {
  it('adds new items, updates changed ones, skips the same and blocks unsafe names', async () => {
    const p = fakeParley()
    vi.stubGlobal('fetch', p.fetch)
    const items: Item[] = [
      { uid: 'a', kind: 'decoration', entry: { file: 'ring.png', name: 'Ring', description: '' }, files: { 'ring.png': png('new ring') } },
      { uid: 'b', kind: 'decoration', entry: { file: 'star.png', name: 'Star' }, files: { 'star.png': png('star') } },
      { uid: 'c', kind: 'effect', entry: { folder: 'snow', name: 'Snow', description: 'Flakes', layers: [{ file: 'layer_01.png', start_ms: 0, duration_ms: 3000, loop: true, loop_delay_ms: 0, z_index: 100 }] }, files: { 'layer_01.png': png('snow 1') } },
      { uid: 'd', kind: 'nameplate', entry: { file: 'Rooftop (1).webm', name: 'Rooftop' }, files: { 'Rooftop (1).webm': new Blob(['v']) } },
    ]
    const renamed: Item = { ...items[2], uid: 'e', entry: { ...items[2].entry, name: 'Snowier' } }
    const rows = await plan(conn, items, () => {})
    const by = Object.fromEntries(rows.map((r) => [r.item.uid, r]))
    expect(by.a.action).toBe('update')
    expect(by.a.files).toEqual(['ring.png'])
    expect(by.b.action).toBe('add')
    expect(by.c.action).toBe('same')
    expect(by.d.action).toBe('blocked')

    // A changed name on the effect is an update with only that field.
    const again = await plan(conn, [renamed], () => {})
    expect(again[0].action).toBe('update')
    expect(again[0].meta).toEqual({ name: 'Snowier' })
    expect(again[0].files).toEqual([])

    const out = await publish(conn, [by.a, by.b, again[0]], () => {})
    expect(out.every((o) => o.ok)).toBe(true)
    expect(p.sent).toEqual([
      { method: 'PATCH', path: '/api/admin/cosmetics/decoration/folder/ring', json: {}, files: ['ring.png'] },
      { method: 'POST', path: '/api/admin/cosmetics/decoration/import', json: { file: 'star.png', name: 'Star' }, files: ['star.png'] },
      { method: 'PATCH', path: '/api/admin/cosmetics/effect/folder/snow', json: { name: 'Snowier' }, files: [] },
    ])
  })

  it('reports a refused publish per item and keeps going', async () => {
    const p = fakeParley()
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => (init?.method === 'POST' ? new Response(JSON.stringify({ error: 'star.png is already in the assets folder' }), { status: 409, headers: { 'content-type': 'application/json' } }) : p.fetch(url, init))))
    const items: Item[] = [
      { uid: 'b', kind: 'decoration', entry: { file: 'star.png', name: 'Star' }, files: { 'star.png': png('star') } },
      { uid: 'a', kind: 'decoration', entry: { file: 'ring.png', name: 'Ring 2' }, files: { 'ring.png': png('old ring') } },
    ]
    const rows = await plan(conn, items, () => {})
    const out = await publish(conn, rows, () => {})
    expect(out.map((o) => [o.ok, o.error])).toEqual([[false, 'star.png is already in the assets folder'], [true, undefined]])
  })

  it('cleans instance addresses', () => {
    expect(cleanBase('parley.example.com/')).toBe('https://parley.example.com')
    expect(cleanBase('https://p.example/api/v1')).toBe('https://p.example')
    expect(cleanBase('localhost:3000')).toBe('http://localhost:3000')
  })
})
