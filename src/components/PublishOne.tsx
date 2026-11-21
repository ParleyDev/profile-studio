import { CloudUpload, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { keyOf } from '../format/workspace'
import { useConn } from '../lib/parley'
import { useStudio } from '../lib/store'
import { plan, publish } from '../lib/sync'

/**
 * Publish one item to the signed-in Parley instance, from its editor: compare it, say what would change, and send it.
 * Its saved version goes, so a draft has to be saved first. Not signed in: opens the Publish page to sign in.
 */
export default function PublishOne({ uid, onSignIn }: { uid: string; onSignIn: () => void }) {
  const conn = useConn()
  const { ws, drafts } = useStudio()
  const saved = ws.items.find((i) => i.uid === uid)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)

  const go = async () => {
    if (!conn) { onSignIn(); return }
    if (!saved) return
    setNote(null); setBusy('Comparing')
    const name = saved.entry.name || keyOf(saved)
    try {
      const [row] = await plan(conn, [saved], () => {})
      if (row.action === 'same') { setNote({ ok: true, text: `Already up to date on ${conn.base}.` }); return }
      if (row.action === 'blocked') { setNote({ ok: false, text: row.notes.join(' ') }); return }
      const what = row.action === 'add' ? `Add "${name}" to ${conn.base}?` : `Update "${name}" on ${conn.base}?\n\nChanges: ${row.notes.join(', ')}`
      if (!confirm(`${what}${drafts[uid] ? '\n\nYour unsaved changes aren\'t included: this sends the saved version.' : ''}\n\nMembers see it as soon as it's there.`)) return
      setBusy(row.action === 'add' ? 'Adding' : 'Updating')
      const [out] = await publish(conn, [row], () => {})
      setNote(out.ok ? { ok: true, text: row.action === 'add' ? `Added to ${conn.base}.` : `Updated on ${conn.base}.` } : { ok: false, text: out.error ?? 'It didn\'t go through.' })
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally { setBusy(null) }
  }

  const draft = !!drafts[uid]
  const title = !saved ? 'Save it first: new items publish once saved'
    : draft ? 'Publishes the saved version: save your changes first to include them'
    : conn ? `Add or update it on ${conn.base}` : 'Sign in to a Parley instance to publish it'
  return (
    <span className="flex items-center gap-2">
      {note && <span className={`max-w-xs text-right text-xs ${note.ok ? 'text-success' : 'text-danger'}`} data-publish-one-note={note.ok ? 'ok' : 'error'}>{note.text}</span>}
      <button type="button" className="btn-ghost !px-2" title={title} disabled={!saved || !!busy} onClick={() => void go()} data-publish-one>
        {busy ? <Loader2 size={16} className="animate-spin" /> : <CloudUpload size={16} />}{busy && <span className="text-xs">{busy}…</span>}
      </button>
    </span>
  )
}
