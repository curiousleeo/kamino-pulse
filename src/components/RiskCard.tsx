import type { RiskLayer, RiskTier } from '../types'

type SignalStatus = 'green' | 'yellow' | 'orange' | 'red'

const TIER_CONFIG: Record<
  RiskTier,
  { dot: string; badge: string; badgeText: string; border: string }
> = {
  green:   { dot: 'bg-emerald-400', badge: 'bg-emerald-400/10 border-emerald-400/20', badgeText: 'text-emerald-400', border: 'border-slate-800' },
  yellow:  { dot: 'bg-yellow-400',  badge: 'bg-yellow-400/10 border-yellow-400/20',   badgeText: 'text-yellow-400',  border: 'border-slate-800' },
  orange:  { dot: 'bg-orange-400',  badge: 'bg-orange-400/10 border-orange-400/20',   badgeText: 'text-orange-400',  border: 'border-orange-900/40' },
  red:     { dot: 'bg-red-400',     badge: 'bg-red-400/10 border-red-400/20',         badgeText: 'text-red-400',     border: 'border-red-900/50' },
  loading: { dot: 'bg-slate-600 animate-pulse', badge: 'bg-slate-700/50 border-slate-700', badgeText: 'text-slate-500', border: 'border-slate-800' },
  error:   { dot: 'bg-slate-700',  badge: 'bg-slate-800 border-slate-700',            badgeText: 'text-slate-600',   border: 'border-slate-800' },
}

const TIER_LABELS: Record<RiskTier, string> = {
  green: 'Safe', yellow: 'Watch', orange: 'Warning', red: 'Critical', loading: 'Loading', error: 'Error',
}

const SIGNAL_COLOR: Record<SignalStatus, string> = {
  green:  'text-emerald-400',
  yellow: 'text-yellow-400',
  orange: 'text-orange-400',
  red:    'text-red-400',
}

const SIGNAL_DOT: Record<SignalStatus, string> = {
  green:  'bg-emerald-400',
  yellow: 'bg-yellow-400',
  orange: 'bg-orange-400',
  red:    'bg-red-400',
}

interface Props {
  layer: RiskLayer
}

export function RiskCard({ layer }: Props) {
  const t = TIER_CONFIG[layer.tier]

  return (
    <div className={`bg-slate-900 border ${t.border} rounded-xl p-5`}>
      {/* Card header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-start gap-2.5">
          <span className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${t.dot}`} />
          <div>
            <h3 className="text-slate-200 font-medium text-sm">{layer.name}</h3>
            <p className="text-slate-600 text-xs mt-0.5">{layer.description}</p>
          </div>
        </div>
        <span
          className={`ml-4 flex-shrink-0 text-xs font-medium px-2.5 py-1 rounded-md border ${t.badge} ${t.badgeText}`}
        >
          {TIER_LABELS[layer.tier]}
        </span>
      </div>

      {/* Signals */}
      <div className="space-y-3">
        {layer.signals.map((signal, i) => (
          <div key={i} className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-slate-400 text-xs font-medium">{signal.label}</p>
              {signal.detail && (
                <p className="text-slate-600 text-xs mt-0.5 leading-snug">{signal.detail}</p>
              )}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0 pt-0.5">
              <span className={`text-xs font-mono font-medium ${SIGNAL_COLOR[signal.status]}`}>
                {signal.value}
              </span>
              <span className={`w-1.5 h-1.5 rounded-full ${SIGNAL_DOT[signal.status]}`} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
