import { AlertTriangle, CircleAlert, Plus } from 'lucide-react'
import { memo } from 'react'
import { KIND_LABELS, type Kind } from '../format/kinds'
import type { Problem } from '../format/validate'
import { keyOf, type Item } from '../format/workspace'
import Thumb from './Thumb'

const Card = memo(function Card({ item, err, warn, onOpen }: { item: Item; err: number; warn: number; onOpen: (uid: string) => void }) {
  return (
    <button type="button" className="group flex flex-col gap-2 rounded-lg border border-line bg-bg-1 p-2 text-left hover:border-accent/60" style={{ contentVisibility: 'auto', containIntrinsicSize: '160px 190px' }} onClick={() => onOpen(item.uid)} data-gallery-card={keyOf(item)}>
      {item.kind === 'nameplate' ? <Thumb item={item} size={320} height={72} className="!w-full" /> : <Thumb item={item} size={140} className="!w-full" />}
      <div className="flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate text-sm">{(item.entry.name as string) || keyOf(item) || 'Untitled'}</span>
        {err > 0 && <CircleAlert size={13} className="shrink-0 text-danger" aria-label={`${err} errors`} />}
        {!err && warn > 0 && <AlertTriangle size={13} className="shrink-0 text-warn" aria-label={`${warn} warnings`} />}
      </div>
      <span className="truncate font-mono text-[11px] text-text-2">{keyOf(item)}</span>
    </button>
  )
})

/** Every item of a kind as a grid of stills; each card decodes its still only when it scrolls into view. */
export default function Gallery({ kind, items, total, problems, onOpen, onNew }: { kind: Kind; items: Item[]; total: number; problems: Map<string, Problem[]>; onOpen: (uid: string) => void; onNew: () => void }) {
  return (
    <div className="space-y-4" data-gallery={kind}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{KIND_LABELS[kind].many}</h1>
          <p className="text-sm text-text-2">{items.length === total ? `${total} item${total === 1 ? '' : 's'}` : `${items.length} of ${total} shown`} · {KIND_LABELS[kind].blurb}</p>
        </div>
        <button type="button" className="btn-ghost" onClick={onNew}><Plus size={16} />New {KIND_LABELS[kind].one.toLowerCase()}</button>
      </div>
      {items.length ? (
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${kind === 'nameplate' ? 300 : 160}px, 1fr))` }}>
          {items.map((it) => {
            const list = problems.get(it.uid) ?? []
            const err = list.filter((p) => p.level === 'error').length
            return <Card key={it.uid} item={it} err={err} warn={list.length - err} onOpen={onOpen} />
          })}
        </div>
      ) : <p className="text-sm text-text-2">Nothing here{total ? ' matches the search or filter' : ' yet'}.</p>}
    </div>
  )
}
