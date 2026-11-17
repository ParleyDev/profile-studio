import type { ReactNode } from 'react'

/** A made-up member to dress up: a drawn avatar, so no real person's picture is ever needed. */
export const SAMPLE_NAME = 'Maya'
export const SAMPLE_AVATAR = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7c6cff"/><stop offset="1" stop-color="#ff7ab6"/></linearGradient></defs><rect width="128" height="128" fill="url(#g)"/><circle cx="64" cy="52" r="24" fill="#fff" opacity=".9"/><path d="M20 128c6-28 24-40 44-40s38 12 44 40z" fill="#fff" opacity=".9"/></svg>`,
)}`

/**
 * An avatar the way Parley draws one with a picture decoration: the decoration is a square 1.2× the avatar, centred
 * over it, with the avatar showing through its middle.
 */
export function Avatar({ size, decoration, still }: { size: number; decoration?: string; still?: string }) {
  return (
    <span className="relative inline-block shrink-0" style={{ width: size, height: size }}>
      <img src={SAMPLE_AVATAR} alt="" className="h-full w-full rounded-full" draggable={false} />
      {decoration && <img src={still ?? decoration} alt="" draggable={false} className="pointer-events-none absolute max-w-none select-none" style={{ width: '120%', height: '120%', left: '-10%', top: '-10%' }} data-decoration-preview />}
    </span>
  )
}

/** A profile card like Parley's popout: banner, avatar over its edge, name and a few lines. */
export function ProfileCard({ width, height, decoration, children, theme = '#232428' }: { width: number; height?: number; decoration?: string; children?: ReactNode; theme?: string }) {
  return (
    <div className="relative flex flex-col overflow-hidden rounded-2xl text-white" style={{ width, height, minHeight: height ? undefined : 360, background: theme }} data-profile-card>
      {children}
      <div className="h-[105px] w-full shrink-0" style={{ background: 'linear-gradient(120deg, #3b2f8f, #8a3f8c)' }} />
      <div className="-mt-11 flex shrink-0 items-end px-4">
        <div className="relative rounded-full bg-[#232428] ring-[6px] ring-[#232428]"><Avatar size={80} decoration={decoration} /></div>
      </div>
      <div className="space-y-3 px-4 pb-4 pt-3">
        <div>
          <div className="text-xl font-bold leading-tight">{SAMPLE_NAME}</div>
          <div className="text-sm text-white/60">maya · she/her</div>
        </div>
        <div className="rounded-lg bg-white/[.06] p-3 text-sm text-white/80">
          <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-white/50">About me</div>
          Weekend hiker, weekday coder. Ask me about trail maps.
        </div>
        <div className="rounded-lg bg-white/[.06] p-3 text-sm text-white/60">Member since Mar 2026</div>
      </div>
    </div>
  )
}
