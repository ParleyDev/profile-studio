/*
 * Talking to a Parley instance. Signing in goes through Parley itself, as a third-party app: OAuth 2.1 with PKCE
 * against the instance's authorization server (backend mcp/oauth.rs), asking only for `cosmetics.manage`. You sign
 * in and approve on Parley's own page, in a popup; the Studio never sees your password. That scope lets the token
 * reach the cosmetics admin API and nothing else (backend mcp/mod.rs REST_ALLOW), and Parley still checks the
 * account can manage the instance (routes/cosmetics.rs, routes/asset_admin.rs).
 *
 * Tokens last an hour and renew themselves with the refresh token. They're kept in this tab's sessionStorage, so a
 * reload stays signed in and closing the tab forgets them. The approval lasts until it's revoked in Parley (User
 * Settings → Authorized Apps).
 */
import { useSyncExternalStore } from 'react'
import type { Kind } from '../format/kinds'
import type { Entry } from '../format/workspace'

export const SCOPE = 'cosmetics.manage'

export interface Conn {
  base: string
  clientId: string
  tokenUrl: string
  access: string
  refresh: string
  /** When the access token runs out (ms since the epoch). */
  expires: number
}

/** What the admin list says about one of the assets folder's items. */
export interface RemoteItem {
  /** `asset:<id>`. */
  value: string
  source: 'builtin' | 'folder' | 'custom'
  name: string | null
  description: string | null
  enabled: boolean
  deleted: boolean
  /** Decorations and nameplates: `{file}`; effects: `{layers, still?, thumbnail?, reduced_motion?}`; frames: `{layers, layout}`. */
  data: { file?: string; layers?: Record<string, unknown>[]; layout?: Record<string, unknown> }
  users: number
}

export class ParleyError extends Error {
  readonly status: number
  constructor(message: string, status = 0) { super(message); this.status = status }
}

/** "parley.example.com/" or "https://parley.example.com/api" → "https://parley.example.com". */
export function cleanBase(url: string) {
  let u = url.trim()
  if (!u) return ''
  if (!/^https?:\/\//i.test(u)) u = `${/^(localhost|127\.|10\.|192\.168\.)/.test(u) ? 'http' : 'https'}://${u}`
  return u.replace(/\/+$/, '').replace(/\/api(\/v1)?$/i, '')
}

const unreachable = (base: string) => new ParleyError(`Couldn't reach ${base}. Check the address, and that the instance lets this page call it (its CORS_ORIGINS must be empty or list ${location.origin}).`)

async function errorText(res: Response) {
  try { const j = await res.json() as { error?: string; message?: string; error_description?: string }; return j.error_description ?? j.error ?? j.message ?? '' } catch { return '' }
}

// --- the connection: one per tab ------------------------------------------------------------------------------------

const CONN = 'parley-profile-studio:connection'
let conn: Conn | null = (() => { try { return JSON.parse(sessionStorage.getItem(CONN) ?? 'null') as Conn | null } catch { return null } })()
const listeners = new Set<() => void>()
function setConn(c: Conn | null) {
  conn = c
  try { if (c) sessionStorage.setItem(CONN, JSON.stringify(c)); else sessionStorage.removeItem(CONN) } catch { /* kept in memory */ }
  listeners.forEach((l) => l())
}
export const useConn = () => useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l) } }, () => conn)
export const getConn = () => conn
/** Forget the tokens here. The approval stays in Parley until it's revoked there. */
export const signOut = () => setConn(null)

// --- signing in -----------------------------------------------------------------------------------------------------

interface Endpoints { authorize: string; token: string; register: string }

async function discover(base: string): Promise<Endpoints> {
  let res: Response
  try { res = await fetch(`${base}/.well-known/oauth-authorization-server`) } catch { throw unreachable(base) }
  if (!res.ok) throw new ParleyError(`${base} doesn't look like a Parley instance with app sign-in (no /.well-known/oauth-authorization-server).`)
  const m = await res.json() as { authorization_endpoint?: string; token_endpoint?: string; registration_endpoint?: string; scopes_supported?: string[] }
  if (!m.authorization_endpoint || !m.token_endpoint || !m.registration_endpoint) throw new ParleyError('The instance\'s sign-in is missing an endpoint.')
  if (m.scopes_supported && !m.scopes_supported.includes(SCOPE)) throw new ParleyError(`This Parley version can't grant ${SCOPE} yet: update the instance.`)
  return { authorize: m.authorization_endpoint, token: m.token_endpoint, register: m.registration_endpoint }
}

/** Where Parley sends the popup back: this page. */
export const redirectUri = () => `${location.origin}${location.pathname}`

