import { ChevronDown, ChevronLeft, ChevronRight, CloudUpload, Download, FilePen, Save, Undo2, FolderOpen, FolderOutput, Info, LayoutGrid, Plus, Settings as Gear, Shapes, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import Gallery from './components/Gallery'
import Loading, { SaveStatus } from './components/Loading'
import Bundles from './components/Bundles'
import Merge, { type MergeSource } from './components/Merge'
import Publish from './components/Publish'
import Settings from './components/Settings'
import Templates from './components/Templates'
import Sidebar, { openOnly, visibleItems, type Nav } from './components/Sidebar'
import ItemEditor, { ItemHeader } from './editors/ItemEditor'
import { DEFAULT_LAYOUT, KIND_LABELS, KINDS, layered, type Kind } from './format/kinds'
import { validateWorkspace } from './format/validate'
import { allTags } from './format/tags'
import { bundlesOf } from './format/shop'
import { keyOf, newUid, readFolder, type Entry, type FolderFile, type Item, type Workspace } from './format/workspace'
import { canSaveToFolder, exportZip, fromDrop, fromInput, fromZip, saveToFolder } from './lib/io'
import { useRules } from './lib/settings'
import { planMerge, planPull, rememberPulled, type MergeRow } from './lib/merge'
import type { Conn } from './lib/parley'
import { addItem, clearMarks, discardDraft, getState, isNewDraft, replaceWorkspace, restore, saveDraft, select, setBusy, useStudio } from './lib/store'

/** A new, empty item of a kind; effects and frames get a folder name nothing else of their kind uses. */
function newItem(kind: Kind): Item {
  const entry: Entry = layered(kind) ? { folder: '', name: '', description: '', layers: [] } : { file: '', name: '', description: '' }
  if (layered(kind)) {
    const taken = new Set([...getState().ws.items, ...Object.values(getState().drafts)].filter((i) => i.kind === kind).map(keyOf))
    let n = 1
    while (taken.has(`new_${kind}_${n}`)) n++
    entry.folder = `new_${kind}_${n}`
  }
  if (kind === 'frame') entry.layout = { ...DEFAULT_LAYOUT }
  return { uid: newUid(), kind, entry, files: {} }
}

// Where the arrow keys belong to the field: text boxes, sliders, lists. A checkbox or button doesn't use them.
const NO_KEYS = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file', 'image'])
const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ['TEXTAREA', 'SELECT'].includes(t.tagName) || (t instanceof HTMLInputElement && !NO_KEYS.has(t.type)))

interface MergeAsk {
  title: string
  from: string
  load: (onProgress: (label: string, done: number, total: number) => void, signal: AbortSignal) => Promise<MergeSource>
  onReplace?: () => void
  after?: (rows: MergeRow[]) => Promise<void>
}

