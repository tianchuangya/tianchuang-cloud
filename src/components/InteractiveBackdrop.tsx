import { lazy, Suspense } from 'react'
import type { CSSProperties } from 'react'
import type { BackgroundEffect } from './cursor-preferences'

const RippleDistortion = lazy(() => import('./RippleDistortion.jsx'))

export default function InteractiveBackdrop({ effect, image }: { effect: BackgroundEffect; image?: string }) {
  const source = image || '/assets/cloud-glass-bg.png'
  const backgroundStyle = { '--background-image': `url("${source}")` } as CSSProperties
  return (
    <div className={`interactive-backdrop effect-${effect}`} style={backgroundStyle} aria-hidden="true">
      {effect === 'ripple' ? (
        <Suspense fallback={<div className="static-backdrop" />}>
          <RippleDistortion
            src={source}
            brushSize={240}
            strength={0.085}
            swirl={0.5}
            rings={3}
            spread={3.8}
            fade={2.3}
            spacing={26}
            dispersion={0.032}
            glint={0.28}
            tint="#77dce8"
            tintAmount={0.16}
            highlightColor="#e7fbff"
            grayscale={false}
            trigger="both"
            clickStrength={1.8}
            quality="low"
            style={{}}
          />
        </Suspense>
      ) : <div className="static-backdrop" />}
      {effect === 'rays' && <div className="background-effect-rays" />}
      {effect === 'particles' && <div className="background-effect-particles"><i /><i /><i /></div>}
    </div>
  )
}
