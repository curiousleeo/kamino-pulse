import { useRef, useEffect, useState } from 'react'

interface Props {
  data: number[]
  range: '7D' | '30D' | '90D'
}

export function RiskSparkline({ data, range }: Props) {
  const n = range === '7D' ? 7 : range === '30D' ? 30 : 90
  const slice = data.slice(-n)
  const W = 700, H = 120, PT = 10, PB = 18, PL = 32, PR = 8
  const iw = W - PL - PR, ih = H - PT - PB
  const xs = (i: number) => PL + (i / (slice.length - 1)) * iw
  const ys = (v: number) => PT + (1 - (v - 30) / 70) * ih

  const [hover, setHover] = useState<{ i: number; v: number } | null>(null)
  const pathRef = useRef<SVGPathElement>(null)

  const d = slice.map((v, i) => `${i === 0 ? 'M' : 'L'}${xs(i).toFixed(1)},${ys(v).toFixed(1)}`).join(' ')
  const dArea =
    `M${xs(0)},${ys(30)} ` +
    slice.map((v, i) => `L${xs(i).toFixed(1)},${ys(v).toFixed(1)}`).join(' ') +
    ` L${xs(slice.length - 1)},${ys(30)} Z`

  useEffect(() => {
    const el = pathRef.current
    if (!el) return
    const len = el.getTotalLength()
    el.style.strokeDasharray = String(len)
    el.style.strokeDashoffset = String(len)
    requestAnimationFrame(() => {
      if (!pathRef.current) return
      pathRef.current.style.transition = 'stroke-dashoffset 1.2s cubic-bezier(.4,0,.2,1)'
      pathRef.current.style.strokeDashoffset = '0'
    })
  }, [range])

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * W
    const i = Math.max(0, Math.min(slice.length - 1, Math.round(((px - PL) / iw) * (slice.length - 1))))
    setHover({ i, v: slice[i] })
  }

  const last = slice[slice.length - 1] ?? 0

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '100%' }}
      onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <defs>
        <linearGradient id="kp-sparkGrad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%"   stopColor="var(--amber)" stopOpacity="0.28" />
          <stop offset="100%" stopColor="var(--amber)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[40, 60, 80].map(v => (
        <g key={v}>
          <line x1={PL} x2={W - PR} y1={ys(v)} y2={ys(v)} stroke="var(--rule)" strokeDasharray="2 4" />
          <text x={PL - 6} y={ys(v) + 3} textAnchor="end" fill="var(--text-4)" fontFamily="var(--mono)" fontSize={9}>{v}</text>
        </g>
      ))}
      <line x1={PL} x2={W - PR} y1={ys(70)} y2={ys(70)} stroke="var(--green)" strokeOpacity="0.35" strokeDasharray="3 3" />
      <text x={W - PR - 2} y={ys(70) - 3} textAnchor="end" fill="var(--green)" fontFamily="var(--mono)" fontSize={9}>SAFE ≥70</text>
      <path d={dArea} fill="url(#kp-sparkGrad)" />
      <path ref={pathRef} d={d} fill="none" stroke="var(--amber)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={xs(slice.length - 1)} cy={ys(last)} r="3.5" fill="var(--amber)" />
      <circle cx={xs(slice.length - 1)} cy={ys(last)} r="7" fill="var(--amber)" opacity="0.2">
        <animate attributeName="r" values="5;10;5" dur="2s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.35;0;0.35" dur="2s" repeatCount="indefinite" />
      </circle>
      {hover && (
        <g>
          <line x1={xs(hover.i)} x2={xs(hover.i)} y1={PT} y2={H - PB} stroke="var(--rule-strong)" strokeDasharray="2 2" />
          <circle cx={xs(hover.i)} cy={ys(hover.v)} r="3" fill="var(--text)" />
          <rect x={xs(hover.i) + 6} y={ys(hover.v) - 20} width={46} height={16} rx={2} fill="var(--panel)" stroke="var(--rule-strong)" />
          <text x={xs(hover.i) + 29} y={ys(hover.v) - 9} textAnchor="middle" fontFamily="var(--mono)" fontSize={10} fill="var(--text)">{hover.v}</text>
        </g>
      )}
      <text x={PL} y={H - 4} fill="var(--text-4)" fontFamily="var(--mono)" fontSize={9}>{range} ago</text>
      <text x={W - PR} y={H - 4} textAnchor="end" fill="var(--text-4)" fontFamily="var(--mono)" fontSize={9}>now · {last}</text>
    </svg>
  )
}
