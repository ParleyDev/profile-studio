import { RotateCcw, X } from 'lucide-react'
import { useState } from 'react'
import { BANNED_CHARS, cleanExtras, DEFAULT_EXTRA_CHARS, DEFAULT_RULES, MAX_FILE, NAME_RULE } from '../format/kinds'
import { resetRules, setRules, useRules } from '../lib/settings'

const show = (c: string) => (c === ' ' ? 'space' : c)

/** How strictly the Studio checks: what names may use, how big files may be, and whether you use Parley's Import. */
export default function Settings() {
  const rules = useRules()
  const [add, setAdd] = useState('')
  const extras = [...rules.extraChars]
  const refused = [...add].filter((c) => BANNED_CHARS.includes(c))
  const addChars = () => { setRules({ extraChars: rules.extraChars + add }); setAdd('') }
  return (
    <div className="max-w-2xl space-y-8" data-settings>
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="mt-1 text-sm text-text-2">How strictly the Studio checks your items. Saved in this browser.</p>
      </div>

      <section className="space-y-3">
        <div className="label">How you'll add these to Parley</div>
        {([
          [false, 'Copy into the assets folder', 'Parley serves the files as they are. Names with the characters below, and big files, are warnings.'],
          [true, 'Parley\'s Import (Admin → Cosmetics → Import)', `Import refuses names with anything but ${NAME_RULE}, and files over ${MAX_FILE / 1024 / 1024} MB, so those are errors.`],
        ] as const).map(([strict, title, body]) => (
          <label key={String(strict)} className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${rules.strictImport === strict ? 'border-accent bg-accent/10' : 'border-line hover:bg-bg-3'}`}>
            <input type="radio" name="mode" className="mt-1" checked={rules.strictImport === strict} onChange={() => setRules({ strictImport: strict })} data-rule-strict={String(strict)} />
            <span><span className="block font-semibold">{title}</span><span className="text-sm text-text-2">{body}</span></span>
          </label>
        ))}
      </section>

      <section className="space-y-3">
        <div className="label">Characters allowed in file and folder names</div>
        <p className="text-sm text-text-2">
          Parley takes {NAME_RULE} (no '.' in folder names); those are always allowed. These are allowed too{rules.strictImport ? ', but Import still refuses them' : ''}:
        </p>
        <div className="flex flex-wrap gap-2" data-extra-chars>
          {extras.map((c) => (
            <span key={c} className="inline-flex items-center gap-1 rounded-md border border-line bg-bg-3 py-1 pl-2.5 pr-1 font-mono text-sm">
              {show(c)}
              <button type="button" className="rounded p-0.5 text-text-2 hover:text-danger" title={`Stop allowing ${show(c)}`} onClick={() => setRules({ extraChars: rules.extraChars.replace(c, '') })} data-extra-remove={c}><X size={12} /></button>
            </span>
          ))}
          {!extras.length && <span className="text-sm text-text-2">None: only what Import takes.</span>}
        </div>
        <div className="flex gap-2">
          <input className="input max-w-48 font-mono" placeholder="Add characters" value={add} onChange={(e) => setAdd(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && cleanExtras(add)) addChars() }} data-extra-add />
          <button type="button" className="btn-ghost" disabled={!cleanExtras(add)} onClick={addChars}>Allow</button>
          <button type="button" className="btn-ghost" disabled={rules.extraChars === DEFAULT_EXTRA_CHARS} onClick={() => setRules({ extraChars: DEFAULT_EXTRA_CHARS })} title="Only what Parley takes"><RotateCcw size={14} />Default</button>
        </div>
        {refused.length > 0 && <p className="text-sm text-warn">{refused.join(' ')} can't be allowed: they break paths, or some systems refuse them in file names.</p>}
        <p className="text-xs text-text-2">Never allowed: <span className="font-mono">{[...BANNED_CHARS].join(' ')}</span>, a dot first, or spaces at either end.</p>
      </section>

      <section className="space-y-3">
        <div className="label">Big files</div>
        <label className="flex items-center gap-2 text-sm">
          Warn about files over
          <input type="number" min={1} max={500} step={1} className="input !w-24" value={rules.maxFileMB} onChange={(e) => { const n = Number(e.target.value); if (n > 0) setRules({ maxFileMB: n }) }} data-rule-max-mb />
          MB
        </label>
        <p className="text-xs text-text-2">Big pictures load slowly for everyone viewing a profile. The Optimize button on a file shrinks it.</p>
      </section>

      <button type="button" className="btn-ghost" onClick={resetRules} disabled={JSON.stringify(rules) === JSON.stringify(DEFAULT_RULES)}><RotateCcw size={14} />Reset all settings</button>
    </div>
  )
}
