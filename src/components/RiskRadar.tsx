import { useRef, useEffect } from 'react'

export type RiskStatus = 'good' | 'watch' | 'risk'

export interface RadarItem {
  key: string
  name: string
  status: RiskStatus
  score: number
}

interface Props {
  risks: RadarItem[]
  activeKey: string
  onPick: (key: string) => void
}

export function RiskRadar({ risks, activeKey, onPick }: Props) {
  const size = 280
  const cx = size / 2
  const cy = size / 2 + 4
  const R = 92
  const n = risks.length
  const angle = (i: number) => -Math.PI / 2 + (i / n) * Math.PI * 2
  const pt = (i: number, r: number): [number, number] => [
    cx + Math.cos(angle(i)) * r,
    cy + Math.sin(angle(i)) * r,
  ]
  const scoreR = (s: number) => (s / 100) * R

  const polyPts = risks
    .map((r, i) => pt(i, scoreR(r.score)).map(v => v.toFixed(1)).join(','))
    .join(' ')

  const rank: Record<RiskStatus, number> = { good: 0, watch: 1, risk: 2 }
  const worst = risks.reduce<RiskStatus>(
    (acc, r) => (rank[r.status] > rank[acc] ? r.status : acc),
    'good'
  )
  const fillColor =
    worst === 'risk' ? 'var(--red)' : worst === 'watch' ? 'var(--amber)' : 'var(--green)'

  const polyRef = useRef<SVGPolygonElement>(null)
  useEffect(() => {
    const el = polyRef.current
    if (!el) return
    el.style.transform = 'scale(0.001)'
    el.style.transformOrigin = `${cx}px ${cy}px`
    requestAnimationFrame(() => {
      if (!polyRef.current) return
      polyRef.current.style.transition = 'transform 900ms cubic-bezier(.34,1.56,.64,1)'
      polyRef.current.style.transform = 'scale(1)'
    })
  }, [cx, cy])

  const avgScore = Math.round(risks.reduce((a, r) => a + r.score, 0) / risks.length)

  return (
    <svg viewBox={`-24 0 ${size + 48} ${size + 18}`} style={{ width: '100%', maxWidth: 340, height: 'auto' }}>
      {[0.25, 0.5, 0.75, 1].map(q => (
        <polygon
          key={q}
          points={Array.from({ length: n }, (_, i) =>
            pt(i, R * q).map(v => v.toFixed(1)).join(',')
          ).join(' ')}
          fill="none"
          stroke="var(--rule)"
          strokeDasharray={q === 1 ? '0' : '2 3'}
        />
      ))}
      {Array.from({ length: n }, (_, i) => (
        <line key={i} x1={cx} y1={cy} x2={pt(i, R)[0]} y2={pt(i, R)[1]} stroke="var(--rule)" />
      ))}
      <polygon
        ref={polyRef}
        points={polyPts}
        fill={fillColor}
        fillOpacity="0.18"
        stroke={fillColor}
        strokeWidth="1.6"
      />
      {risks.map((r, i) => {
        const [x, y] = pt(i, scoreR(r.score))
        const color =
          r.status === 'good' ? 'var(--green)' : r.status === 'watch' ? 'var(--amber)' : 'var(--red)'
        const active = r.key === activeKey
        return (
          <g key={r.key} style={{ cursor: 'pointer' }} onClick={() => onPick(r.key)}>
            <circle cx={x} cy={y} r={active ? 5 : 3.5} fill={color} stroke="var(--panel)" strokeWidth="2" />
            {active && (
              <circle cx={x} cy={y} r="8" fill={color} opacity="0.25">
                <animate attributeName="r" values="5;11;5" dur="1.8s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.4;0;0.4" dur="1.8s" repeatCount="indefinite" />
              </circle>
            )}
          </g>
        )
      })}
      {risks.map((r, i) => {
        const [x, y] = pt(i, R + 16)
        const cosA = Math.cos(angle(i))
        const anchor = Math.abs(cosA) < 0.1 ? 'middle' : cosA > 0 ? 'start' : 'end'
        return (
          <text
            key={r.key}
            x={x} y={y + 3}
            textAnchor={anchor}
            fontFamily="var(--mono)"
            fontSize="9.5"
            letterSpacing="0.1em"
            fill={r.key === activeKey ? 'var(--text)' : 'var(--text-3)'}
            style={{ cursor: 'pointer', textTransform: 'uppercase' }}
            onClick={() => onPick(r.key)}
          >
            {r.name.split(' ')[0]}
          </text>
        )
      })}
      <text x={cx} y={cy - 4} textAnchor="middle" fontFamily="var(--mono)" fontSize="22" fontWeight="700" fill="var(--text)" letterSpacing="-0.02em">
        {avgScore}
      </text>
      <text x={cx} y={cy + 10} textAnchor="middle" fontFamily="var(--mono)" fontSize="8.5" fill="var(--text-3)" letterSpacing="0.14em">
        AVG
      </text>
    </svg>
  )
}