export default function App() {
  const { ws, drafts, marks, selected, loaded, saved, saving, saveError, busy } = useStudio()
  const [merge, setMerge] = useState<MergeAsk | null>(null)
  const [notes, setNotes] = useState<string[]>([])
  const [dragging, setDragging] = useState(false)
  // Browsers don't reliably say when a drag ends: Esc, leaving the window, or dropping on a drop box inside the page
  // can all skip dragleave here. While a drag is over the page dragover fires every ~50 ms, so the overlay stays only
  // while those keep coming.
  const dragTimer = useRef<number | undefined>(undefined)
  const dragOver = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    setDragging(true)
    window.clearTimeout(dragTimer.current)
    dragTimer.current = window.setTimeout(() => setDragging(false), 250)
  }
  useEffect(() => {
    const stop = () => { window.clearTimeout(dragTimer.current); setDragging(false) }
    window.addEventListener('drop', stop, true)
    window.addEventListener('dragend', stop, true)
    return () => { stop(); window.removeEventListener('drop', stop, true); window.removeEventListener('dragend', stop, true) }
  }, [])
  const [newOpen, setNewOpen] = useState(false)
  const [nav, setNav] = useState<Nav>({ query: '', filter: 'all', collapsed: openOnly(null) })
  const [gallery, setGalleryRaw] = useState<Kind | null>(null)
  /** A page over the items: Settings or Templates. */
  const [page, setPage] = useState<'settings' | 'templates' | 'publish' | 'bundles' | null>(null)
  // The bundle open on the Bundles page (null: all of them).
  const [bundle, setBundle] = useState<string | null>(null)
  const showBundles = useCallback((id: string | null = null) => { setBundle(id); setPage('bundles') }, [])
  const setGallery = useCallback((k: Kind | null) => { setGalleryRaw(k); setPage(null) }, [])
  const rules = useRules()
  const folderInput = useRef<HTMLInputElement>(null)
  const zipInput = useRef<HTMLInputElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const problems = useMemo(() => validateWorkspace(ws, rules), [ws, rules])
  const shown = useMemo(() => visibleItems(ws.items, problems, nav, marks), [ws.items, problems, nav, marks])
  const tagList = useMemo(() => allTags(ws.items), [ws.items])
  const bundleCount = useMemo(() => bundlesOf(ws).length, [ws])
  const totals = useMemo(() => new Map(KINDS.map((k) => [k, ws.items.filter((i) => i.kind === k).length])), [ws.items])
  const item = (selected && drafts[selected]) || ws.items.find((i) => i.uid === selected) || null
  const draftList = Object.values(drafts)
  const [draftsOpen, setDraftsOpen] = useState(false)
  const errors = useMemo(() => [...problems.values()].reduce((n, l) => n + l.filter((p) => p.level === 'error').length, 0), [problems])

  // The order ↑/↓ and the prev/next buttons walk: what the search and filter leave, closed groups included (stepping
  // into one opens it, closing the rest). An item the filter hides walks the whole list instead, so the arrows still go.
  const filteredWalk = useMemo(() => KINDS.flatMap((k) => shown.get(k)!), [shown])
  const fullWalk = useMemo(() => KINDS.flatMap((k) => ws.items.filter((i) => i.kind === k)), [ws.items])
  const inFiltered = !!item && filteredWalk.some((i) => i.uid === item.uid)
  const walk = item && !inFiltered && fullWalk.some((i) => i.uid === item.uid) ? fullWalk : filteredWalk
  const at = item ? walk.findIndex((i) => i.uid === item.uid) : -1
  const sameKind = item ? walk.filter((i) => i.kind === item.kind) : []
  const atKind = item ? sameKind.findIndex((i) => i.uid === item.uid) : -1

  const open = useCallback((uid: string) => {
    select(uid); setGallery(null)
    const kind = (getState().drafts[uid] ?? getState().ws.items.find((i) => i.uid === uid))?.kind
    setNav((n) => (!kind || !n.collapsed.has(kind) ? n : { ...n, collapsed: openOnly(kind) }))
  }, [setGallery])
  const create = useCallback((k: Kind) => { addItem(newItem(k)); setGallery(null); setNav((n) => ({ ...n, collapsed: openOnly(k) })) }, [setGallery])
  const step = useCallback((by: number) => {
    if (!walk.length) return
    const next = walk[Math.max(0, Math.min(walk.length - 1, at < 0 ? 0 : at + by))]
    if (next) open(next.uid)
  }, [walk, at, open])

  useEffect(() => { void restore() }, [])
  // A restored workspace opens with only the open item's group expanded.
  const restored = useRef(false)
  useEffect(() => {
    if (!loaded || restored.current) return
    restored.current = true
    const k = getState().ws.items.find((i) => i.uid === getState().selected)?.kind
    setNav((n) => ({ ...n, collapsed: openOnly(k) }))
  }, [loaded])
  // The item bar's height, so the preview sticks below it.
  const mainRef = useRef<HTMLElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const main = mainRef.current
    if (!main) return
    const ro = new ResizeObserver(() => {
      main.style.setProperty('--bar', `${barRef.current?.offsetHeight ?? 0}px`)
      main.style.setProperty('--main-h', `${main.clientHeight}px`)
    })
    ro.observe(main)
    if (barRef.current) ro.observe(barRef.current)
    return () => ro.disconnect()
  }, [item?.uid, page, gallery])
  useEffect(() => {
    if (!draftsOpen) return
    const close = () => setDraftsOpen(false)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [draftsOpen])
  useEffect(() => {
    if (!newOpen) return
    const close = () => setNewOpen(false)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [newOpen])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (item && drafts[item.uid]) saveDraft(item.uid); return }
      if (typing(e.target)) { if (e.key === 'Escape') (e.target as HTMLElement).blur(); return }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select() }
      else if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); step(1) }
      else if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); step(-1) }
      else if (e.key === 'Escape' && !gallery && item) setGallery(item.kind)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step, gallery, item, drafts])
  // Leaving while a save is still going would lose what it hasn't written.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (saved === 'saving' || saved === 'unsaved') e.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [saved])

  /** Open what was read: on its own, it replaces; with items open, you merge it in (or replace, if you'd rather). */
  const openWorkspace = (workspace: Workspace, notes: string[], from: string) => {
    const replace = () => {
      replaceWorkspace(workspace); setGallery(workspace.items[0].kind); setMerge(null)
      // Every group starts collapsed, so the kinds are easy to get to.
      setNav({ query: '', filter: 'all', collapsed: openOnly(null) })
      setNotes(notes)
    }
    if (!getState().ws.items.length) { replace(); return }
    setMerge({
      title: 'Merge into what\'s open',
      from,
      load: async (onProgress) => {
        const s = getState()
        const rows = await planMerge(s.ws.items, s.drafts, workspace.items, (d, t) => onProgress('Comparing', d, t))
        return { rows, notes, extras: workspace.extras, bundles: workspace.bundles, format: workspace.format, localBundles: workspace.localBundles }
      },
      onReplace: replace,
    })
  }

  const openFiles = async (files: () => Promise<FolderFile[]>, label = 'Reading files', from = 'the folder') => {
    setBusy({ label, done: 0, total: 0 })
    try {
      const list = await files()
      setBusy({ label: `Reading ${list.length.toLocaleString()} files`, done: 0, total: 0 })
      const { workspace, notes } = await readFolder(list)
      if (!workspace.items.length) notes.unshift('Nothing found. Pick the assets folder itself (the one holding avatar-decorations/, nameplates/, profile-effects/ or profile-frames/), or a zip of it.')
      if (workspace.items.length) openWorkspace(workspace, notes, from)
      else setNotes(notes)
    } catch (e) {
      setNotes([`Couldn't read that: ${e instanceof Error ? e.message : String(e)}`])
    } finally { setBusy(null) }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const dt = e.dataTransfer
    if (!dt.items.length) return
    // The drop's entries must be taken now, before anything awaits.
    const files = fromDrop(dt, (n) => setBusy({ label: `Found ${n.toLocaleString()} files`, done: 0, total: 0 }))
    void openFiles(() => files, 'Reading files', 'what you dropped')
  }

  const pull = useCallback((c: Conn) => setMerge({
    title: `Pull from ${c.base}`,
    from: c.base,
    load: (onProgress, signal) => { const s = getState(); return planPull(c, s.ws.items, s.drafts, onProgress, signal) },
    after: (rows) => rememberPulled(c.base, rows),
  }), [])
  const merged = (summary: string, rows: MergeRow[]) => {
    const m = merge
    setMerge(null)
    setNotes([`Merged: ${summary}. They're marked New or Updated in the list; Merged shows just those.`])
    if (rows.length) setNav((n) => ({ ...n, collapsed: openOnly(rows[0].kind) }))
    if (!getState().selected && rows[0]) open(rows[0].incoming.uid)
    void m?.after?.(rows)
  }

  /** Export and Save to folder write saved items only. */
  const draftsOk = () => !draftList.length || confirm(`${draftList.length} draft${draftList.length === 1 ? ' isn\'t' : 's aren\'t'} saved, so ${draftList.length === 1 ? 'it' : 'they'} won't be included. Continue?`)
  const doExport = async () => {
    if (!draftsOk()) return
    if (errors && !confirm(`${errors} problem${errors === 1 ? '' : 's'} would make Parley refuse some items. Export anyway?`)) return
    setBusy({ label: 'Making the zip', done: 0, total: 0 })
    try { await exportZip(ws) } finally { setBusy(null) }
  }
  const doSave = async () => {
    if (!draftsOk()) return
    if (errors && !confirm(`${errors} problem${errors === 1 ? '' : 's'} would make Parley refuse some items. Save anyway?`)) return
    try {
      const n = await saveToFolder(ws, (done, total) => setBusy({ label: 'Writing into the folder', done, total }))
      if (n !== null) setNotes([`Wrote ${n.toLocaleString()} file${n === 1 ? '' : 's'} into the folder.`])
    } catch (e) {
      setNotes([`Couldn't write to that folder: ${e instanceof Error ? e.message : String(e)}`])
    } finally { setBusy(null) }
  }

  return (
    <div
      className="flex h-full flex-col"
      onDragOver={dragOver}
      onDragLeave={(e) => { if (!e.relatedTarget || !e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false) }}
      onDrop={onDrop}
    >
      <header className="relative z-30 flex flex-wrap items-center gap-2 border-b border-line bg-bg-1 px-4 py-2">
        <div className="mr-2 font-bold">Profile Studio <span className="text-xs font-normal text-text-2">for Parley</span></div>
        <input ref={folderInput} type="file" className="hidden" multiple {...{ webkitdirectory: '' }} onChange={(e) => { const f = fromInput(e.target.files); e.target.value = ''; void openFiles(async () => f, 'Reading files', 'the folder') }} data-open-folder-input />
        <input ref={zipInput} type="file" className="hidden" accept=".zip" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void openFiles(() => fromZip(f), 'Opening the zip', f.name) }} data-open-zip-input />
        <button type="button" className="btn-ghost" onClick={() => folderInput.current?.click()} data-open-folder><FolderOpen size={16} />Open folder</button>
        <button type="button" className="btn-ghost" onClick={() => zipInput.current?.click()} data-open-zip>Open zip</button>
        <div className="relative">
          <button type="button" className="btn-ghost" onClick={(e) => { e.stopPropagation(); setNewOpen(!newOpen) }} aria-expanded={newOpen} data-new><Plus size={16} />New<ChevronDown size={14} /></button>
          {newOpen && (
            <div className="absolute left-0 top-full z-20 mt-1 w-56 rounded-lg border border-line bg-bg-2 p-1 shadow-xl" role="menu">
              {KINDS.map((k) => (
                <button key={k} type="button" role="menuitem" className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-bg-3" onClick={() => create(k)} data-new-kind={k}>{KIND_LABELS[k].one}</button>
              ))}
            </div>
          )}
        </div>
        <div className="flex-1" />
        {draftList.length > 0 && (
          <div className="relative">
            <button type="button" className="btn-ghost !text-accent" onClick={(e) => { e.stopPropagation(); setDraftsOpen(!draftsOpen) }} aria-expanded={draftsOpen} title="Work not saved yet" data-drafts><FilePen size={16} />Drafts {draftList.length}<ChevronDown size={14} /></button>
            {draftsOpen && (
              <div className="absolute right-0 top-full z-20 mt-1 max-h-96 w-72 overflow-y-auto rounded-lg border border-line bg-bg-2 p-1 shadow-xl" role="menu">
                {draftList.map((d) => (
                  <button key={d.uid} type="button" role="menuitem" className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-bg-3" onClick={() => open(d.uid)} data-draft-item={d.uid}>
                    <span className="min-w-0 flex-1 truncate">{(d.entry.name as string) || keyOf(d) || 'Untitled'}</span>
                    <span className="shrink-0 text-xs text-text-2">{isNewDraft(d.uid) ? `New ${KIND_LABELS[d.kind].one.toLowerCase()}` : 'Edited'}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <SaveStatus saved={saved} saving={saving} />
        <button type="button" className={`btn-ghost ${page === 'templates' ? '!bg-bg-3 !text-text-0' : ''}`} onClick={() => setPage(page === 'templates' ? null : 'templates')} title="Templates for PhotoCraft, VectorCraft, Photoshop, Illustrator…" aria-pressed={page === 'templates'} data-open-templates><Shapes size={16} />Templates</button>
        <button type="button" className={`btn-ghost !px-2 ${page === 'settings' ? '!bg-bg-3 !text-text-0' : ''}`} onClick={() => setPage(page === 'settings' ? null : 'settings')} title="Settings: allowed characters, file sizes" aria-pressed={page === 'settings'} data-open-settings><Gear size={16} /></button>
        <button type="button" className={`btn-ghost ${page === 'publish' ? '!bg-bg-3 !text-text-0' : ''}`} onClick={() => setPage(page === 'publish' ? null : 'publish')} title="Add and update these items on a Parley instance, or pull its items in" aria-pressed={page === 'publish'} data-open-publish><CloudUpload size={16} />Publish</button>
        {canSaveToFolder() && <button type="button" className="btn-ghost" disabled={!ws.items.length || !!busy} onClick={() => void doSave()} title="Write into a folder, such as your instance's assets folder" data-save-folder><FolderOutput size={16} />Save to folder</button>}
        <button type="button" className="btn-primary" disabled={!ws.items.length || !!busy} onClick={() => void doExport()} title="parley-assets.zip, for Admin → Cosmetics → Import" data-export><Download size={16} />Export zip</button>
      </header>

      {saveError && (
        <div className="flex items-center gap-2 border-b border-line bg-warn/10 px-4 py-2 text-sm text-warn" data-save-error>
          <Info size={16} className="shrink-0" /><span className="flex-1">{saveError}</span>
        </div>
      )}
      {notes.length > 0 && (
        <div className="flex items-start gap-2 border-b border-line bg-bg-3/60 px-4 py-2 text-sm text-text-1" data-notes>
          <Info size={16} className="mt-0.5 shrink-0 text-accent" />
          <ul className="max-h-32 flex-1 space-y-0.5 overflow-y-auto">{notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
          <button type="button" className="text-text-2 hover:text-text-0" title="Dismiss" onClick={() => setNotes([])}><X size={16} /></button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {ws.items.length > 0 && (
          <Sidebar items={shown} total={totals} problems={problems} nav={nav} setNav={setNav} selected={selected} galleryKind={page ? null : gallery} edited={drafts} marks={marks} onClearMarks={clearMarks} tags={tagList} onSelect={open} onGallery={setGallery} onNew={create} searchRef={searchRef} bundleCount={bundleCount} bundlesOpen={page === 'bundles'} onBundles={() => showBundles(null)} />
        )}
        <main ref={mainRef} className="min-w-0 flex-1 overflow-y-auto" data-main>
          {item && !page && !gallery && (
            // The item's bar stays put while its fields scroll: where you are, its actions, and the way to the next one.
            <div ref={barRef} className="sticky top-0 z-20 border-b border-line bg-bg-2/95 px-6 py-2 backdrop-blur" data-item-bar>
              <div className="mx-auto max-w-[1600px] space-y-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1" data-item-nav>
                  <button type="button" className="btn-ghost !px-2 !py-1 text-sm text-text-2" onClick={() => setGallery(item.kind)} title="Browse them all (Esc)" data-back-gallery><LayoutGrid size={14} />{KIND_LABELS[item.kind].many}</button>
                  <ItemHeader item={item} onSignIn={() => setPage('publish')} />
                  <div className="flex items-center gap-1 text-sm text-text-2">
                    {atKind >= 0 && <span className="whitespace-nowrap" data-item-position>{atKind + 1} of {sameKind.length}</span>}
                    <button type="button" className="btn-ghost !px-2 !py-1" disabled={at <= 0} onClick={() => step(-1)} title="Previous (↑ or k)" data-prev><ChevronLeft size={16} /></button>
                    <button type="button" className="btn-ghost !px-2 !py-1" disabled={at >= walk.length - 1 || !walk.length} onClick={() => step(1)} title="Next (↓ or j)" data-next><ChevronRight size={16} /></button>
                  </div>
                </div>
                {drafts[item.uid] && (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-accent/40 bg-bg-1 px-3 py-1.5 text-sm" data-draft-bar={isNewDraft(item.uid) ? 'new' : 'edited'}>
                    <FilePen size={16} className="shrink-0 text-accent" />
                    <span className="flex-1 text-text-1">{isNewDraft(item.uid) ? 'New draft: it joins the list when you save it.' : 'Draft: the list and exports use the saved version until you save.'}</span>
                    <button type="button" className="btn-ghost !py-1" onClick={() => { const fresh = isNewDraft(item.uid); if (!confirm(fresh ? 'Throw this new item away?' : 'Throw these changes away?')) return; discardDraft(item.uid); if (fresh) setGallery(item.kind) }} data-draft-discard><Undo2 size={14} />Discard</button>
                    <button type="button" className="btn-primary !py-1" onClick={() => saveDraft(item.uid)} title="Save (Ctrl+S)" data-draft-save><Save size={14} />Save</button>
                  </div>
                )}
              </div>
            </div>
          )}
          <div className="p-6">
          <div className={`mx-auto ${item && !page && !gallery ? 'max-w-[1600px]' : 'max-w-6xl'}`}>
            {page === 'settings' ? (
              <Settings />
            ) : page === 'templates' ? (
              <Templates />
            ) : page === 'publish' ? (
              <Publish onPull={pull} />
            ) : page === 'bundles' ? (
              <Bundles open={bundle} onOpenBundle={setBundle} onOpenItem={open} />
            ) : gallery ? (
              <Gallery key={gallery} kind={gallery} items={shown.get(gallery)!} total={totals.get(gallery) ?? 0} problems={problems} marks={marks} onOpen={open} onNew={() => create(gallery)} />
            ) : item ? (
              <ItemEditor key={item.uid} item={item} onOpen={open} onBundle={showBundles} />
            ) : loaded && <Welcome onFolder={() => folderInput.current?.click()} onNew={create} />}
          </div>
          </div>
        </main>
      </div>

      {merge && <Merge title={merge.title} from={merge.from} load={merge.load} onReplace={merge.onReplace} onApplied={merged} onClose={() => setMerge(null)} />}
      {busy && <Loading progress={busy} />}
      {dragging && !busy && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-bg-0/70">
          <div className="rounded-xl border-2 border-dashed border-accent px-10 py-8 text-lg font-semibold">Drop an assets folder or zip to open it</div>
        </div>
      )}
    </div>
  )
}

function Welcome({ onFolder, onNew }: { onFolder: () => void; onNew: (k: Kind) => void }) {
  return (
    <div className="mx-auto max-w-2xl space-y-6 pt-8" data-welcome>
      <div>
        <h1 className="text-2xl font-bold">Make profile cosmetics for Parley</h1>
        <p className="mt-2 text-text-1">
          Open an assets folder (or a zip of one), or start something new. Everything stays in this browser. When you're done, export a zip and
          import it in Parley under Admin → Cosmetics → Import.
        </p>
      </div>
      <button type="button" className="btn-primary" onClick={onFolder}><FolderOpen size={16} />Open an assets folder</button>
      <div className="grid gap-3 sm:grid-cols-2">
        {KINDS.map((k) => (
          <button key={k} type="button" className="rounded-lg border border-line bg-bg-1 p-4 text-left hover:border-accent/60" onClick={() => onNew(k)} data-welcome-new={k}>
            <div className="font-semibold">New {KIND_LABELS[k].one.toLowerCase()}</div>
            <div className="mt-1 text-sm text-text-2">{KIND_LABELS[k].blurb}</div>
          </button>
        ))}
      </div>
    </div>
  )
}