/** The Studio registers itself with each instance once (Dynamic Client Registration), per address it's served from. */
async function clientId(base: string, register: string): Promise<string> {
  const key = `parley-profile-studio:client:${base}`
  const redirect = redirectUri()
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null') as { id: string; redirect: string; at: number; approved?: boolean } | null
    // Parley drops registrations nobody approved within a week.
    if (saved?.redirect === redirect && (saved.approved || Date.now() - saved.at < 6 * 864e5)) return saved.id
  } catch { /* register again */ }
  let res: Response
  try { res = await fetch(register, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'Profile Studio', redirect_uris: [redirect] }) }) } catch { throw unreachable(base) }
  if (!res.ok) throw new ParleyError(`The instance wouldn't register Profile Studio: ${await errorText(res) || res.status}`)
  const { client_id } = await res.json() as { client_id: string }
  try { localStorage.setItem(key, JSON.stringify({ id: client_id, redirect, at: Date.now() })) } catch { /* registers again next time */ }
  return client_id
}
function markApproved(base: string) {
  const key = `parley-profile-studio:client:${base}`
  try { const s = JSON.parse(localStorage.getItem(key) ?? 'null'); if (s) localStorage.setItem(key, JSON.stringify({ ...s, approved: true })) } catch { /* fine */ }
}

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const random = (n: number) => b64url(crypto.getRandomValues(new Uint8Array(n)))
const challenge = async (verifier: string) => b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))

interface Pending { state: string; verifier: string; base: string; clientId: string; tokenUrl: string; redirect: string }
const PENDING = 'parley-profile-studio:signin'
const RETURNED = 'parley-profile-studio:signin-return'
export const MESSAGE = 'parley-profile-studio:signin'

/**
 * Sign in to an instance: Parley's own sign-in and approval page opens in a popup. Call it straight from a click, so
 * the popup isn't blocked; when popups are blocked the whole page goes to Parley and comes back.
 */
export async function signIn(rawBase: string): Promise<Conn | null> {
  const base = cleanBase(rawBase)
  const popup = window.open('', 'parley-signin', 'popup,width=520,height=720')
  try {
    const ep = await discover(base)
    const id = await clientId(base, ep.register)
    const p: Pending = { state: random(24), verifier: random(48), base, clientId: id, tokenUrl: ep.token, redirect: redirectUri() }
    sessionStorage.setItem(PENDING, JSON.stringify(p))
    const url = new URL(ep.authorize)
    for (const [k, v] of Object.entries({ response_type: 'code', client_id: id, redirect_uri: p.redirect, scope: SCOPE, state: p.state, code_challenge: await challenge(p.verifier), code_challenge_method: 'S256' })) url.searchParams.set(k, v)
    if (!popup) { location.assign(url.toString()); return null }
    popup.location.href = url.toString()
    const answer = await new Promise<{ state: string; code?: string; error?: string }>((resolve, reject) => {
      const onMessage = (e: MessageEvent) => {
        if (e.origin !== location.origin || e.data?.type !== MESSAGE) return
        cleanup(); resolve(e.data)
      }
      const watch = window.setInterval(() => { if (popup.closed) { cleanup(); reject(new ParleyError('Sign-in was closed before it finished.')) } }, 500)
      const cleanup = () => { window.removeEventListener('message', onMessage); window.clearInterval(watch) }
      window.addEventListener('message', onMessage)
    })
    return await finish(answer)
  } catch (e) {
    popup?.close()
    throw e
  }
}

async function finish(answer: { state: string; code?: string; error?: string }): Promise<Conn> {
  const p = JSON.parse(sessionStorage.getItem(PENDING) ?? 'null') as Pending | null
  sessionStorage.removeItem(PENDING)
  if (!p || p.state !== answer.state) throw new ParleyError('That sign-in doesn\'t match the one started here. Try again.')
  if (answer.error) throw new ParleyError(answer.error === 'access_denied' ? 'Access wasn\'t allowed.' : `Sign-in failed: ${answer.error}`)
  const c = await tokens(p.base, p.tokenUrl, p.clientId, { grant_type: 'authorization_code', code: answer.code ?? '', redirect_uri: p.redirect, client_id: p.clientId, code_verifier: p.verifier })
  markApproved(p.base)
  setConn(c)
  return c
}

/**
 * Run first thing on every page load. In the sign-in popup, hand Parley's answer to the page that opened it and
 * close (true: don't start the app here). After a whole-page sign-in, keep the answer for `resumeSignIn`.
 */
export function takeSignInReturn(): boolean {
  const q = new URLSearchParams(location.search)
  const state = q.get('state')
  if (!state || !(q.has('code') || q.has('error'))) return false
  const answer = { type: MESSAGE, state, code: q.get('code') ?? undefined, error: q.get('error') ?? undefined }
  history.replaceState(null, '', redirectUri())
  if (window.opener && window.opener !== window) {
    try { (window.opener as Window).postMessage(answer, location.origin); window.close(); return true } catch { /* fall through */ }
  }
  try { sessionStorage.setItem(RETURNED, JSON.stringify(answer)) } catch { /* lost */ }
  return false
}
/** Finish a whole-page sign-in, if this load is its return. */
export async function resumeSignIn(): Promise<Conn | null> {
  const raw = sessionStorage.getItem(RETURNED)
  if (!raw) return null
  sessionStorage.removeItem(RETURNED)
  return finish(JSON.parse(raw))
}
export const signInReturned = () => { try { return !!sessionStorage.getItem(RETURNED) } catch { return false } }

