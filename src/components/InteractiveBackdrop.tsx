import { lazy, Suspense } from 'react'

const RippleDistortion = lazy(() => import('./RippleDistortion.jsx'))

export default function InteractiveBackdrop({ ripple }: { ripple: boolean }) {
  return (
    <div className="interactive-backdrop" aria-hidden="true">
      {ripple ? (
        <Suspense fallback={<div className="static-backdrop" />}>
          <RippleDistortion
            src="/assets/cloud-glass-bg.png"
            brushSize={185}
            strength={0.035}
            swirl={0.35}
            rings={2}
            spread={3.2}
            fade={1.8}
            spacing={30}
            dispersion={0.018}
            glint={0.16}
            tint="#77dce8"
            tintAmount={0.08}
            highlightColor="#e7fbff"
            grayscale={false}
            trigger="both"
            clickStrength={1.35}
            quality="low"
            style={{}}
          />
        </Suspense>
      ) : <div className="static-backdrop" />}
    </div>
  )
}
