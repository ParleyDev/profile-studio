import { useEffect, useState } from 'react'
import { Avatar, ProfileCard, SAMPLE_NAME } from './Sample'

/** Grab a picture's first frame (Parley shows it in lists until the row is hovered). */
function useStill(src: string | undefined) {
  const [still, setStill] = useState<string>()
  useEffect(() => {
    if (!src) return
    let live = true
    const img = new Image()
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = img.naturalWidth; c.height = img.naturalHeight
      c.getContext('2d')?.drawImage(img, 0, 0)
      c.toBlob((b) => { if (live && b) setStill(URL.createObjectURL(b)) })
    }
    img.src = src
    return () => { live = false }
  }, [src])
  useEffect(() => () => { if (still) URL.revokeObjectURL(still) }, [still])
  return still
}

/** A decoration where Parley shows one: messages, the member list, the profile card. Lists play it on hover. */
export default function DecorationPreview({ src, animated }: { src?: string; animated: boolean }) {
  const still = useStill(animated ? src : undefined)
  const [hover, setHover] = useState<string | null>(null)
  const row = (id: string, size: number, body: React.ReactNode) => (
    <div className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-bg-3" onMouseEnter={() => setHover(id)} onMouseLeave={() => setHover(null)}>
      <Avatar size={size} decoration={src} still={hover === id ? undefined : still} />{body}
    </div>
  )
  return (
    <div className="flex flex-wrap items-start gap-8" data-decoration-previews>
      <ProfileCard width={300} decoration={src} />
      <div className="w-72 space-y-6">
        <div>
          <div className="label">In chat</div>
          {row('msg', 40, <div className="min-w-0"><div className="text-sm font-semibold">{SAMPLE_NAME} <span className="ml-1 text-xs font-normal text-text-2">Today at 9:41</span></div><div className="text-sm text-text-1">Trail's dry, who's in for Saturday?</div></div>)}
        </div>
        <div>
          <div className="label">Member list</div>
          {row('member', 32, <span className="text-sm font-medium">{SAMPLE_NAME}</span>)}
        </div>
        <div>
          <div className="label">Sizes</div>
          <div className="flex items-end gap-5 rounded-lg bg-bg-1 p-4">{[24, 32, 40, 80, 120].map((s) => <Avatar key={s} size={s} decoration={src} />)}</div>
        </div>
        {animated && <p className="text-xs text-text-2">Animated: lists show its first frame until the row is hovered, like Parley does. Reduced motion keeps it still everywhere.</p>}
      </div>
    </div>
  )
}
