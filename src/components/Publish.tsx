import { CheckCircle2, CircleAlert, CloudDownload, CloudUpload, Loader2, LogIn, LogOut, RefreshCw, Square, Wand2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { KIND_LABELS } from '../format/kinds'
import { keyOf } from '../format/workspace'
import { cleanBase, folderStatus, resumeSignIn, signIn, signInReturned, signOut, useConn, type Conn } from '../lib/parley'
import { useStudio } from '../lib/store'
import FixNames from './FixNames'
import FolderSync from './FolderSync'
import { nameFixes } from '../format/names'
import { idOf } from '../lib/merge'
import { plan, publish, type Action, type Outcome, type PlanRow } from '../lib/sync'

// The instance's address is remembered to fill the form.
const REMEMBER = 'parley-profile-studio:parley'
function remembered(): string {
  try { return (JSON.parse(localStorage.getItem(REMEMBER) ?? '{}') as { base?: string }).base ?? '' } catch { return '' }
}

/**
 * Publish the saved items to a Parley instance (sign in, compare, then add the new ones and update the changed ones),
 * or pull the instance's items into what's open.
 */
export default function Publish({ onPull }: { onPull: (c: Conn) => void }) {
  const c = useConn()
  return (
    <div className="max-w-4xl space-y-6" data-publish>
      <div>
        <h1 className="text-2xl font-bold">Publish to Parley, or pull from it</h1>
        <p className="mt-1 max-w-2xl text-sm text-text-2">
          Sends your saved items to a Parley instance's assets folder: items it doesn't have are added, and items it has get their
          changes (name, description, layers, layout and changed files). Nothing there is deleted. You need an account that can
          manage the instance. <b>Pull</b> goes the other way: the instance's items come into what's open, new ones added and changed
          ones updated, for you to pick first.
        </p>
      </div>
      {c ? <Connected conn={c} onPull={onPull} /> : <SignIn />}
    </div>
  )
}

function SignIn() {
  const [base, setBase] = useState(remembered)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (go: () => Promise<Conn | null>) => {
    setBusy(true); setError(null)
    try { const c = await go(); if (c) try { localStorage.setItem(REMEMBER, JSON.stringify({ base: c.base })) } catch { /* only for this visit */ } }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  // Back from a whole-page sign-in (popups were blocked): finish it.
  useEffect(() => { if (signInReturned()) void run(resumeSignIn) }, [])
  return (
    <form className="max-w-md space-y-3 rounded-lg border border-line bg-bg-1 p-4" onSubmit={(e) => { e.preventDefault(); void run(() => signIn(base)) }} data-publish-signin>
      <label className="block space-y-1"><span className="label">Instance address</span>
        <input className="input" placeholder="https://parley.example.com" value={base} onChange={(e) => setBase(e.target.value)} autoComplete="url" data-publish-base />
      </label>
      {error && <p className="text-sm text-danger" data-publish-error>{error}</p>}
      <button type="submit" className="btn-primary" disabled={busy || !cleanBase(base)} data-publish-login>
        {busy ? <Loader2 size={14} className="animate-spin" /> : <LogIn size={14} />}{busy ? 'Waiting for Parley…' : 'Sign in with Parley'}
      </button>
      <p className="text-xs text-text-2">
        Parley's own sign-in opens in a popup: sign in there and allow Profile Studio to manage cosmetics. The Studio never sees your
        password, and only gets access to the instance's cosmetics. You can disconnect it in Parley under User Settings → Authorized Apps.
      </p>
    </form>
  )
}

const ACTIONS: { id: Action; title: string; blurb: string }[] = [
  { id: 'add', title: 'New', blurb: 'Not on the instance yet: added.' },
  { id: 'update', title: 'Changed', blurb: 'On the instance, with differences: updated.' },
  { id: 'blocked', title: 'Can\'t publish', blurb: 'Fix these first.' },
  { id: 'same', title: 'Up to date', blurb: 'Nothing to send.' },
]

function Connected({ conn: c, onPull }: { conn: Conn; onPull: (c: Conn) => void }) {
  const { ws, drafts } = useStudio()
  const [writable, setWritable] = useState<boolean | null>(null)
  const [rows, setRows] = useState<PlanRow[] | null>(null)
  const [picked, setPicked] = useState<Set<PlanRow>>(new Set())
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [outcomes, setOutcomes] = useState<Outcome[] | null>(null)
  const [showSame, setShowSame] = useState(false)
  const [fixing, setFixing] = useState(false)
  const stop = useRef<AbortController | null>(null)
  const draftCount = Object.keys(drafts).length

  useEffect(() => {
    let live = true
    folderStatus(c).then((s) => { if (live) setWritable(s.writable) }).catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)) })
    return () => { live = false; stop.current?.abort() }
  }, [c])
  // A comparison is of the items as they were: a pull or an edit makes it stale.
  useEffect(() => { setRows(null); setOutcomes(null) }, [ws.items])

  const fail = (e: unknown) => {
    if (e instanceof DOMException && e.name === 'AbortError') return
    setError(e instanceof Error ? e.message : String(e))
      }
  const compare = async () => {
    setError(null); setOutcomes(null); setRows(null)
    const ctl = new AbortController(); stop.current = ctl
    try {
      const r = await plan(c, ws.items, (label, d, t) => setProgress(`${label} ${d.toLocaleString()}/${t.toLocaleString()}`), ctl.signal)
      setRows(r); setPicked(new Set(r.filter((x) => x.action === 'add' || x.action === 'update')))
    } catch (e) { fail(e) } finally { setProgress(null) }
  }
  const send = async () => {
    if (!rows) return
    const list = rows.filter((r) => picked.has(r))
    if (!confirm(`Publish ${list.length} item${list.length === 1 ? '' : 's'} to ${c.base}? Members see them as soon as they're there.`)) return
    setError(null)
    const ctl = new AbortController(); stop.current = ctl
    try {
      const out = await publish(c, list, (d, t, label) => setProgress(`Publishing ${d + 1 > t ? t : d + 1}/${t}${label ? `: ${label}` : ''}`), ctl.signal)
      setOutcomes(out)
      const ok = new Set(out.filter((o) => o.ok).map((o) => o.row))
      setRows(rows.map((r) => (ok.has(r) ? { ...r, action: 'same', notes: ['Published just now.'], files: [], meta: {} } : r)))
      setPicked(new Set())
    } catch (e) { fail(e) } finally { setProgress(null) }
  }

  const groups = useMemo(() => Object.fromEntries(ACTIONS.map((a) => [a.id, (rows ?? []).filter((r) => r.action === a.id)])) as Record<Action, PlanRow[]>, [rows])
  const failed = outcomes?.filter((o) => !o.ok) ?? []
  // Names Parley refuses among the blocked items, tidied: ids must not clash with any item here or on the instance.
  const fixes = useMemo(() => {
    if (!rows) return []
    const taken = new Set([...ws.items.map((i) => `${i.kind}/${idOf(i)}`), ...rows.filter((r) => r.remote).map((r) => `${r.item.kind}/${r.remote!.value.replace(/^asset:/, '')}`)])
    const onInstance = new Set(rows.filter((r) => r.remote).map((r) => r.item.uid))
    return nameFixes(groups.blocked.map((r) => r.item), (it) => onInstance.has(it.uid), taken)
  }, [rows, groups, ws.items])
  const toggle = (r: PlanRow) => { const n = new Set(picked); if (n.has(r)) n.delete(r); else n.add(r); setPicked(n) }

  return (
    <div className="space-y-5" data-publish-connected>
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-bg-1 px-4 py-3 text-sm">
        <CheckCircle2 size={16} className="text-success" />
        <span className="flex-1">Connected to <span className="font-mono">{c.base}</span>{writable === false && <span className="text-danger"> · its assets folder isn't writable, so nothing can be published</span>}</span>
        <button type="button" className="btn-ghost !py-1.5" onClick={signOut} title="Forget the sign-in in this tab. To revoke it, use Parley's User Settings → Authorized Apps." data-publish-logout><LogOut size={14} />Sign out</button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={rows ? 'btn-ghost bg-bg-3' : 'btn-primary'} disabled={!!progress || !ws.items.length} onClick={() => void compare()} data-publish-compare>
          <RefreshCw size={16} />{rows ? 'Compare again' : `Compare ${ws.items.length.toLocaleString()} item${ws.items.length === 1 ? '' : 's'}`}
        </button>
        <button type="button" className="btn-ghost" disabled={!!progress} onClick={() => onPull(c)} title="Bring the instance's items into what's open: you pick what comes in" data-publish-pull><CloudDownload size={16} />Pull from instance</button>
        {rows && <button type="button" className="btn-primary" disabled={!!progress || !picked.size || writable === false} onClick={() => void send()} data-publish-send><CloudUpload size={16} />Publish {picked.size.toLocaleString()}</button>}
        {progress && <span className="flex items-center gap-2 text-sm text-text-1" data-publish-progress><Loader2 size={14} className="animate-spin" />{progress}<button type="button" className="btn-ghost !px-2 !py-1" onClick={() => stop.current?.abort()} title="Stop"><Square size={12} />Stop</button></span>}
      </div>
      <FolderSync conn={c} writable={writable} />
      {draftCount > 0 && <p className="text-sm text-warn">{draftCount} draft{draftCount === 1 ? ' isn\'t' : 's aren\'t'} saved, so {draftCount === 1 ? 'it' : 'they'} won't be published.</p>}
      {!rows && !progress && <p className="text-sm text-text-2">Comparing reads the instance's items. The first time, it also downloads the files of items both sides have, to see which changed; after that only files you changed are checked.</p>}
      {error && <p className="flex items-center gap-2 text-sm text-danger" data-publish-error><CircleAlert size={14} />{error}</p>}
      {outcomes && (
        <div className={`rounded-lg border p-3 text-sm ${failed.length ? 'border-danger/50' : 'border-success/50'}`} data-publish-result={failed.length ? 'partial' : 'ok'}>
          {outcomes.length - failed.length} published{failed.length ? `, ${failed.length} failed:` : '.'}
          {failed.length > 0 && <ul className="mt-2 space-y-1">{failed.map((o, i) => <li key={i}><b>{o.row.item.entry.name || keyOf(o.row.item)}</b>: {o.error}</li>)}</ul>}
        </div>
      )}

      {rows && ACTIONS.map((a) => {
        const list = groups[a.id]
        if (!list.length) return null
        const selectable = a.id === 'add' || a.id === 'update'
        const hidden = a.id === 'same' && !showSame
        const all = selectable && list.every((r) => picked.has(r))
        return (
          <section key={a.id} className="space-y-2" data-publish-group={a.id}>
            <div className="flex items-center gap-3">
              {selectable && <input type="checkbox" checked={all} onChange={() => { const n = new Set(picked); list.forEach((r) => (all ? n.delete(r) : n.add(r))); setPicked(n) }} title="All or none" />}
              <div className="label !mb-0">{a.title} · {list.length.toLocaleString()}</div>
              <span className="text-xs text-text-2">{a.blurb}</span>
              {a.id === 'blocked' && fixes.length > 0 && <button type="button" className="btn-ghost !px-2 !py-0.5 text-xs" onClick={() => setFixing(true)} title="Tidy the names Parley refuses, after a look at each" data-publish-fix-names><Wand2 size={12} />Fix {fixes.length} name{fixes.length === 1 ? '' : 's'}</button>}
              {a.id === 'same' && <button type="button" className="btn-ghost !px-2 !py-0.5 text-xs" onClick={() => setShowSame(!showSame)}>{showSame ? 'Hide' : 'Show'}</button>}
            </div>
            {!hidden && (
              <ul className="divide-y divide-line rounded-lg border border-line">
                {list.slice(0, 500).map((r) => (
                  <li key={r.item.uid} className="flex items-start gap-3 px-3 py-2 text-sm" data-publish-row={keyOf(r.item)}>
                    {selectable && <input type="checkbox" className="mt-1" checked={picked.has(r)} onChange={() => toggle(r)} />}
                    <span className="min-w-0 flex-1">
                      <span className="font-semibold">{r.item.entry.name || keyOf(r.item)}</span>
                      <span className="ml-2 text-xs text-text-2">{KIND_LABELS[r.item.kind].one} · <span className="font-mono">{keyOf(r.item)}</span></span>
                      {r.notes.length > 0 && <span className={`block text-xs ${a.id === 'blocked' ? 'text-danger' : 'text-text-2'}`}>{r.notes.join(' · ')}</span>}
                    </span>
                  </li>
                ))}
                {list.length > 500 && <li className="px-3 py-2 text-xs text-text-2">…and {(list.length - 500).toLocaleString()} more.</li>}
              </ul>
            )}
          </section>
        )
      })}
      {fixing && <FixNames fixes={fixes} items={ws.items} onClose={() => setFixing(false)} />}
      {rows && !rows.length && <p className="text-sm text-text-2">No saved items to publish.</p>}
    </div>
  )
}
