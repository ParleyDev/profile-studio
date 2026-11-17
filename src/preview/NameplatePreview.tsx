import { useEffect, useRef } from 'react'
import { Avatar, SAMPLE_NAME } from './Sample'

/** The picture or loop behind a list row, right-aligned at the row's height and faded in from the left (Parley's). */
function Plate({ src, video, playing }: { src: string; video: boolean; playing: boolean }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => { const v = ref.current; if (!v) return; if (playing) void v.play().catch(() => {}); else v.pause() }, [playing, src])
  const cls = 'np-video np-fit pointer-events-none absolute inset-y-0 right-0 -z-10 h-full w-auto max-w-none'
  return video ? <video ref={ref} className={cls} src={src} muted loop playsInline preload="metadata" aria-hidden /> : <img className={cls} src={src} alt="" aria-hidden draggable={false} />
}

export default function NameplatePreview({ src, video }: { src?: string; video: boolean }) {
  const rows = [
    { w: 240, label: 'Member list', playing: false },
    { w: 240, label: 'Member list, hovered', playing: true },
    { w: 300, label: 'Direct messages, the open conversation', playing: true },
  ]
  return (
    <div className="space-y-5" data-nameplate-previews>
      {rows.map((r) => (
        <div key={r.label}>
          <div className="label">{r.label}</div>
          <div className="rounded-lg bg-bg-1 p-2" style={{ width: r.w + 16 }}>
            <div className={`relative isolate flex items-center gap-3 overflow-hidden rounded-md px-2 py-1.5 ${r.playing ? 'bg-bg-3' : ''}`} style={{ width: r.w }}>
              {src && <Plate src={src} video={video} playing={r.playing} />}
              <Avatar size={32} />
              <span className="min-w-0 flex-1 leading-tight"><span className="block truncate text-sm font-medium">{SAMPLE_NAME}</span><span className="block truncate text-xs text-text-2">Out on the trail</span></span>
            </div>
          </div>
        </div>
      ))}
      <p className="max-w-md text-xs text-text-2">Rows are about 44 px tall, so the nameplate is scaled to that height and fixed to the right. Its left side fades out behind the name. Phones get an animated WebP Parley makes from a video.</p>
    </div>
  )
}
