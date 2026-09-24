import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { CursorPreferences } from './cursor-preferences'

const SplashCursor = lazy(() => import('./SplashCursor.jsx'))

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function RectangleCursor() {
  const cursorRef = useRef<HTMLDivElement>(null)
  const [interactive, setInteractive] = useState(false)
  const [pressed, setPressed] = useState(false)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const cursor = cursorRef.current
    if (!cursor) return
    let frame = 0
    let x = window.innerWidth / 2
    let y = window.innerHeight / 2

    const render = () => {
      cursor.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`
      frame = 0
    }
    const move = (event: PointerEvent) => {
      x = event.clientX
      y = event.clientY
      setVisible(true)
      if (!frame) frame = requestAnimationFrame(render)
    }
    const over = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null
      setInteractive(Boolean(target?.closest('button, input, select, label, [role="button"]')))
    }
    const down = () => setPressed(true)
    const up = () => setPressed(false)
    const hide = () => { setVisible(false); setPressed(false) }
    window.addEventListener('pointermove', move, { passive: true })
    window.addEventListener('pointerover', over, { passive: true })
    window.addEventListener('pointerdown', down, { passive: true })
    window.addEventListener('pointerup', up, { passive: true })
    window.addEventListener('blur', hide)
    document.documentElement.addEventListener('pointerleave', hide)
    render()
    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerover', over)
      window.removeEventListener('pointerdown', down)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('blur', hide)
      document.documentElement.removeEventListener('pointerleave', hide)
    }
  }, [])

  return <div ref={cursorRef} className={`custom-cursor ${visible ? 'visible' : ''} ${interactive ? 'interactive' : ''} ${pressed ? 'pressed' : ''}`} aria-hidden="true"><i /></div>
}

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  size: number
  color: string
}

function FireworkCursor() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    const particles: Particle[] = []
    let frame = 0
    let dpr = 1

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(window.innerWidth * dpr)
      canvas.height = Math.round(window.innerHeight * dpr)
      canvas.style.width = `${window.innerWidth}px`
      canvas.style.height = `${window.innerHeight}px`
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    const draw = () => {
      context.clearRect(0, 0, window.innerWidth, window.innerHeight)
      for (let index = particles.length - 1; index >= 0; index -= 1) {
        const particle = particles[index]
        particle.vy += .055
        particle.vx *= .985
        particle.vy *= .985
        particle.x += particle.vx
        particle.y += particle.vy
        particle.life -= .035
        if (particle.life <= 0) {
          particles.splice(index, 1)
          continue
        }
        context.globalAlpha = Math.max(0, particle.life)
        context.fillStyle = particle.color
        context.beginPath()
        context.arc(particle.x, particle.y, particle.size * particle.life, 0, Math.PI * 2)
        context.fill()
      }
      context.globalAlpha = 1
      frame = particles.length ? requestAnimationFrame(draw) : 0
    }
    const burst = (event: PointerEvent) => {
      const colors = ['#9eeef5', '#ffffff', '#ff9c83', '#74d7e4']
      for (let index = 0; index < 26; index += 1) {
        const angle = (Math.PI * 2 * index) / 26 + Math.random() * .16
        const speed = 1.8 + Math.random() * 4.2
        particles.push({
          x: event.clientX,
          y: event.clientY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: .75 + Math.random() * .25,
          size: 1.4 + Math.random() * 2.2,
          color: colors[index % colors.length],
        })
      }
      if (!frame) frame = requestAnimationFrame(draw)
    }

    resize()
    window.addEventListener('resize', resize)
    window.addEventListener('pointerdown', burst, { passive: true })
    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointerdown', burst)
    }
  }, [])

  return <canvas ref={canvasRef} className="cursor-effect-canvas" aria-hidden="true" />
}

export default function CursorExperience({ preferences }: { preferences: CursorPreferences }) {
  const [reduceMotion, setReduceMotion] = useState(prefersReducedMotion)

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduceMotion(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  return <>
    {preferences.style === 'rectangle' && <RectangleCursor />}
    {!reduceMotion && preferences.effect === 'fluid' && (
      <Suspense fallback={null}><SplashCursor
        DENSITY_DISSIPATION={3.5}
        VELOCITY_DISSIPATION={2}
        PRESSURE={0.1}
        CURL={3}
        SPLAT_RADIUS={0.2}
        SPLAT_FORCE={6000}
        COLOR_UPDATE_SPEED={10}
        SHADING
        RAINBOW_MODE={false}
        COLOR="#A855F7"
      /></Suspense>
    )}
    {!reduceMotion && preferences.effect === 'fireworks' && <FireworkCursor />}
  </>
}
