import { Palette, Sparkles, Tag, X } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { cleanTag, MAX_TAGS, specialTag } from '../format/tags'

/** A dot in the colour, when its code is a CSS colour name ("light_blue" → lightblue); else an empty ring. */
export const Swatch = ({ code }: { code: string }) => <span className="inline-block h-2 w-2 rounded-full border border-line" style={{ background: CSS.supports('color', code.replace(/_/g, '')) ? code.replace(/_/g, '') : 'transparent' }} />

/** How a tag reads on a chip: `color:light_blue` as a swatch and "light blue", `theme:x` as a theme. */
export function TagLabel({ tag }: { tag: string }) {
  const sp = specialTag(tag)
  if (!sp) return <>{tag}</>
  const words = sp.code.replace(/_/g, ' ')
  return sp.facet === 'color'
    ? <span className="flex items-center gap-1" title={`Colour (${tag}): Parley's Discover lists it under ${words}`}><Swatch code={sp.code} />{words}</span>
    : <span className="flex items-center gap-1" title={`Theme (${tag}): Parley's Discover lists it under this theme`}><Sparkles size={10} className="text-accent" />{words}</span>
}

/**
 * Tags as chips with a box to add more: Enter, Tab or a comma adds what's typed, Backspace on an empty box takes the
 * last one off, and tags already used elsewhere are offered as you type.
 */
export default function TagInput({ value, onChange, suggestions, placeholder = 'Add a tag', ...rest }: {
  value: string[]
  onChange: (tags: string[]) => void
  /** Tags in use, most used first. */
  suggestions: string[]
  placeholder?: string
} & Record<`data-${string}`, string | boolean>) {
  const [text, setText] = useState('')
  const [focus, setFocus] = useState(false)
  const [hi, setHi] = useState(-1)
  const box = useRef<HTMLInputElement>(null)
  // Escape drops what's typed: the blur that follows mustn't add it.
  const dropping = useRef(false)
  const list = useId()
  const typed = cleanTag(text)
  const offer = suggestions.filter((s) => !value.includes(s) && (!typed || s.includes(typed))).slice(0, 8)
  const full = value.length >= MAX_TAGS

  const add = (t: string) => {
    const c = cleanTag(t)
    if (c && !value.includes(c) && !full) onChange([...value, c])
    setText(''); setHi(-1)
  }
  return (
    <div className="relative" {...rest}>
      <div className="input flex min-h-[38px] cursor-text flex-wrap items-center gap-1 !py-1" onClick={() => box.current?.focus()}>
        {value.map((t) => (
          <span key={t} className={`flex items-center gap-1 rounded py-0.5 pl-2 pr-1 text-xs text-text-0 ${specialTag(t) ? 'border border-accent/40 bg-accent/10' : 'bg-bg-4'}`} data-tag={t}>
            <TagLabel tag={t} />
            <button type="button" className="rounded text-text-2 hover:text-text-0" title={`Remove ${t}`} onClick={(e) => { e.stopPropagation(); onChange(value.filter((x) => x !== t)) }}><X size={12} /></button>
          </span>
        ))}
        <input
          ref={box}
          className="min-w-24 flex-1 bg-transparent py-0.5 text-sm outline-none"
          value={text}
          placeholder={full ? `Up to ${MAX_TAGS} tags` : value.length ? '' : placeholder}
          disabled={full}
          role="combobox"
          aria-expanded={focus && offer.length > 0}
          aria-controls={list}
          onChange={(e) => {
            const v = e.target.value
            // A comma ends a tag, pasted lists included.
            if (v.includes(',')) { const parts = v.split(','); const last = parts.pop() ?? ''; let next = value; for (const p of parts) { const c = cleanTag(p); if (c && !next.includes(c) && next.length < MAX_TAGS) next = [...next, c] } if (next !== value) onChange(next); setText(last) }
            else setText(v)
            setHi(-1)
          }}
          onFocus={() => setFocus(true)}
          onBlur={() => { setFocus(false); if (typed && !dropping.current) add(text); dropping.current = false }}
          onKeyDown={(e) => {
            // Enter or Tab: the suggestion picked with the arrows, else what's typed.
            const pick = hi >= 0 ? offer[hi] : undefined
            if ((e.key === 'Enter' || e.key === 'Tab') && (pick || typed)) { e.preventDefault(); add(pick ?? text) }
            else if (e.key === 'Enter') e.preventDefault()
            else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1))
            else if (e.key === 'ArrowDown' && offer.length) { e.preventDefault(); setHi((hi + 1) % offer.length) }
            else if (e.key === 'ArrowUp' && offer.length) { e.preventDefault(); setHi(hi <= 0 ? offer.length - 1 : hi - 1) }
            else if (e.key === 'Escape') { dropping.current = true; setText(''); e.currentTarget.blur() }
          }}
          data-tag-input
        />
      </div>
      {focus && offer.length > 0 && (
        <ul id={list} role="listbox" className="absolute left-0 top-full z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-line bg-bg-2 p-1 shadow-xl">
          {offer.map((s, i) => (
            <li key={s} role="option" aria-selected={i === hi}>
              {/* mousedown, so it lands before the box loses focus */}
              <button type="button" className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm ${i === hi ? 'bg-bg-4' : 'hover:bg-bg-3'}`} onMouseDown={(e) => { e.preventDefault(); add(s) }} data-tag-suggestion={s}>{specialTag(s) ? <Palette size={12} className="text-accent" /> : <Tag size={12} className="text-text-2" />}{s}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
