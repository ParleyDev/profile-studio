import { useSyncExternalStore } from 'react'
import { cleanExtras, DEFAULT_RULES, type Rules } from '../format/kinds'

/** The checking rules you set, kept in this browser. */
const KEY = 'parley-profile-studio:rules'

function load(): Rules {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Rules> | null
    if (!raw) return DEFAULT_RULES
    return {
      extraChars: typeof raw.extraChars === 'string' ? cleanExtras(raw.extraChars) : DEFAULT_RULES.extraChars,
      strictImport: raw.strictImport === true,
      maxFileMB: typeof raw.maxFileMB === 'number' && raw.maxFileMB > 0 ? raw.maxFileMB : DEFAULT_RULES.maxFileMB,
    }
  } catch { return DEFAULT_RULES }
}

let rules = load()
const listeners = new Set<() => void>()
export const useRules = () => useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l) } }, () => rules, () => rules)
export const getRules = () => rules
export function setRules(patch: Partial<Rules>) {
  rules = { ...rules, ...patch, ...(patch.extraChars !== undefined ? { extraChars: cleanExtras(patch.extraChars) } : {}) }
  try { localStorage.setItem(KEY, JSON.stringify(rules)) } catch { /* kept for this visit only */ }
  listeners.forEach((l) => l())
}
export const resetRules = () => setRules(DEFAULT_RULES)
