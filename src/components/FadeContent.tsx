import { useEffect, useRef, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

interface FadeContentProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onComplete'> {
  children: ReactNode
  container?: Element | string | null
  blur?: boolean
  blurAmount?: number
  duration?: number
  ease?: string
  delay?: number
  threshold?: number
  initialOpacity?: number
  trigger?: 'mount' | 'viewport'
  onComplete?: () => void
}

const toSeconds = (value: number) => value > 10 ? value / 1000 : value

export default function FadeContent({
  children,
  container,
  blur = true,
  blurAmount = 6,
  duration = 260,
  ease = 'power3.out',
  delay = 0,
  threshold = .08,
  initialOpacity = 0,
  trigger = 'mount',
  onComplete,
  className = '',
  style,
  ...props
}: FadeContentProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      gsap.set(element, { autoAlpha: 1, filter: 'none', clearProps: 'willChange' })
      onComplete?.()
      return
    }

    let scroller: Element | null = null
    if (typeof container === 'string') scroller = document.querySelector(container)
    else if (container instanceof Element) scroller = container

    const context = gsap.context(() => {
      gsap.set(element, {
        autoAlpha: initialOpacity,
        filter: blur ? `blur(${blurAmount}px)` : 'none',
        willChange: blur ? 'opacity, filter' : 'opacity',
      })

      const tween = gsap.to(element, {
        autoAlpha: 1,
        filter: 'blur(0px)',
        duration: toSeconds(duration),
        delay: toSeconds(delay),
        ease,
        paused: trigger === 'viewport',
        onComplete: () => {
          gsap.set(element, { clearProps: 'filter,willChange' })
          onComplete?.()
        },
      })

      if (trigger === 'viewport') {
        ScrollTrigger.create({
          trigger: element,
          ...(scroller ? { scroller } : {}),
          start: `top ${(1 - threshold) * 100}%`,
          once: true,
          onEnter: () => tween.play(),
        })
      }
    }, element)

    return () => context.revert()
  }, [blur, blurAmount, container, delay, duration, ease, initialOpacity, onComplete, threshold, trigger])

  const initialStyle: CSSProperties = { visibility: 'hidden', ...style }
  return <div ref={ref} className={`fade-content ${className}`.trim()} style={initialStyle} {...props}>{children}</div>
}
