import type { KaminoVaultPosition } from '../api/kamino'

interface Props {
  position: KaminoVaultPosition
  index: number
}

function fmtUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${n.toFixed(2)}`
}

function fmtApy(n: number): string {
  return `${(n * 100).toFixed(2)}%`
}

export function VaultCard({ position, index }: Props) {
  const addr = position.vaultAddress || ''
  const shortAddr = addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : `Vault ${index + 1}`

  const totalShares    = Number(position.totalShares ?? 0)
  const value          = position.totalValueUsd ?? 0
  const sharePrice     = position.sharePrice ?? null
  const tokenPrice     = position.tokenPrice ?? null
  const tokenType      = position.tokenType ?? 'unknown'
  const tokenSymbol    = position.tokenSymbol ?? null
  const tokensAvail    = position.tokensAvailableUsd ?? 0
  const tokensInvested = position.tokensInvested ?? 0
  const apy7d          = position.apy7d ?? 0
  const apy30d         = position.apy30d ?? 0
  const apyBase        = position.apy ?? 0
  const apyFarm        = position.apyFarmRewards ?? 0
  const holders        = position.numberOfHolders ?? 0

  // Withdrawal liquidity — tokensAvailableUsd vs total vault size
  // This is the vault's idle buffer, not the full lending pool availability
  const totalVaultUsd = tokensInvested * (tokenPrice || 1) + tokensAvail
  const bufferPct = totalVaultUsd > 0 ? tokensAvail / totalVaultUsd : 0

  // Determine withdrawal signal — low buffer doesn't mean fully locked
  // (lending market may still have liquidity), but it's worth showing
  const withdrawalStatus: 'tight' | 'ok' =
    tokensAvail < 1000 ? 'tight' : 'ok'

  // Stablecoin peg check from vault metrics
  const pegDeviation = tokenType === 'stablecoin' && tokenPrice
    ? Math.abs(tokenPrice - 1.0)
    : null
  const pegStatus =
    pegDeviation === null ? null
    : pegDeviation >= 0.01 ? 'red'
    : pegDeviation >= 0.005 ? 'orange'
    : pegDeviation >= 0.002 ? 'yellow'
    : 'green'

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        background: '#0d1117',
        border: '1px solid rgba(255,255,255,0.06)',
        boxShadow: '0 4px 40px rgba(0,0,0,0.3)',
      }}
    >
      {/* Header */}
      <div className="px-6 pt-6 pb-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span
                className="text-[9px] font-bold tracking-[0.18em] px-2 py-0.5 rounded-md"
                style={{
                  color: '#64748b',
                  background: 'rgba(100,116,139,0.08)',
                  border: '1px solid rgba(100,116,139,0.12)',
                }}
              >
                K-VAULT
              </span>
              {tokenSymbol && (
                <span
                  className="text-[9px] font-bold tracking-[0.15em] px-2 py-0.5 rounded-md"
                  style={{
                    color: tokenType === 'stablecoin' ? '#34d399' : '#f59e0b',
                    background: tokenType === 'stablecoin' ? 'rgba(52,211,153,0.08)' : 'rgba(245,158,11,0.08)',
                    border: tokenType === 'stablecoin' ? '1px solid rgba(52,211,153,0.12)' : '1px solid rgba(245,158,11,0.12)',
                  }}
                >
                  {tokenSymbol}
                </span>
              )}
              {!tokenSymbol && tokenType === 'stablecoin' && (
                <span
                  className="text-[9px] font-bold tracking-[0.15em] px-2 py-0.5 rounded-md"
                  style={{ color: '#34d399', background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.12)' }}
                >
                  STABLECOIN
                </span>
              )}
            </div>
            <h3 className="text-slate-100 font-bold text-lg font-mono leading-tight">
              {shortAddr}
            </h3>
            {holders > 0 && (
              <p className="text-[11px] text-slate-700 mt-1">{holders.toLocaleString()} depositors</p>
            )}
          </div>
          <span
            className="flex-shrink-0 mt-1 text-[10px] font-bold tracking-wider px-3 py-1 rounded-full border"
            style={{
              color: '#a78bfa',
              background: 'rgba(139,92,246,0.1)',
              borderColor: 'rgba(139,92,246,0.2)',
            }}
          >
            EARNING
          </span>
        </div>
      </div>

      {/* Stats */}
      <div className="px-6 py-6 space-y-5">

        {/* Value + shares */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-[11px] text-slate-600 font-medium mb-1.5">Your position</p>
            <p className="text-2xl font-black text-slate-100 leading-none">
              {value > 0 ? fmtUsd(value) : '—'}
            </p>
            {sharePrice !== null && sharePrice > 0 && (
              <p className="text-[11px] text-slate-700 mt-1.5">
                @ ${sharePrice.toFixed(4)} / share
              </p>
            )}
          </div>
          <div>
            <p className="text-[11px] text-slate-600 font-medium mb-1.5">Shares held</p>
            <p className="text-2xl font-black text-slate-300 leading-none">
              {totalShares > 0
                ? totalShares.toLocaleString(undefined, { maximumFractionDigits: 2 })
                : '—'}
            </p>
            <p className="text-[11px] text-slate-700 mt-1.5">vault tokens</p>
          </div>
        </div>

        {/* APY breakdown */}
        {apy7d > 0 && (
          <div
            className="rounded-xl px-4 py-4 space-y-3"
            style={{
              background: 'rgba(139,92,246,0.05)',
              border: '1px solid rgba(139,92,246,0.1)',
            }}
          >
            <p className="text-xs font-semibold text-violet-400">Yield Breakdown</p>
            <div className="grid grid-cols-3 gap-3 text-xs">
              <div>
                <p className="text-slate-600 mb-0.5">7-day APY</p>
                <p className="text-slate-200 font-bold text-base">{fmtApy(apy7d)}</p>
              </div>
              <div>
                <p className="text-slate-600 mb-0.5">30-day APY</p>
                <p className="text-slate-300 font-bold">{fmtApy(apy30d)}</p>
              </div>
              <div>
                <p className="text-slate-600 mb-0.5">Base rate</p>
                <p className="text-slate-400 font-bold">{fmtApy(apyBase)}</p>
              </div>
            </div>
            {apyFarm > 0 && (
              <p className="text-[11px] text-slate-600">
                Includes <span className="text-violet-400 font-medium">{fmtApy(apyFarm)} farm rewards</span>
                {' '}on top of base lending yield
              </p>
            )}
          </div>
        )}

        {/* Withdrawal liquidity */}
        <div
          className="rounded-xl px-4 py-3.5 space-y-2"
          style={
            withdrawalStatus === 'tight'
              ? { background: 'rgba(245,158,11,0.05)', border: '1px solid rgba(245,158,11,0.15)' }
              : { background: 'rgba(16,185,129,0.04)', border: '1px solid rgba(16,185,129,0.08)' }
          }
        >
          <div className="flex items-center justify-between">
            <p
              className="text-xs font-semibold"
              style={{ color: withdrawalStatus === 'tight' ? '#f59e0b' : '#10b981' }}
            >
              Withdrawal Liquidity
            </p>
            <span
              className="text-[10px] font-bold"
              style={{ color: withdrawalStatus === 'tight' ? '#f59e0b' : '#34d399' }}
            >
              {withdrawalStatus === 'tight' ? 'CONSTRAINED' : 'AVAILABLE'}
            </span>
          </div>

          {/* Buffer bar */}
          {bufferPct > 0 && (
            <div className="space-y-1">
              <div className="h-1 rounded-full overflow-hidden" style={{ background: '#1a1f2e' }}>
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.min(bufferPct * 100, 100)}%`,
                    background: withdrawalStatus === 'tight' ? '#f59e0b' : '#10b981',
                  }}
                />
              </div>
              <p className="text-[10px] text-slate-700">
                {fmtUsd(tokensAvail)} idle in vault buffer
                {totalVaultUsd > 0 && ` (${(bufferPct * 100).toFixed(2)}% of vault)`}
              </p>
            </div>
          )}

          <p className="text-xs text-slate-500 leading-relaxed">
            {withdrawalStatus === 'tight'
              ? 'The vault\'s immediate buffer is nearly empty. Your withdrawal may take time as the vault pulls funds from the underlying lending pool. Check pool utilization below to gauge how long this might take.'
              : 'Vault has idle buffer available. Withdrawals should process quickly.'}
          </p>

          <p className="text-xs text-slate-700">
            <span className="text-slate-500">No liquidation risk</span>
            {' '}— earn-only position. Your principal is safe; the only risk is temporary illiquidity.
          </p>
        </div>

        {/* Stablecoin peg (only if underlying token is stablecoin and we have price) */}
        {pegStatus !== null && tokenPrice !== null && (
          <div
            className="rounded-xl px-4 py-3"
            style={
              pegStatus === 'green'
                ? { background: 'rgba(16,185,129,0.04)', border: '1px solid rgba(16,185,129,0.08)' }
                : { background: 'rgba(245,158,11,0.05)', border: '1px solid rgba(245,158,11,0.15)' }
            }
          >
            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-600">Underlying token price</p>
              <span
                className="text-sm font-mono font-bold"
                style={{
                  color: pegStatus === 'green' ? '#34d399'
                    : pegStatus === 'yellow' ? '#f59e0b'
                    : '#f97316',
                }}
              >
                ${tokenPrice.toFixed(4)}
              </span>
            </div>
            <p className="text-[11px] text-slate-700 mt-1">
              {pegStatus === 'green'
                ? 'Holding peg — your deposit value is stable'
                : `${(pegDeviation! * 100).toFixed(3)}% deviation from $1.00 — monitor closely`}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
