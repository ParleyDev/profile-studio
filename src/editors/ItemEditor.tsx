import { ArrowDown, ArrowUp, Copy, Timer, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { assetId, displayName, DEFAULT_LAYOUT, EFFECT_SPECIAL_FILES, extOf, FILE_EXTS, KIND_DIRS, KIND_LABELS, layered, MAX_DESCRIPTION, MAX_LAYOUT, MAX_MS, MAX_NAME, MAX_Z, newEffectLayer, newFrameLayer, safeFileName, safeFolderName, isVideo, type EffectLayer, type FrameLayer, type FrameLayout } from '../format/kinds'
import { validateItem, type Problem } from '../format/validate'
import { keyOf, newUid, typed, type Item } from '../format/workspace'
import { animationLength, isAnimated, useFileUrls, useSizes } from '../lib/media'
import { addItem, moveItem, patchEntry, removeItem, updateItem, useStudio } from '../lib/store'
import DecorationPreview from '../preview/DecorationPreview'
import EffectPreview from '../preview/EffectPreview'
import FramePreview from '../preview/FramePreview'
import NameplatePreview from '../preview/NameplatePreview'
import { DropFiles, Field, fmtSize, Num, Problems } from './Fields'

const accept = (exts: string[]) => exts.map((e) => `.${e}`).join(',')
const stem = (f: string) => (f.includes('.') ? f.slice(0, f.lastIndexOf('.')) : f)

export default function ItemEditor({ item }: { item: Item }) {
  const { ws } = useStudio()
  const sizes = useSizes(item.files)
  const problems = useMemo(() => validateItem(item, ws, sizes), [item, ws, sizes])
  const key = keyOf(item)
  const field = layered(item.kind) ? 'folder' : 'file'
  const general = problems.filter((p) => !p.at?.startsWith('layer:') && !p.at?.startsWith('file:'))

  const duplicate = () => {
    const taken = new Set(ws.items.filter((o) => o.kind === item.kind).map(keyOf))
    let k = key, n = 2
    const make = (i: number) => (layered(item.kind) ? `${key}_${i}` : `${stem(key)}_${i}.${extOf(key)}`)
    while (taken.has(k)) k = make(n++)
    const files = layered(item.kind) ? { ...item.files } : item.files[key] ? { [k]: item.files[key] } : {}
    addItem({ uid: newUid(), kind: item.kind, entry: { ...structuredClone(item.entry), [field]: k, name: `${item.entry.name ?? ''} copy`.trim().slice(0, MAX_NAME) }, files })
  }

  return (
    <div className="space-y-6" data-item-editor={item.kind}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-wider text-text-2">{KIND_LABELS[item.kind].one}</div>
          <h1 className="text-2xl font-bold" data-item-title>{(item.entry.name as string) || 'Untitled'}</h1>
          <div className="mt-0.5 font-mono text-xs text-text-2" title="What Parley stores for a member wearing it">{key ? `${KIND_DIRS[item.kind]}/${key} · asset:${assetId(key, item.kind)}` : `${KIND_DIRS[item.kind]}/`}</div>
        </div>
        <div className="flex gap-1">
          <button type="button" className="btn-ghost !px-2" title="Move up (pickers show them in this order)" onClick={() => moveItem(item.uid, -1)}><ArrowUp size={16} /></button>
          <button type="button" className="btn-ghost !px-2" title="Move down" onClick={() => moveItem(item.uid, 1)}><ArrowDown size={16} /></button>
          <button type="button" className="btn-ghost !px-2" title="Duplicate" onClick={duplicate} data-item-duplicate><Copy size={16} /></button>
          <button type="button" className="btn-ghost !px-2 hover:!text-danger" title="Delete" onClick={() => { if (confirm(`Delete ${item.entry.name || 'this item'}?`)) removeItem(item.uid) }} data-item-delete><Trash2 size={16} /></button>
        </div>
      </div>

      <Problems list={general} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" hint="What Parley's pickers call it.">
          <input className="input" value={(item.entry.name as string) ?? ''} maxLength={MAX_NAME} onChange={(e) => patchEntry(item.uid, { name: e.target.value })} data-item-name />
        </Field>
        <Field label={layered(item.kind) ? 'Folder name' : 'File name'} hint={`Letters, digits, '_' and '-'${layered(item.kind) ? '' : ', then its extension'}. Members who wear it store its id, so keep it once people use it.`}>
          <input className="input font-mono" value={key} onChange={(e) => rename(item, e.target.value)} onBlur={(e) => rename(item, layered(item.kind) ? safeFolderName(e.target.value) : safeFileName(e.target.value))} data-item-key />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Description">
            <textarea className="input resize-y" rows={2} maxLength={MAX_DESCRIPTION} value={(item.entry.description as string) ?? ''} onChange={(e) => patchEntry(item.uid, { description: e.target.value })} data-item-description />
          </Field>
        </div>
      </div>

      {layered(item.kind) ? <LayeredBody item={item} problems={problems} sizes={sizes} /> : <FileBody item={item} problems={problems} sizes={sizes} />}
    </div>
  )
}

/** Renaming a decoration's or nameplate's file moves its picture with it; a folder is just renamed. */
function rename(item: Item, next: string) {
  updateItem(item.uid, (it) => {
    if (layered(it.kind)) return { ...it, entry: { ...it.entry, folder: next } }
    const old = keyOf(it)
    const files = { ...it.files }
    if (files[old] && next !== old) { files[next] = files[old]; delete files[old] }
    return { ...it, entry: { ...it.entry, file: next }, files }
  })
}

// --- decorations and nameplates: one file -------------------------------------------------------------------------

function FileBody({ item, problems, sizes }: { item: Item; problems: Problem[]; sizes: Record<string, { w: number; h: number }> }) {
  const key = keyOf(item)
  const blob = item.files[key]
  const urls = useFileUrls(item.files)
  const [animated, setAnimated] = useState(false)
  useEffect(() => { let live = true; if (blob) void isAnimated(blob).then((a) => { if (live) setAnimated(a) }); return () => { live = false } }, [blob])
  const choose = (f: File) => updateItem(item.uid, (it) => {
    const name = keyOf(it) ? `${stem(keyOf(it))}.${extOf(f.name)}` : safeFileName(f.name)
    return { ...it, entry: { ...it.entry, file: name, name: (it.entry.name as string) || displayName(stem(name)) }, files: { [name]: typed(f, name) } }
  })
  const sz = sizes[key]
  const fileProblems = problems.filter((p) => p.at?.startsWith('file:'))
  return (
    <>
      <section className="space-y-2">
        <div className="label">{item.kind === 'decoration' ? 'Picture' : 'Loop or picture'}</div>
        <DropFiles accept={accept(FILE_EXTS[item.kind])} onFiles={(f) => choose(f[0])} data-item-file>
          {blob ? <><span className="font-mono text-text-1">{key}</span> · {fmtSize(blob.size)}{sz ? ` · ${sz.w}×${sz.h}` : ''}{animated ? ' · animated' : ''}</> : item.kind === 'decoration' ? 'A square PNG, APNG, GIF or WebP with a see-through middle. Drop it here.' : 'A WebM or MP4 loop, or a PNG, APNG, GIF or WebP. Drop it here.'}
        </DropFiles>
        <Problems list={fileProblems} />
      </section>
      <section className="space-y-3">
        <div className="label">Preview</div>
        {item.kind === 'decoration' ? <DecorationPreview src={urls[key]} animated={animated} /> : <NameplatePreview src={urls[key]} video={isVideo(key)} />}
      </section>
    </>
  )
}

// --- effects and frames: a folder of layers -----------------------------------------------------------------------

function LayeredBody({ item, problems, sizes }: { item: Item; problems: Problem[]; sizes: Record<string, { w: number; h: number }> }) {
  const urls = useFileUrls(item.files)
  const layers = (Array.isArray(item.entry.layers) ? item.entry.layers : []) as (EffectLayer | FrameLayer)[]
  const fx = item.kind === 'effect'
  const special = new Set<string>(fx ? EFFECT_SPECIAL_FILES : [])
  const setLayers = (next: (EffectLayer | FrameLayer)[]) => patchEntry(item.uid, { layers: next })
  const layout = (item.entry.layout as FrameLayout | undefined) ?? DEFAULT_LAYOUT

  const addFiles = (list: File[], as?: string) => updateItem(item.uid, (it) => {
    const files = { ...it.files }
    const cur = (Array.isArray(it.entry.layers) ? it.entry.layers : []) as (EffectLayer | FrameLayer)[]
    const added: (EffectLayer | FrameLayer)[] = []
    for (const f of list) {
      const name = as ?? safeFileName(f.name)
      files[name] = typed(f, name)
      // A new picture becomes a layer straight away; the stills and thumbnail are picked up by name instead.
      if (!as && !special.has(name) && !cur.some((l) => l.file === name) && !added.some((l) => l.file === name)) {
        added.push(fx ? newEffectLayer(name, 100 + (cur.length + added.length) * 10) : newFrameLayer(name))
      }
    }
    return { ...it, files, entry: { ...it.entry, layers: [...cur, ...added], ...(fx || it.entry.layout ? {} : { layout: DEFAULT_LAYOUT }) } }
  })
  const removeFile = (name: string) => updateItem(item.uid, (it) => {
    const files = { ...it.files }; delete files[name]
    const cur = ((it.entry.layers ?? []) as (EffectLayer | FrameLayer)[]).filter((l) => l.file !== name).map((l) => ('random_variants' in l && l.random_variants ? { ...l, random_variants: l.random_variants.filter((v) => v !== name) } : l))
    return { ...it, files, entry: { ...it.entry, layers: cur } }
  })
  const renameFile = (from: string, to: string) => {
    if (!to || to === from || item.files[to]) return
    updateItem(item.uid, (it) => {
      const files = { ...it.files }; files[to] = files[from]; delete files[from]
      const cur = ((it.entry.layers ?? []) as (EffectLayer | FrameLayer)[]).map((l) => ({ ...l, file: l.file === from ? to : l.file, ...('random_variants' in l && l.random_variants ? { random_variants: l.random_variants.map((v) => (v === from ? to : v)) } : {}) }))
      return { ...it, files, entry: { ...it.entry, layers: cur } }
    })
  }
  const pictures = Object.keys(item.files).filter((f) => !special.has(f)).sort()

  return (
    <>
      <section className="space-y-2" data-item-files>
        <div className="label">Files in the folder</div>
        <DropFiles accept={accept(FILE_EXTS[item.kind])} multiple onFiles={(f) => addFiles(f)} data-item-add-files>
          {fx ? 'Animated PNGs (or GIF / WebP) drawn for a 1200 px wide card. Each new one becomes a layer.' : 'Pictures drawn for a 1200 px wide card. Names like front_staple_top.png place the layer for you.'}
        </DropFiles>
        <ul className="divide-y divide-line rounded-lg border border-line">
          {Object.keys(item.files).sort().map((f) => (
            <FileRow key={f} name={f} blob={item.files[f]} url={urls[f]} size={sizes[f]} role={special.has(f) ? f : undefined} onRename={(to) => renameFile(f, to)} onRemove={() => removeFile(f)} problems={problems.filter((p) => p.at === `file:${f}`)} />
          ))}
          {!Object.keys(item.files).length && <li className="p-3 text-sm text-text-2">No files yet.</li>}
        </ul>
        {fx && (
          <div className="grid gap-2 sm:grid-cols-3">
            {([['static.png', 'Still', 'Shown in pickers.'], ['reduced_motion.png', 'Reduced motion', 'Shown instead of playing it.'], ['thumbnail.png', 'Thumbnail', 'Pickers show this first.']] as const).map(([name, label, hint]) => (
              <DropFiles key={name} compact accept=".png" onFiles={(f) => addFiles(f, name)} data-effect-special={name}>
                <span className="block font-semibold text-text-1">{label}{item.files[name] ? ' ✓' : ''}</span><span className="text-xs">{hint}</span>
              </DropFiles>
            ))}
          </div>
        )}
      </section>

      {!fx && (
        <section className="space-y-2" data-frame-layout>
          <div className="label">Layout</div>
          <p className="text-xs text-text-2">In the frame's own pixels: how wide the card is it was drawn around, and how far it reaches past each edge.</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(['inner_width', 'overflow_top', 'overflow_bottom', 'overflow_horizontal'] as const).map((k) => (
              <Field key={k} label={{ inner_width: 'Card width', overflow_top: 'Above', overflow_bottom: 'Below', overflow_horizontal: 'Each side' }[k]}>
                <Num value={layout[k]} max={MAX_LAYOUT} onChange={(n) => patchEntry(item.uid, { layout: { ...layout, [k]: n } })} data-layout={k} />
              </Field>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-2" data-item-layers>
        <div className="flex items-center justify-between">
          <div className="label !mb-0">Layers</div>
          <button type="button" className="btn-ghost !px-2 !py-1 text-xs" disabled={!pictures.length} onClick={() => setLayers([...layers, fx ? newEffectLayer(pictures[0], 100 + layers.length * 10) : newFrameLayer(pictures[0])])} data-layer-add>Add a layer</button>
        </div>
        {!layers.length && <p className="text-sm text-text-2">Add pictures above; each becomes a layer.</p>}
        {layers.map((l, i) => (
          <div key={i} className="space-y-2 rounded-lg border border-line bg-bg-1 p-3" data-layer={i}>
            <div className="flex items-center gap-2">
              <span className="w-6 text-sm font-bold text-text-2">{i + 1}</span>
              <select className="input !py-1.5 font-mono" value={l.file} onChange={(e) => setLayers(layers.map((x, j) => (j === i ? { ...x, file: e.target.value } : x)))} data-layer-file>
                {!item.files[l.file] && <option value={l.file}>{l.file} (missing)</option>}
                {pictures.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
              <button type="button" className="btn-ghost !px-2" title="Earlier in the list" disabled={i === 0} onClick={() => { const n = [...layers]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; setLayers(n) }}><ArrowUp size={14} /></button>
              <button type="button" className="btn-ghost !px-2" title="Later in the list" disabled={i === layers.length - 1} onClick={() => { const n = [...layers]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; setLayers(n) }}><ArrowDown size={14} /></button>
              <button type="button" className="btn-ghost !px-2 hover:!text-danger" title="Remove the layer" onClick={() => setLayers(layers.filter((_, j) => j !== i))} data-layer-remove><Trash2 size={14} /></button>
            </div>
            {fx ? <EffectFields layer={l as EffectLayer} blob={item.files[l.file]} pictures={pictures} onChange={(x) => setLayers(layers.map((y, j) => (j === i ? x : y)))} /> : <FrameFields layer={l as FrameLayer} onChange={(x) => setLayers(layers.map((y, j) => (j === i ? x : y)))} />}
            <Problems list={problems.filter((p) => p.at === `layer:${i}`)} />
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <div className="label">Preview</div>
        {fx
          ? <EffectPreview layers={layers as EffectLayer[]} files={item.files} still={urls['reduced_motion.png'] ?? urls['static.png']} />
          : <FramePreview draft={{ layout, fileUrl: (f) => urls[f] ?? '', layers: (layers as FrameLayer[]).filter((l) => urls[l.file] && sizes[l.file]).map((l) => ({ ...l, width: sizes[l.file].w, height: sizes[l.file].h })) }} />}
      </section>
    </>
  )
}

function FileRow({ name, blob, url, size, role, onRename, onRemove, problems }: { name: string; blob: Blob; url?: string; size?: { w: number; h: number }; role?: string; onRename: (to: string) => void; onRemove: () => void; problems: Problem[] }) {
  const [draft, setDraft] = useState(name)
  useEffect(() => setDraft(name), [name])
  return (
    <li className="p-2" data-file-row={name}>
      <div className="flex items-center gap-3">
        <span className="checker flex h-10 w-14 shrink-0 items-center justify-center overflow-hidden rounded">{url && <img src={url} alt="" className="max-h-full max-w-full" />}</span>
        {role ? <span className="min-w-0 flex-1 truncate font-mono text-sm">{name}</span> : <input className="input !py-1 min-w-0 flex-1 font-mono" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => onRename(safeFileName(draft))} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />}
        <span className="shrink-0 text-xs text-text-2">{fmtSize(blob.size)}{size ? ` · ${size.w}×${size.h}` : ''}</span>
        <button type="button" className="btn-ghost !px-2 hover:!text-danger" title="Remove the file" onClick={onRemove}><Trash2 size={14} /></button>
      </div>
      <Problems list={problems} />
    </li>
  )
}

function EffectFields({ layer, blob, pictures, onChange }: { layer: EffectLayer; blob?: Blob; pictures: string[]; onChange: (l: EffectLayer) => void }) {
  const set = (patch: Partial<EffectLayer>) => onChange({ ...layer, ...patch })
  const [length, setLength] = useState<number | null>(null)
  useEffect(() => { let live = true; setLength(null); if (blob) void animationLength(blob).then((n) => { if (live) setLength(n) }); return () => { live = false } }, [blob])
  const variants = layer.random_variants ?? []
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Field label="Starts (ms)"><Num value={layer.start_ms} max={MAX_MS} onChange={(n) => set({ start_ms: n })} data-layer-start /></Field>
        <Field label="Plays for (ms)" hint={length ? <button type="button" className="inline-flex items-center gap-1 text-accent hover:underline" onClick={() => set({ duration_ms: length })} data-layer-use-length><Timer size={12} />Its length: {length}</button> : undefined}>
          <Num value={layer.duration_ms} max={MAX_MS} onChange={(n) => set({ duration_ms: n })} data-layer-duration />
        </Field>
        <Field label="Loops"><label className="flex h-[34px] items-center gap-2 text-sm"><input type="checkbox" checked={layer.loop} onChange={(e) => set({ loop: e.target.checked })} data-layer-loop />{layer.loop ? 'Yes' : 'Once'}</label></Field>
        <Field label="Then waits (ms)"><Num value={layer.loop_delay_ms} max={MAX_MS} onChange={(n) => set({ loop_delay_ms: n })} data-layer-delay /></Field>
        <Field label="z_index"><Num value={layer.z_index} max={MAX_Z} onChange={(n) => set({ z_index: n })} data-layer-z /></Field>
      </div>
      {pictures.length > 1 && (
        <details className="text-sm" open={variants.length > 0}>
          <summary className="cursor-pointer text-xs text-text-2">Random variants: each loop plays one of these or the layer's own picture</summary>
          <div className="mt-1 flex flex-wrap gap-3">
            {pictures.filter((p) => p !== layer.file).map((p) => (
              <label key={p} className="flex items-center gap-1.5 font-mono text-xs"><input type="checkbox" checked={variants.includes(p)} onChange={(e) => { const v = e.target.checked ? [...variants, p] : variants.filter((x) => x !== p); const { random_variants: _drop, ...rest } = layer; void _drop; onChange(v.length ? { ...rest, random_variants: v } : rest) }} />{p}</label>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

function FrameFields({ layer, onChange }: { layer: FrameLayer; onChange: (l: FrameLayer) => void }) {
  const set = (patch: Partial<FrameLayer>) => onChange({ ...layer, ...patch })
  const pick = <K extends 'order' | 'type' | 'anchor'>(k: K, options: FrameLayer[K][], hint: string) => (
    <Field label={k} hint={hint}>
      <select className="input !py-1.5" value={layer[k]} onChange={(e) => set({ [k]: e.target.value } as Partial<FrameLayer>)} data-layer-frame={k}>{options.map((o) => <option key={o} value={o}>{o}</option>)}</select>
    </Field>
  )
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {pick('order', ['front', 'back'], 'Over or behind the card.')}
      {pick('type', ['staple', 'rail', 'border'], 'Staples hang off an edge; rails and borders run down the sides.')}
      {pick('anchor', ['top', 'bottom', 'center'], 'Where it is pinned.')}
      <Field label="responsive" hint="Kept as written; Parley doesn't use it yet."><label className="flex h-[34px] items-center gap-2 text-sm"><input type="checkbox" checked={!!layer.responsive} onChange={(e) => set({ responsive: e.target.checked })} />{layer.responsive ? 'Yes' : 'No'}</label></Field>
    </div>
  )
}
