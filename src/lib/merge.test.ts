import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Item } from '../format/workspace'
import { planMerge, planPull, pulledItem, remoteFiles } from './merge'
import type { Conn, RemoteItem } from './parley'

const png = (s: string) => new Blob([s], { type: 'image/png' })
const conn: Conn = { base: 'https://parley.test', clientId: 'mcpc_x', tokenUrl: 'https://parley.test/oauth/token', access: 't0k', refresh: 'r', expires: Date.now() + 3_600_000 }

afterEach(() => vi.unstubAllGlobals())

describe('merging items in', () => {
  const open: Item[] = [
    { uid: 'a', kind: 'decoration', entry: { file: 'Foo Bar.png', name: 'Foo', description: 'x', vendor: 1 }, files: { 'Foo Bar.png': png('foo') } },
    { uid: 'b', kind: 'decoration', entry: { file: 'same.png', name: 'Same' }, files: { 'same.png': png('same') } },
    { uid: 'c', kind: 'effect', entry: { folder: 'snow', name: 'Snow', layers: [{ file: 'l.png', z_index: 1 }] }, files: { 'l.png': png('l') } },
  ]
  it('sorts incoming items into new, changed, same and left out, matching ids the way Parley does', async () => {
    const incoming: Item[] = [
      { uid: 'x1', kind: 'decoration', entry: { name: 'Foo', description: 'x', file: 'foo_bar.png' }, files: { 'foo_bar.png': png('foo 2') } },
      // Same content, keys in another order.
      { uid: 'x2', kind: 'decoration', entry: { name: 'Same', file: 'same.png' }, files: { 'same.png': png('same') } },
      { uid: 'x3', kind: 'decoration', entry: { file: 'new.png', name: 'New' }, files: { 'new.png': png('n') } },
      { uid: 'x4', kind: 'decoration', entry: { file: 'NEW.webp', name: 'Again' }, files: { 'NEW.webp': png('n') } },
      { uid: 'x5', kind: 'effect', entry: { folder: 'snow', name: 'Snow', layers: [{ file: 'l.png', z_index: 2 }] }, files: { 'l.png': png('l'), 'static.png': png('s') } },
      { uid: 'x6', kind: 'nameplate', entry: { file: '', name: 'Nameless' }, files: {} },
    ]
    const rows = await planMerge(open, { c: {} }, incoming)
    const by = Object.fromEntries(rows.map((r) => [r.incoming.uid, r]))
    expect(by.x1.action).toBe('changed')
    expect(by.x1.local?.uid).toBe('a')
    expect(by.x1.notes).toEqual(['file name: Foo Bar.png → foo_bar.png', 'new file: foo_bar.png', 'removed: Foo Bar.png'])
    expect(by.x1.incoming.entry.vendor).toBe(1)
    expect(by.x2.action).toBe('same')
    expect(by.x3.action).toBe('new')
    expect(by.x4.action).toBe('skip')
    expect(by.x5).toMatchObject({ action: 'changed', draft: true, notes: ['layers', 'new file: static.png'] })
    expect(by.x6.action).toBe('skip')
  })
})

describe('pulling from Parley', () => {
  const ring: RemoteItem = { value: 'asset:ring', source: 'folder', name: 'Ring', description: 'Shiny', enabled: true, deleted: false, data: { file: 'ring.webp' }, users: 0 }
  const snow: RemoteItem = {
    value: 'asset:snow', source: 'folder', name: 'Snow', description: null, enabled: true, deleted: false, users: 0,
    data: { layers: [{ file: 'a.png', z_index: 3, width: 900, height: 100, random_variants: ['b.png'] }], still: 'static.png', thumbnail: null } as RemoteItem['data'],
  }

  it('lists the files an item uses', () => {
    expect(remoteFiles('decoration', ring)).toEqual(['ring.webp'])
    expect(remoteFiles('effect', snow)).toEqual(['a.png', 'b.png', 'static.png'])
  })

  it('builds on the open item: its other fields and folder spelling stay, pixel sizes are dropped', () => {
    const local: Item = { uid: 'l', kind: 'effect', entry: { folder: 'Snow', name: 'Snow', in_shop: true, layers: [{ file: 'a.png', z_index: 1, custom: 7 }] }, files: {} }
    const it = pulledItem('effect', snow, { 'a.png': png('a') }, local)
    expect(it.uid).toBe('l')
    expect(it.entry).toEqual({ folder: 'Snow', name: 'Snow', in_shop: true, layers: [{ file: 'a.png', z_index: 3, custom: 7, random_variants: ['b.png'] }] })
    expect(pulledItem('effect', { ...snow, tags: ['Winter', 'snow'] }, {}, local).entry.tags).toEqual(['winter', 'snow'])
    expect(pulledItem('effect', { ...snow, tags: [] }, {}, { ...local, entry: { ...local.entry, tags: ['old'] } }).entry.tags).toBeUndefined()
    expect(pulledItem('effect', snow, {}, { ...local, entry: { ...local.entry, tags: ['kept'] } }).entry.tags).toEqual(['kept'])
    expect(pulledItem('effect', { ...snow, tags: null }, {}, { ...local, entry: { ...local.entry, tags: ['old'] } }).entry.tags).toBeUndefined()
    const fresh = pulledItem('decoration', ring, { 'ring.webp': new Blob(['r']) })
    expect(fresh.entry).toEqual({ file: 'ring.webp', name: 'Ring', description: 'Shiny' })
    expect(fresh.files['ring.webp'].type).toBe('image/webp')
  })

  it('downloads the instance\'s items and compares them with the open ones', async () => {
    const lists: Record<string, unknown[]> = {
      decoration: [ring, { ...ring, value: 'asset:gone', deleted: true }, { value: 'heart', source: 'builtin', name: null, description: null, enabled: true, deleted: false, data: {}, users: 0 }],
      nameplate: [], effect: [snow], frame: [],
    }
    const files: Record<string, string> = { '/api/assets/avatar-decorations/ring': 'ring', '/api/assets/profile-effects/snow/a.png': 'a', '/api/assets/profile-effects/snow/b.png': 'b' }
    const fetched: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const path = new URL(url).pathname
      fetched.push(path)
      const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } })
      const m = path.match(/^\/api\/admin\/cosmetics\/(\w+)$/)
      if (m) return json(lists[m[1]])
      if (files[path] !== undefined) return new Response(files[path], { headers: { 'content-type': 'image/png' } })
      return json({ error: 'Not found' }, 404)
    }))
    const open: Item[] = [{ uid: 'o', kind: 'decoration', entry: { file: 'ring.webp', name: 'Ring', description: 'Shiny' }, files: { 'ring.webp': png('ring') } }]
    const { rows, notes } = await planPull(conn, open, {}, () => {})
    expect(rows.map((r) => [r.id, r.action])).toEqual([['ring', 'same']])
    expect(notes).toEqual(['1 item deleted in Parley is left out.', 'Snow: some of its files couldn\'t be downloaded, so it\'s left out.'])
    expect(fetched).toContain('/api/assets/profile-effects/snow/static.png')
  })
})
