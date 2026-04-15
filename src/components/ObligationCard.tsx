import { HealthBar } from './HealthBar'
import type { KaminoObligation } from '../api/kamino'

interface Props {
  obligation: KaminoObligation
  index: number
}

function fmt(n: number | null): string {
  if (n === null || n === undefined) return '—'
  const abs = Math.abs(n)
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${n.toFixed(2)}`
}

export function ObligationCard({ obligation, index }: Props) {
  const stats = obligation.refreshedStats
  const tag = obligation.humanTag || `Position ${index + 1}`

  let hf: number | null = null
  let deposited: number | null = null
  let borrowed: number | null = null
  let net: number | null = null
  let ltv: number | null = null

  if (stats) {
    const liqLimit = Number(stats.borrowLiquidationLimit ?? 0)
    const totalBorrow = Number(stats.userTotalBorrow ?? 0)
    deposited = Number(stats.userTotalDeposit ?? 0)
    borrowed = totalBorrow
    net = Number(stats.netAccountValue ?? 0)
    hf = totalBorrow > 0 ? liqLimit / totalBorrow : null
    const rawLtv = Number(stats.loanToValue ?? 0)
    ltv = rawLtv > 1 ? rawLtv / 100 : rawLtv
  } else {
    hf = obligation.healthFactor ?? null
    deposited = obligation.depositedValue ?? null
    borrowed = obligation.borrowedValue ?? null
    net = obligation.netAccountValue ?? null
  }

  const hasBorrow = borrowed !== null && borrowed > 1

  return (
    <div
      className="rounded-2xl overflow-hidden transition-all duration-200"
      style={{
        background: '#0d1117',
        border: '1px solid rgba(255,255,255,0.06)',
        boxShadow: '0 4px 40px rgba(0,0,0,0.3)',
      }}
    >
      {/* Header */}
      <div
        className="px-6 pt-6 pb-5"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold tracking-[0.2em] text-slate-700 uppercase mb-1.5">
              Lending Position
            </p>
            <h3 className="text-slate-100 font-bold text-lg leading-tight">{tag}</h3>
          </div>
          <span
            className="flex-shrink-0 mt-1 text-[10px] font-bold tracking-wider px-3 py-1 rounded-full border"
            style={
              hasBorrow
                ? {
                    color: '#f59e0b',
                    background: 'rgba(245,158,11,0.1)',
                    borderColor: 'rgba(245,158,11,0.2)',
                  }
                : {
                    color: '#10b981',
                    background: 'rgba(16,185,129,0.1)',
                    borderColor: 'rgba(16,185,129,0.2)',
                  }
            }
          >
            {hasBorrow ? 'LENDING + BORROWING' : 'LEND ONLY'}
          </span>
        </div>
      </div>

      {/* Stats */}
      <div className="px-6 py-6 space-y-6">

        {/* Key numbers */}
        <div className={`grid gap-4 ${hasBorrow ? 'grid-cols-3' : 'grid-cols-2'}`}>
          <div>
            <p className="text-[11px] text-slate-600 font-medium mb-1.5">You deposited</p>
            <p className="text-2xl font-black text-slate-100 leading-none">{fmt(deposited)}</p>
            <p className="text-[11px] text-slate-700 mt-1.5">as collateral</p>
          </div>
          {hasBorrow && (
            <div>
              <p className="text-[11px] text-slate-600 font-medium mb-1.5">You borrowed</p>
              <p className="text-2xl font-black leading-none" style={{ color: '#f87171' }}>
                {fmt(borrowed)}
              </p>
              <p className="text-[11px] text-slate-700 mt-1.5">outstanding debt</p>
            </div>
          )}
          <div>
            <p className="text-[11px] text-slate-600 font-medium mb-1.5">Net worth</p>
            <p
              className="text-2xl font-black leading-none"
              style={{ color: net !== null && net >= 0 ? '#34d399' : '#f87171' }}
            >
              {fmt(net)}
            </p>
            <p className="text-[11px] text-slate-700 mt-1.5">after debt</p>
          </div>
        </div>

        {/* Health factor (only if borrowing) */}
        {hf !== null && hasBorrow && (
          <div
            className="pt-5"
            style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}
          >
            <HealthBar healthFactor={hf} />
          </div>
        )}

        {/* LTV bar (only if borrowing and LTV data available) */}
        {hasBorrow && ltv !== null && ltv > 0 && (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <span className="text-[11px] font-semibold tracking-widest text-slate-600 uppercase">
                  Loan-to-Value
                </span>
                <span className="text-[11px] text-slate-700 ml-2 hidden sm:inline">
                  — how much of your borrow capacity you're using
                </span>
              </div>
              <span className="text-sm font-mono font-bold text-slate-400 ml-3 flex-shrink-0">
                {(ltv * 100).toFixed(1)}%
              </span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#1a1f2e' }}>
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${Math.min(ltv * 100, 100)}%`,
                  background:
                    ltv < 0.5 ? '#10b981' : ltv < 0.7 ? '#f59e0b' : '#ef4444',
                }}
              />
            </div>
            <p className="text-[11px] text-slate-700">
              {ltv < 0.5
                ? 'Well below the safe limit — you have plenty of borrowing room.'
                : ltv < 0.7
                ? 'Getting closer to the limit. Consider repaying some debt to stay comfortable.'
                : 'Close to the maximum. Repay some debt to reduce risk.'}
            </p>
          </div>
        )}

        {/* Lend-only callout */}
        {!hasBorrow && (
          <div
            className="rounded-xl px-4 py-3.5"
            style={{
              background: 'rgba(16,185,129,0.05)',
              border: '1px solid rgba(16,185,129,0.1)',
            }}
          >
            <p className="text-xs text-slate-500 leading-relaxed">
              <span className="text-emerald-400 font-semibold">Earn-only position. </span>
              Your funds are deposited and earning interest automatically. Since you're not borrowing,
              there is <span className="text-slate-400">no liquidation risk</span> on this position.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
