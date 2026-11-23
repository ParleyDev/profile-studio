import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Workspace } from '../format/workspace'
import { planFolder, pushRow } from './folderSync'
import { ParleyError, remoteBundleFiles, type Conn, type RemoteItem } from './parley'
import { pulledItem } from './merge'
import { entryFieldChanges, planEntries } from './sync'

const conn: Conn = { base: 'https://parley.test', clientId: 'mcpc_x', tokenUrl: 'https://parley.test/oauth/token', access: 't0k', refresh: 'r', expires: Date.now() + 3_600_000 }
afterEach(() => vi.unstubAllGlobals())
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } })

const sync = { bundles: [{ id: 'b1', name: 'Night', items: [] }, { id: 'b2', name: 'Day', items: [] }] }
const ws = (over: Partial<Workspace> = {}): Workspace => ({ items: [], extras: { decoration: { source: 't', items: null, item_count: 2, collections: {}, tag_labels: ['Blue'] } }, bundles: sync, ...over })

describe('bundles and folder settings', () => {
  it('compares each bundle file and each kind\'s own fields', () => {
    const plan = planFolder(ws({ localBundles: { bundles: [{ id: 'b1', name: 'Mine' }] } }), {
      'bundles.json': { json: { bundles: [{ id: 'b1', name: 'Night', items: [] }, { id: 'b3', name: 'New', items: [] }] }, etag: 'e1' },
      'bundles.local.json': null,
    }, { decoration: { fields: { source: 't', item_count: 9, collections: { x: 1 }, tag_labels: ['Blue', 'Red'] }, etag: 'm1' }, nameplate: { fields: {}, etag: 'm2' } })
    const [bundles, local, meta] = plan.rows
    expect(bundles).toMatchObject({ root: 'bundles', status: 'differs', notes: ['1 only here', '1 only there'] })
    expect(local).toMatchObject({ root: 'localBundles', status: 'here' })
    // item_count and collections are worked out from items, so they never differ.
    expect(meta).toMatchObject({ kind: 'decoration', status: 'differs', notes: ['tag_labels'], changes: { tag_labels: ['Blue'] }, pulled: { tag_labels: ['Blue', 'Red'] } })
    expect(plan.rows).toHaveLength(3)
    // An empty bundles.local.json counts as none.
    expect(planFolder(ws({ localBundles: { bundles: [] } }), { 'bundles.json': { json: sync, etag: 'e' }, 'bundles.local.json': null }, {}).rows.map((r) => r.status)).toEqual(['same'])
  })

  it('pushes with the etag it compared against, deletes what\'s gone here, and reports a conflict', async () => {
    const calls: [string, string, string | null, string | null][] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      const h = new Headers(init.headers)
      calls.push([init.method ?? 'GET', new URL(url).pathname, h.get('If-Match') ?? h.get('If-None-Match'), typeof init.body === 'string' ? init.body : null])
      if (new URL(url).pathname.endsWith('bundles.local.json') && init.method === 'PUT') return json({ json: { bundles: [] }, etag: 'moved' }, 412)
      return init.method === 'DELETE' ? new Response(null, { status: 204 }) : json({ etag: 'new' })
    }))
    const plan = planFolder(ws({ localBundles: { bundles: [{ id: 'b1', name: 'Mine' }] } }), { 'bundles.json': { json: { bundles: [] }, etag: 'e1' }, 'bundles.local.json': { json: { bundles: [] }, etag: 'e2' } }, { decoration: { fields: { tag_labels: [] }, etag: 'm1' } })
    await pushRow(conn, plan.rows[0])
    const err = await pushRow(conn, plan.rows[1]).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ParleyError)
    expect((err as ParleyError).status).toBe(412)
    expect((err as ParleyError).current).toEqual({ json: { bundles: [] }, etag: 'moved' })
    await pushRow(conn, plan.rows[2])
    const gone = planFolder(ws({ bundles: undefined }), { 'bundles.json': { json: sync, etag: 'e9' }, 'bundles.local.json': null }, {})
    expect(gone.rows[0].status).toBe('there')
    await pushRow(conn, gone.rows[0])
    // No metadata.json there yet: written without a check.
    await pushRow(conn, planFolder(ws(), null, { decoration: { fields: {}, etag: null } }).rows[0])
    expect(calls).toEqual([
      ['PUT', '/api/admin/cosmetics/bundles/bundles.json', '"e1"', JSON.stringify(sync)],
      ['PUT', '/api/admin/cosmetics/bundles/bundles.local.json', '"e2"', JSON.stringify({ bundles: [{ id: 'b1', name: 'Mine' }] })],
      ['PATCH', '/api/admin/cosmetics/decoration/metadata', '"m1"', JSON.stringify({ fields: { source: 't', tag_labels: ['Blue'] } })],
      ['DELETE', '/api/admin/cosmetics/bundles/bundles.json', '"e9"', null],
      ['PATCH', '/api/admin/cosmetics/decoration/metadata', null, JSON.stringify({ fields: { source: 't', tag_labels: ['Blue'] } })],
    ])
  })

  it('knows an instance without the bundles API', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'Not found' }, 404)))
    expect(await remoteBundleFiles(conn)).toBeNull()
  })
})

describe('entry fields beyond the ones Parley handles', () => {
  const remote = (entry?: Record<string, unknown>): RemoteItem => ({ value: 'asset:moon', source: 'folder', name: 'Moon', description: '', enabled: true, deleted: false, data: { file: 'moon.png' }, users: 0, tags: [], entry })
  const item = { uid: 'm', kind: 'decoration' as const, entry: { file: 'moon.png', name: 'Moon', description: '', colors: ['blue'], themes: ['sci_fi'], price: null }, files: {} }

  it('sends what differs, null for what the open entry lacks, and only to instances that report the entry', () => {
    expect(entryFieldChanges(item.entry, { file: 'moon.png', name: 'Old', colors: ['blue'], themes: ['fantasy'], shop_item_id: '11', price: null })).toEqual({ themes: ['sci_fi'], shop_item_id: null })
    const [row] = planEntries([item], { decoration: [remote({ file: 'moon.png', name: 'Moon', description: '', colors: ['red'] })] })
    expect(row).toMatchObject({ action: 'update', meta: { fields: { colors: ['blue'], themes: ['sci_fi'] } } })
    expect(planEntries([item], { decoration: [remote()] })[0].action).toBe('same')
  })

  it('pulls the instance\'s entry fields, dropping ones it doesn\'t have', () => {
    const got = pulledItem('decoration', remote({ file: 'moon.png', name: 'Moon', colors: ['red'], collection_id: 'c1' }), {}, item)
    expect(got.entry).toEqual({ file: 'moon.png', name: 'Moon', description: '', colors: ['red'], collection_id: 'c1' })
  })
})
