import { useSyncExternalStore } from 'react'
import { emptyWorkspace, type Entry, type Item, type Workspace } from '../format/workspace'

/**
 * The open workspace, kept in this browser (IndexedDB) as you work, so closing the tab loses nothing. Nothing leaves
 * the browser: exporting is a download or a write to a folder you pick.
 */

const DB = 'parley-profile-studio', STORE = 'workspace', KEY = 'current'

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => r.result.createObjectStore(STORE)
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}
async function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const d = await db()
  return new Promise((resolve, reject) => {
    const req = fn(d.transaction(STORE, mode).objectStore(STORE))
    req.onsuccess = () => resolve(req.result as T)
    req.onerror = () => reject(req.error)
  })
}

interface State { ws: Workspace; selected: string | null; loaded: boolean; saved: 'saved' | 'saving' | 'unsaved' | 'off' }
let state: State = { ws: emptyWorkspace(), selected: null, loaded: false, saved: 'saved' }
const listeners = new Set<() => void>()
const set = (next: Partial<State>) => { state = { ...state, ...next }; listeners.forEach((l) => l()) }
export const useStudio = () => useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l) } }, () => state, () => state)
export const getState = () => state

let timer: number | undefined
function persist() {
  set({ saved: 'unsaved' })
  window.clearTimeout(timer)
  timer = window.setTimeout(async () => {
    set({ saved: 'saving' })
    try { await idb('readwrite', (s) => s.put(state.ws, KEY)); set({ saved: 'saved' }) } catch { set({ saved: 'off' }) }
  }, 400)
}

/** The last workspace from this browser, when there is one. */
export async function restore() {
  try {
    const ws = await idb<Workspace | undefined>('readonly', (s) => s.get(KEY))
    if (ws?.items) set({ ws, selected: ws.items[0]?.uid ?? null })
  } catch { set({ saved: 'off' }) }
  set({ loaded: true })
}

export function replaceWorkspace(ws: Workspace) { set({ ws, selected: ws.items[0]?.uid ?? null }); persist() }
export function select(uid: string | null) { set({ selected: uid }) }

export function addItem(it: Item) { set({ ws: { ...state.ws, items: [...state.ws.items, it] }, selected: it.uid }); persist() }
export function removeItem(uid: string) {
  const items = state.ws.items.filter((i) => i.uid !== uid)
  set({ ws: { ...state.ws, items }, selected: state.selected === uid ? (items[0]?.uid ?? null) : state.selected }); persist()
}
export function updateItem(uid: string, fn: (it: Item) => Item) {
  set({ ws: { ...state.ws, items: state.ws.items.map((i) => (i.uid === uid ? fn(i) : i)) } }); persist()
}
export const patchEntry = (uid: string, patch: Partial<Entry>) => updateItem(uid, (it) => ({ ...it, entry: { ...it.entry, ...patch } }))
export function moveItem(uid: string, by: -1 | 1) {
  const items = [...state.ws.items]
  const i = items.findIndex((x) => x.uid === uid)
  // Within its kind: metadata.json order is the order Parley's pickers show.
  let j = i + by
  while (j >= 0 && j < items.length && items[j].kind !== items[i].kind) j += by
  if (i < 0 || j < 0 || j >= items.length) return
  ;[items[i], items[j]] = [items[j], items[i]]
  set({ ws: { ...state.ws, items } }); persist()
}
