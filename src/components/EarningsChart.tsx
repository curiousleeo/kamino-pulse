import { useRef, useEffect } from 'react'

interface Props {
  mode: 'day' | 'month' | 'year'
  apy: number       // e.g. 0.0575 = 5.75%
  principal: number // USD
}

function fmt(v: number): string {
  return v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(2)}`
}

export function EarningsChart({ mode, apy, principal }: Props) {
  const days = mode === 'day' ? 1 : mode === 'month' ? 30 : 365
  const points = 60
  const daily = apy / 365
  const data = Array.from({ length: points + 1 }, (_, i) => {
    const t = (i / points) * days
    return principal * (Math.pow(1 + daily, t) - 1)
  })

  const W = 600, H = 140, PT = 8, PB = 20, PL = 40, PR = 8
  const iw = W - PL - PR, ih = H - PT - PB
  const xs = (i: number) => PL + (i / points) * iw
  const max = data[data.length - 1] || 1
  const ys = (v: number) => PT + (1 - v / max) * ih

  const pathRef = useRef<SVGPathElement>(null)
  useEffect(() => {
    const el = pathRef.current
    if (!el) return
    const len = el.getTotalLength()
    el.style.strokeDasharray = String(len)
    el.style.strokeDashoffset = String(len)
    requestAnimationFrame(() => {
      if (!pathRef.current) return
      pathRef.current.style.transition = 'stroke-dashoffset 1s cubic-bezier(.4,0,.2,1)'
      pathRef.current.style.strokeDashoffset = '0'
    })
  }, [mode])

  const d = data.map((v, i) => `${i === 0 ? 'M' : 'L'}${xs(i).toFixed(1)},${ys(v).toFixed(1)}`).join(' ')
  const dArea =
    `M${xs(0)},${ys(0)} ` +
    data.map((v, i) => `L${xs(i).toFixed(1)},${ys(v).toFixed(1)}`).join(' ') +
    ` L${xs(points)},${ys(0)} Z`
  const label = mode === 'day' ? '24h' : mode === 'month' ? '30d' : '1y'

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '100%' }}>
      <defs>
        <linearGradient id="kp-earnGrad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%"   stopColor="var(--green)" stopOpacity="0.3" />
          <stop offset="100%" stopColor="var(--green)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75, 1].map(q => (
        <g key={q}>
          <line x1={PL} x2={W - PR} y1={PT + (1 - q) * ih} y2={PT + (1 - q) * ih} stroke="var(--rule)" strokeDasharray="2 4" />
          <text x={PL - 6} y={PT + (1 - q) * ih + 3} textAnchor="end" fill="var(--text-4)" fontFamily="var(--mono)" fontSize={9}>{fmt(max * q)}</text>
        </g>
      ))}
      <path d={dArea} fill="url(#kp-earnGrad)" />
      <path ref={pathRef} d={d} fill="none" stroke="var(--green)" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx={xs(points)} cy={ys(max)} r="3.5" fill="var(--green)" />
      <circle cx={xs(points)} cy={ys(max)} r="7" fill="var(--green)" opacity="0.25">
        <animate attributeName="r" values="5;10;5" dur="2s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.35;0;0.35" dur="2s" repeatCount="indefinite" />
      </circle>
      <text x={PL} y={H - 4} fill="var(--text-4)" fontFamily="var(--mono)" fontSize={9}>NOW</text>
      <text x={W - PR} y={H - 4} textAnchor="end" fill="var(--text-4)" fontFamily="var(--mono)" fontSize={9}>+{label}</text>
    </svg>
  )
}
