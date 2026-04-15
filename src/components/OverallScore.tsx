import type { RiskTier } from '../types'

const TIER = {
  green:   { label: 'LOW RISK',  color: '#10b981', glow: 'rgba(16,185,129,0.12)',  desc: 'All systems normal. Protocol is operating within safe parameters.',    idx: 0 },
  yellow:  { label: 'ELEVATED',  color: '#f59e0b', glow: 'rgba(245,158,11,0.12)',  desc: 'Minor risk signals detected. Monitor your positions closely.',          idx: 1 },
  orange:  { label: 'HIGH RISK', color: '#f97316', glow: 'rgba(249,115,22,0.12)',  desc: 'Multiple risk factors active. Consider reducing your exposure.',         idx: 2 },
  red:     { label: 'CRITICAL',  color: '#ef4444', glow: 'rgba(239,68,68,0.15)',   desc: 'Severe risk detected. Take immediate action to protect positions.',      idx: 3 },
  loading: { label: 'LOADING',   color: '#475569', glow: 'rgba(71,85,105,0.08)',   desc: 'Fetching data from Kamino, DeFiLlama, Pyth, Jupiter, and Helius…',      idx: -1 },
  error:   { label: 'ERROR',     color: '#334155', glow: 'rgba(51,65,85,0.08)',    desc: 'Could not fetch risk data. Check your connection.',                      idx: -1 },
}

const STEPS = [
  { key: 'green'  as const, label: 'SAFE',     color: '#10b981', idx: 0 },
  { key: 'yellow' as const, label: 'WATCH',    color: '#f59e0b', idx: 1 },
  { key: 'orange' as const, label: 'HIGH',     color: '#f97316', idx: 2 },
  { key: 'red'    as const, label: 'CRITICAL', color: '#ef4444', idx: 3 },
]

interface Props {
  tier: RiskTier
  lastUpdated: Date | null
  onRefresh: () => void
  loading: boolean
  countdown: number
}

export function OverallScore({ tier, lastUpdated, onRefresh, loading, countdown }: Props) {
  const t = TIER[tier]
  const isActive = tier !== 'loading' && tier !== 'error'

  return (
    <div
      className="rounded-2xl border border-slate-800 overflow-hidden"
      style={{ background: `linear-gradient(135deg, #0d0f14 0%, ${t.glow} 100%)` }}
    >
      <div className="px-6 py-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">

          {/* Status */}
          <div className="flex items-start gap-4 min-w-0">
            <div className="mt-1.5 flex-shrink-0 relative w-4 h-4">
              <div
                className="w-4 h-4 rounded-full"
                style={{ backgroundColor: t.color, boxShadow: `0 0 14px ${t.color}88` }}
              />
              {tier === 'red' && (
                <div
                  className="absolute inset-0 w-4 h-4 rounded-full animate-ping opacity-50"
                  style={{ backgroundColor: t.color }}
                />
              )}
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold tracking-[0.2em] text-slate-500 uppercase mb-1">
                Overall Risk Score
              </p>
              <h1
                className="text-4xl font-black tracking-tight leading-none"
                style={{ color: t.color, textShadow: `0 0 30px ${t.color}44` }}
              >
                {t.label}
              </h1>
              <p className="text-slate-400 text-sm mt-2 leading-relaxed max-w-md">
                {t.desc}
              </p>
            </div>
          </div>

          {/* Refresh */}
          <div className="flex-shrink-0 text-right">
            <button
              onClick={onRefresh}
              disabled={loading}
              className="px-4 py-2 rounded-lg text-xs font-semibold transition-all border bg-slate-900 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                borderColor: loading ? '#334155' : `${t.color}55`,
                color: loading ? '#64748b' : t.color,
              }}
            >
              {loading ? (
                <span className="flex items-center gap-1.5">
                  <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                  </svg>
                  Refreshing
                </span>
              ) : '↻ Refresh'}
            </button>
            <p className="text-[11px] text-slate-600 mt-2">
              {lastUpdated ? lastUpdated.toLocaleTimeString() : 'Fetching…'}
            </p>
            {!loading && (
              <p className="text-[11px] text-slate-700 mt-0.5">next in {countdown}s</p>
            )}
          </div>
        </div>

        {/* Risk spectrum */}
        {isActive && (
          <div className="mt-5 select-none">
            <div className="flex rounded-full overflow-hidden h-2 gap-0.5">
              {STEPS.map((step) => (
                <div
                  key={step.key}
                  className="flex-1 h-full rounded-full transition-all duration-700"
                  style={{
                    backgroundColor: step.color,
                    opacity: step.idx <= t.idx ? 1 : 0.12,
                    boxShadow: step.idx === t.idx ? `0 0 8px ${step.color}` : 'none',
                  }}
                />
              ))}
            </div>
            <div className="flex justify-between mt-2">
              {STEPS.map((step) => (
                <span
                  key={step.key}
                  className="text-[10px] font-bold tracking-wider transition-all duration-300"
                  style={{ color: step.idx === t.idx ? step.color : '#1e293b' }}
                >
                  {step.label}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
