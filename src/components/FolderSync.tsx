import { ArrowDownToLine, ArrowUpFromLine, CircleAlert, Loader2, Package, RefreshCw, Settings2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { KIND_DIRS, KIND_LABELS, KINDS, type Kind } from '../format/kinds'
import { planFolder, pushRow, ROOT_NAME, type FolderRow } from '../lib/folderSync'
import { remoteBundleFiles, remoteMetadata, type BundleFileName, type Conn, type RemoteJsonFile } from '../lib/parley'
import { setKindFields, setRootJson, useStudio } from '../lib/store'

type Remote = { files: Record<BundleFileName, RemoteJsonFile | null> | null; metas: Partial<Record<Kind, { fields: Record<string, unknown>; etag: string | null } | null>> }
const STATUS: Record<FolderRow['status'], { label: string; cls: string }> = {
  same: { label: 'Up to date', cls: 'text-success' },
  differs: { label: 'Different', cls: 'text-accent' },
  here: { label: 'Only here', cls: 'text-accent' },
  there: { label: 'Only on the instance', cls: 'text-warn' },
  error: { label: 'Can\'t read', cls: 'text-danger' },
}
const BLURB: Record<'bundles' | 'localBundles', string> = {
  bundles: 'From the sync script.',
  localBundles: 'Your bundle changes, laid over bundles.json.',
}

/**
 * The bundle files and each kind's folder settings (metadata.json beyond its items): compared with the instance, and
 * sent or taken one at a time. Instances without Parley's bundles API say so instead.
 */
export default function FolderSync({ conn: c, writable }: { conn: Conn; writable: boolean | null }) {
  const { ws } = useStudio()
  const [remote, setRemote] = useState<Remote | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setBusy('Reading the instance'); setError(null)
    try {
      const files = await remoteBundleFiles(c)
      const metas: Remote['metas'] = {}
      for (const k of KINDS) { metas[k] = await remoteMetadata(c, k); if (metas[k] === null) break }
      setRemote({ files, metas })
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(null) }
  }, [c])
  useEffect(() => { void load() }, [load])
  // Recompared here as things change; the instance's side is re-read after each push and on "Compare again".
  const plan = useMemo(() => (remote ? planFolder(ws, remote.files, remote.metas) : null), [ws, remote])

  const push = async (row: FolderRow, label: string) => {
    const gone = row.type === 'file' && !row.mine
    if (!confirm(gone ? `Delete ${label} on ${c.base}? It isn't in the open folder.` : `Replace ${label} on ${c.base} with the open folder's?`)) return
    setBusy(`Sending ${label}`); setError(null)
    try { await pushRow(c, row); await load() } catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(null) }
  }
  const pull = (row: FolderRow, label: string) => {
    if (!confirm(`Replace the open folder's ${label} with the instance's?`)) return
    if (row.type === 'file') setRootJson(row.root, row.theirs?.json)
    else setKindFields(row.kind, row.pulled)
  }

  const unsupported = remote && !plan?.bundles && !plan?.metadata
  return (
    <section className="space-y-2 rounded-lg border border-line bg-bg-1 p-4" data-folder-sync>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex-1 font-semibold">Bundles and folder settings</h2>
        {busy ? <span className="flex items-center gap-2 text-sm text-text-2"><Loader2 size={14} className="animate-spin" />{busy}…</span>
          : <button type="button" className="btn-ghost !py-1 text-sm" onClick={() => void load()} data-folder-compare><RefreshCw size={14} />Compare again</button>}
      </div>
      <p className="text-xs text-text-2">bundles.json, bundles.local.json and each kind's metadata.json fields beyond its items (such as tag_labels). Each goes whole, one way: Push sends the open folder's, Pull takes the instance's. collections and item_count are worked out from the items on both sides.</p>
      {error && <p className="flex items-center gap-2 text-sm text-danger" data-folder-error><CircleAlert size={14} />{error}</p>}
      {unsupported && <p className="text-sm text-text-2" data-folder-unsupported>This instance can't take bundles or folder settings yet: it needs a Parley version with the bundles API. Items still publish as usual.</p>}
      {plan && !unsupported && (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {plan.rows.map((row) => {
            const label = row.type === 'file' ? ROOT_NAME[row.root] : `${KIND_DIRS[row.kind]}/metadata.json settings`
            const st = STATUS[row.status]
            const canPush = row.status !== 'same' && row.status !== 'error' && writable !== false
            const canPull = row.status !== 'same' && row.status !== 'error' && row.status !== 'here'
            return (
              <li key={row.type === 'file' ? row.root : row.kind} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm" data-folder-row={row.type === 'file' ? row.root : row.kind}>
                {row.type === 'file' ? <Package size={15} className="text-text-2" /> : <Settings2 size={15} className="text-text-2" />}
                <span className="min-w-0 flex-1">
                  <span className="font-mono">{label}</span>
                  <span className="ml-2 text-xs text-text-2">{row.type === 'file' ? BLURB[row.root] : KIND_LABELS[row.kind].many}</span>
                  {row.notes.length > 0 && <span className="block text-xs text-text-2">{row.notes.join(' · ')}</span>}
                </span>
                <span className={`text-xs ${st.cls}`} data-folder-status={row.status}>{st.label}</span>
                {canPush && <button type="button" className="btn-ghost !px-2 !py-1 text-xs" disabled={!!busy} onClick={() => void push(row, label)} title="Send the open folder's to the instance" data-folder-push><ArrowUpFromLine size={13} />Push</button>}
                {canPull && <button type="button" className="btn-ghost !px-2 !py-1 text-xs" disabled={!!busy} onClick={() => pull(row, label)} title="Take the instance's into the open folder" data-folder-pull><ArrowDownToLine size={13} />Pull</button>}
              </li>
            )
          })}
          {!plan.rows.length && <li className="px-3 py-2 text-sm text-text-2">Neither side has bundles or folder settings.</li>}
        </ul>
      )}
      {plan && plan.bundles && !plan.metadata && !unsupported && <p className="text-xs text-text-2">This instance doesn't share folder settings yet, only bundles.</p>}
    </section>
  )
}