async function tokens(base: string, tokenUrl: string, client: string, form: Record<string, string>): Promise<Conn> {
  let res: Response
  try { res = await fetch(tokenUrl, { method: 'POST', body: new URLSearchParams(form) }) } catch { throw unreachable(base) }
  if (!res.ok) throw new ParleyError(`Sign-in failed: ${await errorText(res) || res.status}`, res.status === 400 ? 401 : res.status)
  const t = await res.json() as { access_token: string; refresh_token: string; expires_in: number }
  return { base, clientId: client, tokenUrl, access: t.access_token, refresh: t.refresh_token, expires: Date.now() + t.expires_in * 1000 }
}

// One refresh at a time: Parley rotates refresh tokens and ends the whole approval if an old one comes back.
let refreshing: Promise<Conn> | null = null
function refresh(c: Conn): Promise<Conn> {
  refreshing ??= tokens(c.base, c.tokenUrl, c.clientId, { grant_type: 'refresh_token', refresh_token: c.refresh, client_id: c.clientId })
    .then((n) => { setConn(n); return n }, (e: unknown) => { setConn(null); throw e instanceof ParleyError ? new ParleyError('Signed out: sign in again.', 401) : e })
    .finally(() => { refreshing = null })
  return refreshing
}

// --- the API --------------------------------------------------------------------------------------------------------

async function call<T>(c: Conn, path: string, init: RequestInit = {}, auth = true): Promise<T> {
  // The newest tokens: a refresh elsewhere replaces the ones this call was handed.
  let cur = conn?.base === c.base ? conn : c
  if (auth && cur.expires - Date.now() < 60_000) cur = await refresh(cur)
  for (let attempt = 0; ; attempt++) {
    const headers = new Headers(init.headers)
    if (auth) headers.set('Authorization', `Bearer ${cur.access}`)
    if (typeof init.body === 'string') headers.set('Content-Type', 'application/json')
    let res: Response
    try { res = await fetch(`${cur.base}/api${path}`, { ...init, headers }) } catch { throw unreachable(cur.base) }
    if (res.status === 401 && auth && attempt === 0) { cur = await refresh(conn?.base === cur.base ? conn : cur); continue }
    if (!res.ok) {
      let msg = await errorText(res)
      if (res.status === 401) { setConn(null); msg = 'Signed out: sign in again.' }
      if (res.status === 403) msg ||= 'This account can\'t manage the instance\'s cosmetics.'
      throw new ParleyError(msg || `${res.status} ${res.statusText}`, res.status)
    }
    if (res.status === 204) return undefined as T
    return ((res.headers.get('content-type') ?? '').includes('json') ? res.json() : res.blob()) as Promise<T>
  }
}

/** Can this account manage cosmetics, and can Parley write its assets folder? */
export const folderStatus = (c: Conn) => call<{ writable: boolean }>(c, '/admin/cosmetics-folder')

/** The instance's assets-folder items of a kind (built-in and custom ones left out). */
export async function remoteItems(c: Conn, kind: Kind): Promise<RemoteItem[]> {
  const all = await call<RemoteItem[]>(c, `/admin/cosmetics/${kind}`)
  return all.filter((i) => i.source === 'folder')
}

const DIRS: Record<Kind, string> = { decoration: 'avatar-decorations', nameplate: 'nameplates', effect: 'profile-effects', frame: 'profile-frames' }

/** One of an item's files as the instance serves it (publicly), or null when it has no such file. */
export async function remoteFile(c: Conn, kind: Kind, id: string, file?: string): Promise<Blob | null> {
  const path = file ? `/assets/${DIRS[kind]}/${encodeURIComponent(id)}/${encodeURIComponent(file)}` : `/assets/${DIRS[kind]}/${encodeURIComponent(id)}`
  try { return await call<Blob>(c, path, { cache: 'no-store' }, false) } catch (e) { if (e instanceof ParleyError && e.status === 404) return null; throw e }
}

const form = (field: string, json: unknown, files: Record<string, Blob>) => {
  const f = new FormData()
  f.append(field, JSON.stringify(json))
  for (const [name, blob] of Object.entries(files)) f.append('file', blob, name)
  return f
}

/** A new item, its entry kept exactly as it is (Admin → Cosmetics → Import does the same). */
export const importItem = (c: Conn, kind: Kind, entry: Entry, files: Record<string, Blob>) =>
  call<{ value: string }>(c, `/admin/cosmetics/${kind}/import`, { method: 'POST', body: form('entry', entry, files) })

/** An item already there: name, description, layers and layout, plus new or replaced files. */
export const editItem = (c: Conn, kind: Kind, id: string, meta: Record<string, unknown>, files: Record<string, Blob>) =>
  call<{ value: string }>(c, `/admin/cosmetics/${kind}/folder/${encodeURIComponent(id)}`, { method: 'PATCH', body: form('meta', meta, files) })
