import { lazy, Suspense, useEffect, useRef } from 'react'
import { Cloud, CornerDownRight } from 'lucide-react'
import { motion } from 'motion/react'
import type { StartupEffect } from './cursor-preferences'
import './StartupExperience.css'

const SoftAurora = lazy(() => import('./effects/SoftAurora.jsx'))

interface StartupExperienceProps {
  ready: boolean
  effect: StartupEffect
  onComplete: () => void
}

export default function StartupExperience({ ready, effect, onComplete }: StartupExperienceProps) {
  const startedAt = useRef(0)
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  useEffect(() => {
    startedAt.current = performance.now()
  }, [])

  useEffect(() => {
    if (!ready) return
    const minimum = reduceMotion ? 380 : 1250
    const remaining = Math.max(0, minimum - (performance.now() - startedAt.current))
    const timer = window.setTimeout(onComplete, remaining)
    return () => window.clearTimeout(timer)
  }, [onComplete, ready, reduceMotion])

  useEffect(() => {
    const skip = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Enter') onComplete()
    }
    window.addEventListener('keydown', skip)
    return () => window.removeEventListener('keydown', skip)
  }, [onComplete])

  return (
    <motion.section
      className={`startup-experience startup-${effect}`}
      initial={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.012, filter: 'blur(7px)' }}
      transition={{ duration: reduceMotion ? .12 : .52, ease: [0.22, 1, 0.36, 1] }}
      aria-label="天创云端启动画面"
    >
      <div className="startup-image" />
      {effect === 'aurora' ? (
        <div className="startup-effect-layer"><Suspense fallback={null}><SoftAurora speed={.42} scale={1.45} brightness={1.05} color1="#dffcff" color2="#a97ed4" noiseFrequency={2.25} noiseAmplitude={.88} bandHeight={.5} bandSpread={1.2} octaveDecay={.14} colorSpeed={.52} enableMouseInteraction={false} /></Suspense></div>
      ) : <div className="startup-light-sweep" />}
      <div className="startup-shade" />
      <motion.div className="startup-brand" initial={{ opacity: 0, y: 12, scale: .97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ delay: reduceMotion ? 0 : .18, duration: .58, ease: [0.22, 1, 0.36, 1] }}>
        <span className="startup-mark"><Cloud size={31} strokeWidth={2.1} /></span>
        <h1>天创云端</h1>
        <p>Tianchuang Cloud</p>
      </motion.div>
      <div className="startup-status" aria-live="polite">
        <span className={ready ? 'ready' : ''}><i />{ready ? '资料库已准备完成' : '正在准备资料库'}</span>
        <button onClick={onComplete}>跳过<CornerDownRight size={14} /></button>
      </div>
    </motion.section>
  )
}
