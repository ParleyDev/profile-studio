import { Download } from 'lucide-react'
import { useMemo, useState } from 'react'
import { KIND_LABELS, KINDS, type Kind } from '../format/kinds'
import { writeZip } from '../format/zip'
import { download } from '../lib/io'
import { setBusy } from '../lib/store'
import { buildAllTemplates, buildTemplatePack, TEMPLATE_FORMATS, TEMPLATE_KINDS, toSvg, type TemplateFormat } from '../templates'

/** A kind's guides, drawn from its SVG template. */
function Preview({ kind }: { kind: Kind }) {
  const src = useMemo(() => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(toSvg(TEMPLATE_KINDS[kind]))}`, [kind])
  return <div className="checker flex h-48 items-center justify-center overflow-hidden rounded-lg p-2"><img src={src} alt="" className="max-h-full max-w-full" /></div>
}

/** Templates to draw new cosmetics in other apps: guides at Parley's exact sizes, layers named for Parley's files. */
export default function Templates() {
  const [formats, setFormats] = useState<TemplateFormat[]>(['psd', 'svg', 'png', 'motion', 'vectorcraft', 'effectcraft', 'anicraft'])
  const toggle = (f: TemplateFormat) => setFormats(formats.includes(f) ? formats.filter((x) => x !== f) : [...formats, f])
  const get = async (kind: Kind | 'all') => {
    setBusy({ label: 'Making the templates', done: 0, total: 0 })
    try {
      const files = kind === 'all' ? await buildAllTemplates(formats) : await buildTemplatePack(kind, formats)
      download(await writeZip(files), kind === 'all' ? 'parley-templates.zip' : `parley-${kind}-template.zip`)
    } finally { setBusy(null) }
  }
  return (
    <div className="space-y-6" data-templates>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Templates</h1>
          <p className="mt-1 max-w-2xl text-sm text-text-2">
            Start a cosmetic in your own app: each template is Parley's exact size, with guides for the avatar, card and safe areas, and layers
            named after the files Parley expects. Every pack has a README on drawing and exporting.
          </p>
        </div>
        <button type="button" className="btn-primary" disabled={!formats.length} onClick={() => void get('all')} data-template-all><Download size={16} />All kinds</button>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Formats">
        {TEMPLATE_FORMATS.map((f) => (
          <label key={f.id} className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm ${formats.includes(f.id) ? 'border-accent bg-accent/10' : 'border-line hover:bg-bg-3'}`} title={f.apps}>
            <input type="checkbox" className="mt-0.5" checked={formats.includes(f.id)} onChange={() => toggle(f.id)} data-template-format={f.id} />
            <span><span className="block font-semibold">{f.title}</span><span className="text-xs text-text-2">{f.apps}</span></span>
          </label>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {KINDS.map((k) => {
          const t = TEMPLATE_KINDS[k]
          return (
            <div key={k} className="flex flex-col gap-3 rounded-lg border border-line bg-bg-1 p-3" data-template-kind={k}>
              <Preview kind={k} />
              <div className="flex-1">
                <div className="font-semibold">{KIND_LABELS[k].one}</div>
                <div className="font-mono text-xs text-text-2">{t.width} × {t.height}{k === 'frame' ? ' + pieces' : ''}</div>
                <p className="mt-1 text-xs text-text-2">{KIND_LABELS[k].blurb}</p>
              </div>
              <button type="button" className="btn-ghost bg-bg-3" disabled={!formats.length} onClick={() => void get(k)} data-template-get={k}><Download size={14} />Download</button>
            </div>
          )
        })}
      </div>
      <p className="text-xs text-text-2">Animated work: export a PNG sequence from your app; Profile Studio turns it into the animated PNG Parley plays.</p>
    </div>
  )
}
