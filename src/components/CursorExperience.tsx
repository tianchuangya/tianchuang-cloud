import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties } from 'react'
import type { CursorPreferences } from './cursor-preferences'

const SplashCursor = lazy(() => import('./SplashCursor.jsx'))

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function RectangleCursor({ preferences }: { preferences: CursorPreferences }) {
  const cursorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const cursor = cursorRef.current
    if (!cursor) return
    let frame = 0
    let x = window.innerWidth / 2
    let y = window.innerHeight / 2
    let activeTarget: HTMLElement | null = null
    let feedbackTimer = 0

    const interactiveSelector = [
      'button:not(:disabled)',
      'input:not(:disabled)',
      'select:not(:disabled)',
      'textarea:not(:disabled)',
      'a[href]',
      'label.setting-row',
      '[role="button"]:not([aria-disabled="true"])',
      '[role="tab"]:not([aria-disabled="true"])',
    ].join(',')

    const render = () => {
      if (activeTarget?.isConnected) {
        const rect = activeTarget.getBoundingClientRect()
        const padding = 3
        const radius = Number.parseFloat(getComputedStyle(activeTarget).borderRadius) || 0
        cursor.style.width = `${Math.max(18, rect.width + padding * 2)}px`
        cursor.style.height = `${Math.max(18, rect.height + padding * 2)}px`
        cursor.style.borderRadius = `${Math.min((rect.height + padding * 2) / 2, radius + padding)}px`
        cursor.style.transform = `translate3d(${rect.left + rect.width / 2}px, ${rect.top + rect.height / 2}px, 0) translate(-50%, -50%)`
      } else {
        cursor.style.removeProperty('width')
        cursor.style.removeProperty('height')
        cursor.style.removeProperty('border-radius')
        cursor.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`
      }
      frame = 0
    }
    const scheduleRender = () => {
      if (!frame) frame = requestAnimationFrame(render)
    }
    const findTarget = (eventTarget: EventTarget | null) => {
      const element = eventTarget instanceof Element ? eventTarget.closest<HTMLElement>(interactiveSelector) : null
      return element?.getAttribute('aria-hidden') === 'true' ? null : element
    }
    const move = (event: PointerEvent) => {
      x = event.clientX
      y = event.clientY
      cursor.classList.add('visible')
      const nextTarget = findTarget(event.target)
      if (nextTarget !== activeTarget) {
        activeTarget = nextTarget
        cursor.classList.toggle('targeting', Boolean(activeTarget))
      }
      scheduleRender()
    }
    const down = (event: PointerEvent) => {
      cursor.classList.add('pressed')
      const feedbackClass = event.button === 2 ? 'secondary-click' : 'primary-click'
      cursor.classList.remove('primary-click', 'secondary-click')
      void cursor.offsetWidth
      cursor.classList.add(feedbackClass)
      window.clearTimeout(feedbackTimer)
      feedbackTimer = window.setTimeout(() => cursor.classList.remove(feedbackClass), 340)
    }
    const up = () => cursor.classList.remove('pressed')
    const hide = () => {
      activeTarget = null
      cursor.classList.remove('visible', 'targeting', 'pressed')
    }
    window.addEventListener('pointermove', move, { passive: true })
    window.addEventListener('pointerdown', down, { passive: true })
    window.addEventListener('pointerup', up, { passive: true })
    window.addEventListener('resize', scheduleRender, { passive: true })
    window.addEventListener('scroll', scheduleRender, { passive: true, capture: true })
    window.addEventListener('blur', hide)
    document.documentElement.addEventListener('pointerleave', hide)
    render()
    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.clearTimeout(feedbackTimer)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerdown', down)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('resize', scheduleRender)
      window.removeEventListener('scroll', scheduleRender, true)
      window.removeEventListener('blur', hide)
      document.documentElement.removeEventListener('pointerleave', hide)
    }
  }, [])

  return <div ref={cursorRef} className="custom-cursor" style={{ '--cursor-color': preferences.cursorColor, '--cursor-target-color': preferences.cursorTargetColor } as CSSProperties} aria-hidden="true"><i /></div>
}

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  size: number
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
        particle.vy += .035
        particle.vx *= .99
        particle.vy *= .99
        particle.x += particle.vx
        particle.y += particle.vy
        particle.life -= .018
        if (particle.life <= 0) {
          particles.splice(index, 1)
          continue
        }
        context.globalAlpha = Math.max(0, particle.life)
        context.fillStyle = '#ffffff'
        context.shadowColor = 'rgba(255, 255, 255, .72)'
        context.shadowBlur = 6
        context.beginPath()
        context.arc(particle.x, particle.y, particle.size * particle.life, 0, Math.PI * 2)
        context.fill()
      }
      context.globalAlpha = 1
      context.shadowBlur = 0
      frame = particles.length ? requestAnimationFrame(draw) : 0
    }
    const burst = (event: PointerEvent) => {
      for (let index = 0; index < 26; index += 1) {
        const angle = (Math.PI * 2 * index) / 26 + Math.random() * .16
        const speed = 1.15 + Math.random() * 2.75
        particles.push({
          x: event.clientX,
          y: event.clientY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: .82 + Math.random() * .18,
          size: 1.2 + Math.random() * 1.8,
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
    {preferences.style === 'rectangle' && <RectangleCursor preferences={preferences} />}
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
