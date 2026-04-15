interface Props {
  healthFactor: number
}

function safeDrop(hf: number) {
  return Math.max((1 - 1 / hf) * 100, 0)
}

function getStatus(hf: number) {
  if (hf < 1.1) return {
    label: 'CRITICAL',
    color: '#ef4444',
    bg: 'rgba(239,68,68,0.12)',
    border: 'rgba(239,68,68,0.25)',
  }
  if (hf < 1.5) return {
    label: 'AT RISK',
    color: '#f97316',
    bg: 'rgba(249,115,22,0.12)',
    border: 'rgba(249,115,22,0.25)',
  }
  if (hf < 2.0) return {
    label: 'WATCH',
    color: '#f59e0b',
    bg: 'rgba(245,158,11,0.12)',
    border: 'rgba(245,158,11,0.25)',
  }
  return {
    label: 'SAFE',
    color: '#10b981',
    bg: 'rgba(16,185,129,0.12)',
    border: 'rgba(16,185,129,0.25)',
  }
}

function getPlain(hf: number): string {
  const drop = safeDrop(hf).toFixed(0)
  if (hf < 1.1)
    return 'Liquidation is imminent. Add collateral or repay debt right now to protect your position.'
  if (hf < 1.5)
    return `Your position needs attention. A ${drop}% drop in your collateral value would trigger automatic liquidation.`
  if (hf < 2.0)
    return `Position is okay, but keep an eye on it. Collateral can drop ${drop}% before liquidation becomes possible.`
  return `Your position is healthy. Collateral would need to drop ${drop}% before you risk being liquidated.`
}

export function HealthBar({ healthFactor }: Props) {
  // Bar fill: HF 1.0 = 0%, HF 2.0 = 50%, HF 3.0 = 100%
  const fill = Math.min((healthFactor - 1) / 2, 1) * 100
  const s = getStatus(healthFactor)

  return (
    <div className="space-y-3">
      {/* Label row */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold tracking-widest text-slate-600 uppercase">
          Liquidation Safety
        </span>
        <div className="flex items-center gap-2">
          <span className="text-sm font-mono font-bold" style={{ color: s.color }}>
            {healthFactor.toFixed(2)}
          </span>
          <span
            className="text-[10px] font-bold tracking-wider px-2.5 py-0.5 rounded-full border"
            style={{ color: s.color, background: s.bg, borderColor: s.border }}
          >
            {s.label}
          </span>
        </div>
      </div>

      {/* Gradient track — dark overlay masks the unfilled right portion */}
      <div
        className="relative h-1.5 rounded-full overflow-hidden"
        style={{
          background:
            'linear-gradient(90deg, #ef4444 0%, #f97316 25%, #f59e0b 55%, #10b981 100%)',
        }}
      >
        <div
          className="absolute inset-y-0 right-0 rounded-r-full transition-all duration-1000"
          style={{ width: `${100 - fill}%`, background: '#0d1117' }}
        />
      </div>

      <div className="flex justify-between text-[10px] text-slate-800">
        <span>← Liquidation zone</span>
        <span>Safe →</span>
      </div>

      {/* Plain language explanation */}
      <p className="text-xs text-slate-500 leading-relaxed">{getPlain(healthFactor)}</p>
    </div>
  )
}
