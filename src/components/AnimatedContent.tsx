import { useEffect, useRef, type HTMLAttributes, type ReactNode } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

interface AnimatedContentProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  container?: Element | string | null
  distance?: number
  direction?: 'horizontal' | 'vertical'
  reverse?: boolean
  duration?: number
  ease?: string
  initialOpacity?: number
  animateOpacity?: boolean
  scale?: number
  threshold?: number
  delay?: number
  disappearAfter?: number
  disappearDuration?: number
  disappearEase?: string
  onComplete?: () => void
  onDisappearanceComplete?: () => void
}

export default function AnimatedContent({
  children,
  container,
  distance = 36,
  direction = 'vertical',
  reverse = false,
  duration = .72,
  ease = 'power3.out',
  initialOpacity = 0,
  animateOpacity = true,
  scale = .985,
  threshold = .08,
  delay = 0,
  disappearAfter = 0,
  disappearDuration = .5,
  disappearEase = 'power3.in',
  onComplete,
  onDisappearanceComplete,
  className = '',
  ...props
}: AnimatedContentProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduceMotion) {
      gsap.set(element, { clearProps: 'all', visibility: 'visible' })
      return
    }

    let scroller: Element | null = null
    if (typeof container === 'string') scroller = document.querySelector(container)
    else if (container instanceof Element) scroller = container
    else scroller = document.getElementById('snap-main-container')

    const axis = direction === 'horizontal' ? 'x' : 'y'
    const offset = reverse ? -distance : distance
    const startPct = (1 - threshold) * 100
    const context = gsap.context(() => {
      gsap.set(element, {
        [axis]: offset,
        scale,
        opacity: animateOpacity ? initialOpacity : 1,
        visibility: 'visible',
      })

      const timeline = gsap.timeline({
        paused: true,
        delay,
        onComplete: () => {
          onComplete?.()
          if (disappearAfter > 0) {
            gsap.to(element, {
              [axis]: reverse ? distance : -distance,
              scale: .8,
              opacity: animateOpacity ? initialOpacity : 0,
              delay: disappearAfter,
              duration: disappearDuration,
              ease: disappearEase,
              onComplete: onDisappearanceComplete,
            })
          }
        },
      })

      timeline.to(element, { [axis]: 0, scale: 1, opacity: 1, duration, ease })
      ScrollTrigger.create({
        trigger: element,
        ...(scroller ? { scroller } : {}),
        start: `top ${startPct}%`,
        once: true,
        onEnter: () => timeline.play(),
      })
    }, element)

    return () => context.revert()
  }, [
    animateOpacity, container, delay, direction, disappearAfter, disappearDuration,
    disappearEase, distance, duration, ease, initialOpacity, onComplete,
    onDisappearanceComplete, reverse, scale, threshold,
  ])

  return <div ref={ref} className={`animated-content ${className}`.trim()} style={{ visibility: 'hidden' }} {...props}>{children}</div>
}
