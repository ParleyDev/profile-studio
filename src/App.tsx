import { AlertTriangle, ChevronDown, CircleAlert, Download, FolderOpen, FolderOutput, Info, Plus, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import ItemEditor from './editors/ItemEditor'
import { DEFAULT_LAYOUT, KIND_DIRS, KIND_LABELS, KINDS, layered, type Kind } from './format/kinds'
import { validateWorkspace } from './format/validate'
import { keyOf, newUid, readFolder, type Entry, type FolderFile, type Item } from './format/workspace'
import { canSaveToFolder, exportZip, fromDrop, fromInput, fromZip, saveToFolder } from './lib/io'
import { addItem, getState, replaceWorkspace, restore, select, useStudio } from './lib/store'

/** A new, empty item of a kind; effects and frames get a folder name nothing else of their kind uses. */
function newItem(kind: Kind): Item {
  const entry: Entry = layered(kind) ? { folder: '', name: '', description: '', layers: [] } : { file: '', name: '', description: '' }
  if (layered(kind)) {
    const taken = new Set(getState().ws.items.filter((i) => i.kind === kind).map(keyOf))
    let n = 1
    while (taken.has(`new_${kind}_${n}`)) n++
    entry.folder = `new_${kind}_${n}`
  }
  if (kind === 'frame') entry.layout = { ...DEFAULT_LAYOUT }
  return { uid: newUid(), kind, entry, files: {} }
}

const SAVED_LABEL = { saved: 'Saved in this browser', saving: 'Saving…', unsaved: 'Unsaved changes', off: 'Not saved: this browser blocks storage' } as const

export default function App() {
  const { ws, selected, loaded, saved } = useStudio()
  const [notes, setNotes] = useState<string[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [newOpen, setNewOpen] = useState(false)
  const folderInput = useRef<HTMLInputElement>(null)
  const zipInput = useRef<HTMLInputElement>(null)
  const problems = useMemo(() => validateWorkspace(ws), [ws])
  const item = ws.items.find((i) => i.uid === selected) ?? null
  const errors = [...problems.values()].reduce((n, l) => n + l.filter((p) => p.level === 'error').length, 0)

  useEffect(() => { void restore() }, [])
  useEffect(() => {
    if (!newOpen) return
    const close = () => setNewOpen(false)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [newOpen])

  const open = async (what: string, files: () => Promise<FolderFile[]>) => {
    if (ws.items.length && !confirm('Replace what is open now? It stays in your downloads only if you exported it.')) return
    setBusy(what)
    try {
      const { workspace, notes } = await readFolder(await files())
      if (!workspace.items.length) notes.unshift('Nothing found. Pick the assets folder itself (the one holding avatar-decorations/, nameplates/, profile-effects/ or profile-frames/), or a zip of it.')
      if (workspace.items.length) replaceWorkspace(workspace)
      setNotes(notes)
    } catch (e) {
      setNotes([`Couldn't read that: ${e instanceof Error ? e.message : String(e)}`])
    } finally { setBusy(null) }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    if (e.dataTransfer.items.length) void open('Reading…', () => fromDrop(e.dataTransfer))
  }

  const doExport = async () => {
    if (errors && !confirm(`${errors} problem${errors === 1 ? '' : 's'} would make Parley refuse some items. Export anyway?`)) return
    await exportZip(ws)
  }
  const doSave = async () => {
    if (errors && !confirm(`${errors} problem${errors === 1 ? '' : 's'} would make Parley refuse some items. Save anyway?`)) return
    setBusy('Saving…')
    try {
      const n = await saveToFolder(ws)
      if (n !== null) setNotes([`Wrote ${n} file${n === 1 ? '' : 's'} into the folder.`])
    } catch (e) {
      setNotes([`Couldn't write to that folder: ${e instanceof Error ? e.message : String(e)}`])
    } finally { setBusy(null) }
  }

  return (
    <div
      className="flex h-full flex-col"
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false) }}
      onDrop={onDrop}
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-line bg-bg-1 px-4 py-2">
        <div className="mr-2 font-bold">Profile Studio <span className="text-xs font-normal text-text-2">for Parley</span></div>
        <input ref={folderInput} type="file" className="hidden" multiple {...{ webkitdirectory: '' }} onChange={(e) => { const f = fromInput(e.target.files); e.target.value = ''; void open('Reading…', async () => f) }} data-open-folder-input />
        <input ref={zipInput} type="file" className="hidden" accept=".zip" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void open('Reading…', () => fromZip(f)) }} data-open-zip-input />
        <button type="button" className="btn-ghost" onClick={() => folderInput.current?.click()} data-open-folder><FolderOpen size={16} />Open folder</button>
        <button type="button" className="btn-ghost" onClick={() => zipInput.current?.click()} data-open-zip>Open zip</button>
        <div className="relative">
          <button type="button" className="btn-ghost" onClick={(e) => { e.stopPropagation(); setNewOpen(!newOpen) }} aria-expanded={newOpen} data-new><Plus size={16} />New<ChevronDown size={14} /></button>
          {newOpen && (
            <div className="absolute left-0 top-full z-20 mt-1 w-56 rounded-lg border border-line bg-bg-2 p-1 shadow-xl" role="menu">
              {KINDS.map((k) => (
                <button key={k} type="button" role="menuitem" className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-bg-3" onClick={() => addItem(newItem(k))} data-new-kind={k}>{KIND_LABELS[k].one}</button>
              ))}
            </div>
          )}
        </div>
        <div className="flex-1" />
        <span className={`text-xs ${saved === 'off' ? 'text-warn' : 'text-text-2'}`} data-saved={saved}>{busy ?? SAVED_LABEL[saved]}</span>
        {canSaveToFolder() && <button type="button" className="btn-ghost" disabled={!ws.items.length || !!busy} onClick={() => void doSave()} title="Write into a folder, such as your instance's assets folder" data-save-folder><FolderOutput size={16} />Save to folder</button>}
        <button type="button" className="btn-primary" disabled={!ws.items.length} onClick={() => void doExport()} title="parley-assets.zip, for Admin → Cosmetics → Import" data-export><Download size={16} />Export zip</button>
      </header>

      {notes.length > 0 && (
        <div className="flex items-start gap-2 border-b border-line bg-bg-3/60 px-4 py-2 text-sm text-text-1" data-notes>
          <Info size={16} className="mt-0.5 shrink-0 text-accent" />
          <ul className="flex-1 space-y-0.5">{notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
          <button type="button" className="text-text-2 hover:text-text-0" title="Dismiss" onClick={() => setNotes([])}><X size={16} /></button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <nav className="w-64 shrink-0 overflow-y-auto border-r border-line bg-bg-1 p-2" data-sidebar>
          {KINDS.map((k) => {
            const items = ws.items.filter((i) => i.kind === k)
            return (
              <div key={k} className="mb-3">
                <div className="flex items-center justify-between px-2 py-1">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-text-2" title={`${KIND_DIRS[k]}/`}>{KIND_LABELS[k].many}</span>
                  <button type="button" className="text-text-2 hover:text-text-0" title={`New ${KIND_LABELS[k].one.toLowerCase()}`} onClick={() => addItem(newItem(k))}><Plus size={14} /></button>
                </div>
                {items.map((it) => {
                  const list = problems.get(it.uid) ?? []
                  const err = list.filter((p) => p.level === 'error').length
                  const warn = list.length - err
                  return (
                    <button
                      key={it.uid}
                      type="button"
                      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${it.uid === selected ? 'bg-bg-4 text-text-0' : 'text-text-1 hover:bg-bg-3'}`}
                      onClick={() => select(it.uid)}
                      data-item-row={it.uid}
                      data-row-key={keyOf(it)}
                    >
                      <span className="min-w-0 flex-1 truncate">{(it.entry.name as string) || keyOf(it) || 'Untitled'}</span>
                      {err > 0 && <span className="flex items-center gap-0.5 text-xs text-danger" title={`${err} error${err === 1 ? '' : 's'}: Parley would refuse it`} data-badge-error><CircleAlert size={12} />{err}</span>}
                      {warn > 0 && <span className="flex items-center gap-0.5 text-xs text-warn" title={`${warn} warning${warn === 1 ? '' : 's'}`} data-badge-warning><AlertTriangle size={12} />{warn}</span>}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </nav>

        <main className="min-w-0 flex-1 overflow-y-auto p-6">
          {item ? <div className="mx-auto max-w-5xl"><ItemEditor key={item.uid} item={item} /></div> : loaded && <Welcome onFolder={() => folderInput.current?.click()} onNew={(k) => addItem(newItem(k))} />}
        </main>
      </div>

      {dragging && (
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
