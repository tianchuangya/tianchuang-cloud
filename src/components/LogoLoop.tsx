import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import './LogoLoop.css'

export type LogoLoopItem = {
  node: ReactNode
  title: string
  href?: string
  ariaLabel?: string
}

interface LogoLoopProps {
  logos: LogoLoopItem[]
  speed?: number
  direction?: 'left' | 'right'
  gap?: number
  hoverSpeed?: number
  fadeOut?: boolean
  scaleOnHover?: boolean
  ariaLabel?: string
  className?: string
  style?: CSSProperties
}

const MIN_COPIES = 2

function LogoLoopComponent({
  logos,
  speed = 32,
  direction = 'left',
  gap = 12,
  hoverSpeed = 6,
  fadeOut = true,
  scaleOnHover = true,
  ariaLabel = '项目链接',
  className = '',
  style,
}: LogoLoopProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const sequenceRef = useRef<HTMLUListElement>(null)
  const offsetRef = useRef(0)
  const velocityRef = useRef(0)
  const [sequenceWidth, setSequenceWidth] = useState(0)
  const [copyCount, setCopyCount] = useState(MIN_COPIES)
  const [hovered, setHovered] = useState(false)
  const [reduceMotion, setReduceMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduceMotion(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    const container = containerRef.current
    const sequence = sequenceRef.current
    if (!container || !sequence) return

    const update = () => {
      const width = Math.ceil(sequence.getBoundingClientRect().width)
      if (!width) return
      setSequenceWidth(width)
      setCopyCount(Math.max(MIN_COPIES, Math.ceil(container.clientWidth / width) + 2))
    }
    const observer = new ResizeObserver(update)
    observer.observe(container)
    observer.observe(sequence)
    update()
    return () => observer.disconnect()
  }, [gap, logos])

  useEffect(() => {
    const track = trackRef.current
    if (!track || !sequenceWidth) return
    if (reduceMotion) {
      track.style.transform = 'translate3d(0, 0, 0)'
      return
    }

    let frame = 0
    let previous = performance.now()
    const directionMultiplier = direction === 'left' ? 1 : -1
    const animate = (now: number) => {
      const delta = Math.min((now - previous) / 1000, .05)
      previous = now
      const target = (hovered ? hoverSpeed : speed) * directionMultiplier
      velocityRef.current += (target - velocityRef.current) * (1 - Math.exp(-delta / .25))
      offsetRef.current = ((offsetRef.current + velocityRef.current * delta) % sequenceWidth + sequenceWidth) % sequenceWidth
      track.style.transform = `translate3d(${-offsetRef.current}px, 0, 0)`
      frame = requestAnimationFrame(animate)
    }
    frame = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(frame)
  }, [direction, hovered, hoverSpeed, reduceMotion, sequenceWidth, speed])

  const lists = useMemo(() => Array.from({ length: copyCount }, (_, copyIndex) => (
    <ul
      className="logo-loop-list"
      key={copyIndex}
      ref={copyIndex === 0 ? sequenceRef : undefined}
      aria-hidden={copyIndex > 0}
    >
      {logos.map((item, itemIndex) => (
        <li className="logo-loop-item" key={`${copyIndex}-${itemIndex}`}>
          {item.href ? (
            <a href={item.href} target="_blank" rel="noreferrer noopener" aria-label={item.ariaLabel || item.title} tabIndex={copyIndex > 0 ? -1 : undefined}>
              {item.node}
            </a>
          ) : item.node}
        </li>
      ))}
    </ul>
  )), [copyCount, logos])

  return (
    <div
      ref={containerRef}
      className={`logo-loop ${fadeOut ? 'fade-edges' : ''} ${scaleOnHover ? 'scale-on-hover' : ''} ${className}`.trim()}
      style={{ '--logo-loop-gap': `${gap}px`, ...style } as CSSProperties}
      role="region"
      aria-label={ariaLabel}
    >
      <div
        ref={trackRef}
        className="logo-loop-track"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {lists}
      </div>
    </div>
  )
}

const LogoLoop = memo(LogoLoopComponent)
LogoLoop.displayName = 'LogoLoop'

export default LogoLoop
