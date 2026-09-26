import { Mesh, Program, Renderer, Triangle } from 'ogl'
import { useEffect, useRef } from 'react'

const vertex = `
attribute vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`

const fragment = `
precision highp float;
uniform vec2 uResolution;
uniform vec2 uMouse;
uniform float uTime;
uniform float uVariant;

#define PI 3.14159265359

float contourField(vec2 p, float t) {
  float v = sin((p.x + sin(p.y * 1.8 + t) * .25) * 7.0);
  v += cos((p.y + cos(p.x * 1.5 - t * .7) * .22) * 8.0);
  return v * .5;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution.xy;
  vec2 p = (uv * 2.0 - 1.0) * vec2(uResolution.x / uResolution.y, 1.0);
  vec2 mouse = (uMouse * 2.0 - 1.0) * .12;
  p += mouse;
  float t = uTime;
  vec3 color = vec3(0.0);
  float alpha = 0.0;

  if (uVariant < .5) {
    float d = -t * .34;
    float a = 0.0;
    for (float i = 0.0; i < 7.0; i++) {
      a += cos(i - d - a * p.x);
      d += sin(p.y * i + a);
    }
    vec3 sheen = vec3(cos(p * vec2(d, a)) * .5 + .5, cos(a + d) * .5 + .5);
    color = sheen * vec3(.38, .72, .88);
    alpha = .42 + length(color) * .18;
  } else if (uVariant < 1.5) {
    float sum = 0.0;
    for (float i = 0.0; i < 7.0; i++) {
      float spread = abs(p.x) * (.08 + i * .025);
      float line = abs(p.y + sin(p.x * 4.5 + t * .42 + i * .9) * spread);
      float glow = .0035 / max(line, .003);
      vec3 threadColor = mix(vec3(.32, .86, .92), vec3(.72, .45, .88), i / 6.0);
      color += glow * threadColor;
      sum += glow;
    }
    alpha = clamp(sum * .7, 0.0, .72);
  } else {
    float field = contourField(p * 1.6, t * .18);
    float bands = abs(fract(field * 5.0) - .5);
    float lines = 1.0 - smoothstep(.025, .065, bands);
    float glow = 1.0 - smoothstep(.04, .18, bands);
    vec3 low = vec3(.22, .72, .78);
    vec3 high = vec3(.73, .50, .88);
    color = mix(low, high, smoothstep(-1.0, 1.0, field)) * (lines + glow * .32);
    alpha = clamp(lines * .78 + glow * .15, 0.0, .82);
  }
  gl_FragColor = vec4(color * alpha, alpha);
}
`

const variantNumber = { iridescence: 0, threads: 1, topography: 2 }

export default function OglBackdrop({ variant = 'iridescence' }) {
  const containerRef = useRef(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const renderer = new Renderer({ alpha: true, dpr: Math.min(window.devicePixelRatio || 1, 1.5) })
    const gl = renderer.gl
    gl.clearColor(0, 0, 0, 0)
    gl.canvas.style.cssText = 'display:block;width:100%;height:100%'
    container.appendChild(gl.canvas)

    const program = new Program(gl, {
      vertex,
      fragment,
      transparent: true,
      uniforms: {
        uResolution: { value: new Float32Array([1, 1]) },
        uMouse: { value: new Float32Array([.5, .5]) },
        uTime: { value: 0 },
        uVariant: { value: variantNumber[variant] ?? 0 },
      },
    })
    const mesh = new Mesh(gl, { geometry: new Triangle(gl), program })
    const resize = () => {
      renderer.setSize(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight))
      program.uniforms.uResolution.value[0] = gl.drawingBufferWidth
      program.uniforms.uResolution.value[1] = gl.drawingBufferHeight
    }
    const observer = new ResizeObserver(resize)
    observer.observe(container)
    resize()

    const target = [.5, .5]
    const current = [.5, .5]
    const move = event => {
      target[0] = event.clientX / Math.max(window.innerWidth, 1)
      target[1] = 1 - event.clientY / Math.max(window.innerHeight, 1)
    }
    window.addEventListener('pointermove', move, { passive: true })
    let frame = 0
    let visible = true
    let pageVisible = !document.hidden
    const render = time => {
      current[0] += (target[0] - current[0]) * .035
      current[1] += (target[1] - current[1]) * .035
      program.uniforms.uMouse.value[0] = current[0]
      program.uniforms.uMouse.value[1] = current[1]
      program.uniforms.uTime.value = time * .001
      renderer.render({ scene: mesh })
      frame = visible && pageVisible ? requestAnimationFrame(render) : 0
    }
    const start = () => { if (!frame && visible && pageVisible) frame = requestAnimationFrame(render) }
    const stop = () => { if (frame) cancelAnimationFrame(frame); frame = 0 }
    const visibilityObserver = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
      if (visible) start()
      else stop()
    })
    const onVisibilityChange = () => {
      pageVisible = !document.hidden
      if (pageVisible) start()
      else stop()
    }
    visibilityObserver.observe(container)
    document.addEventListener('visibilitychange', onVisibilityChange)
    start()

    return () => {
      stop()
      observer.disconnect()
      visibilityObserver.disconnect()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pointermove', move)
      gl.canvas.remove()
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  }, [variant])

  return <div className="ogl-backdrop" ref={containerRef} />
}
