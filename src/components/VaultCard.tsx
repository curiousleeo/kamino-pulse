import type { KaminoVaultPosition, ReserveRegistry } from '../api/kamino'

interface Props {
  position: KaminoVaultPosition
  index: number
  registry?: ReserveRegistry
}

function fmtUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${n.toFixed(2)}`
}

function utilizationColor(u: number): string {
  if (u >= 0.92) return '#ef4444'
  if (u >= 0.82) return '#f97316'
  if (u >= 0.72) return '#f59e0b'
  return '#10b981'
}

export function VaultCard({ position, index, registry }: Props) {
  const addr        = position.vaultAddress || ''
  const shortAddr   = addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : `Vault ${index + 1}`
  const tokenSymbol = position.tokenSymbol ?? null
  const tokenType   = position.tokenType ?? 'unknown'
  const tokenPrice  = position.tokenPrice ?? null
  const value       = position.totalValueUsd ?? 0
  const totalShares = Number(position.totalShares ?? 0)
  const sharePrice  = position.sharePrice ?? null
  const holders     = position.numberOfHolders ?? 0

  // Yield — current live rate (apy = current, NOT 7d average)
  const apyBase  = position.apy ?? 0
  const apyFarm  = position.apyFarmRewards ?? 0
  const apyTotal = apyBase + apyFarm

  // Estimated earnings from user's position
  const earnPerYear = value * apyTotal
  const earnPerDay  = earnPerYear / 365

  // Reserve-level stats — sourced from vault metrics API or registry fallback
  // Priority: position fields (set in fetchUserVaultPositions) → registry
  const reserveInfo     = registry && position.reservePubkey ? registry[position.reservePubkey] : undefined
  const totalSupplyUsd  = position.reserveTotalSupplyUsd || reserveInfo?.totalSupplyUsd || 0
  const totalBorrowUsd  = position.reserveTotalBorrowUsd || reserveInfo?.totalBorrowUsd || 0
  const reserveUtil     = position.reserveUtilization    || reserveInfo?.utilization    || 0
  const availableUsd    = totalSupplyUsd > 0 ? totalSupplyUsd * (1 - reserveUtil) : 0
  const utilColor       = utilizationColor(reserveUtil)

  // Stablecoin peg deviation
  const pegDeviation = tokenType === 'stablecoin' && tokenPrice
    ? Math.abs(tokenPrice - 1.0)
    : null
  const pegOk = pegDeviation === null || pegDeviation < 0.005

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        background: '#0d1117',
        border: '1px solid rgba(255,255,255,0.06)',
        boxShadow: '0 4px 40px rgba(0,0,0,0.3)',
      }}
    >
      {/* ── Header ── */}
      <div className="px-6 pt-5 pb-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span
              className="text-[9px] font-bold tracking-[0.18em] px-2 py-0.5 rounded-md"
              style={{ color: '#64748b', background: 'rgba(100,116,139,0.08)', border: '1px solid rgba(100,116,139,0.12)' }}
            >
              K-VAULT
            </span>
            {tokenSymbol ? (
              <span
                className="text-[9px] font-bold tracking-[0.15em] px-2 py-0.5 rounded-md"
                style={{
                  color:       tokenType === 'stablecoin' ? '#34d399' : '#f59e0b',
                  background:  tokenType === 'stablecoin' ? 'rgba(52,211,153,0.08)' : 'rgba(245,158,11,0.08)',
                  border:      tokenType === 'stablecoin' ? '1px solid rgba(52,211,153,0.12)' : '1px solid rgba(245,158,11,0.12)',
                }}
              >
                {tokenSymbol}
              </span>
            ) : tokenType === 'stablecoin' && (
              <span
                className="text-[9px] font-bold tracking-[0.15em] px-2 py-0.5 rounded-md"
                style={{ color: '#34d399', background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.12)' }}
              >
                STABLECOIN
              </span>
            )}
            {/* Peg alert in header if deviating */}
            {!pegOk && tokenPrice !== null && (
              <span
                className="text-[9px] font-bold tracking-[0.12em] px-2 py-0.5 rounded-md"
                style={{ color: '#f97316', background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.15)' }}
              >
                PEG {(pegDeviation! * 100).toFixed(2)}% OFF
              </span>
            )}
          </div>
          <span
            className="text-[10px] font-bold tracking-wider px-3 py-1 rounded-full border"
            style={{ color: '#a78bfa', background: 'rgba(139,92,246,0.1)', borderColor: 'rgba(139,92,246,0.2)' }}
          >
            EARNING
          </span>
        </div>
        <p className="text-slate-400 font-mono text-sm font-semibold mt-2">{shortAddr}</p>
      </div>

      <div className="px-6 py-5 space-y-5">

        {/* ── Vault Stats ── */}
        <div>
          <p className="text-[10px] font-bold tracking-[0.18em] text-slate-700 uppercase mb-3">Vault Stats</p>
          <div className="space-y-3">

            {/* Total Supply / Total Borrowed side by side */}
            <div className="grid grid-cols-2 gap-3">
              <div
                className="rounded-xl px-4 py-3"
                style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}
              >
                <p className="text-[10px] text-slate-600 mb-1">Total Supply</p>
                <p className="text-base font-black text-slate-200">
                  {totalSupplyUsd > 0 ? fmtUsd(totalSupplyUsd) : '—'}
                </p>
              </div>
              <div
                className="rounded-xl px-4 py-3"
                style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}
              >
                <p className="text-[10px] text-slate-600 mb-1">Total Borrowed</p>
                <p className="text-base font-black text-slate-200">
                  {totalBorrowUsd > 0 ? fmtUsd(totalBorrowUsd) : '—'}
                </p>
              </div>
            </div>

            {/* Utilization bar */}
            {reserveUtil > 0 ? (
              <div
                className="rounded-xl px-4 py-3 space-y-2"
                style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}
              >
                <div className="flex items-center justify-between">
                  <p className="text-[10px] text-slate-600">Utilization</p>
                  <span className="text-sm font-black font-mono" style={{ color: utilColor }}>
                    {(reserveUtil * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#1a1f2e' }}>
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${Math.min(reserveUtil * 100, 100)}%`, background: utilColor }}
                  />
                </div>
              </div>
            ) : (
              <div
                className="rounded-xl px-4 py-3"
                style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}
              >
                <p className="text-[10px] text-slate-600 mb-1">Utilization</p>
                <p className="text-sm text-slate-600">Loading…</p>
              </div>
            )}

            {/* Available to withdraw + Total Users side by side */}
            <div className="grid grid-cols-2 gap-3">
              <div
                className="rounded-xl px-4 py-3"
                style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}
              >
                <p className="text-[10px] text-slate-600 mb-1">Available to Withdraw</p>
                <p
                  className="text-base font-black"
                  style={{ color: reserveUtil >= 0.92 ? '#ef4444' : reserveUtil >= 0.82 ? '#f97316' : '#34d399' }}
                >
                  {availableUsd > 0 ? fmtUsd(availableUsd) : '—'}
                </p>
                {reserveUtil > 0 && (
                  <p className="text-[10px] text-slate-700 mt-0.5">{(100 - reserveUtil * 100).toFixed(1)}% free</p>
                )}
              </div>
              <div
                className="rounded-xl px-4 py-3"
                style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}
              >
                <p className="text-[10px] text-slate-600 mb-1">Total Users</p>
                <p className="text-base font-black text-slate-200">
                  {holders > 0 ? holders.toLocaleString() : '—'}
                </p>
                {holders > 0 && <p className="text-[10px] text-slate-700 mt-0.5">depositors</p>}
              </div>
            </div>
          </div>
        </div>

        {/* ── Your Position + Current Yield ── */}
        <div
          className="rounded-xl px-4 py-4"
          style={{ background: 'rgba(139,92,246,0.05)', border: '1px solid rgba(139,92,246,0.1)' }}
        >
          <p className="text-[10px] font-bold tracking-[0.18em] text-violet-500 uppercase mb-3">Your Position</p>
          <div className="grid grid-cols-2 gap-4">
            {/* Position value */}
            <div>
              <p className="text-[10px] text-slate-600 mb-1">Position Value</p>
              <p className="text-2xl font-black text-slate-100 leading-none">
                {value > 0 ? fmtUsd(value) : '—'}
              </p>
              {sharePrice !== null && sharePrice > 0 && (
                <p className="text-[10px] text-slate-700 mt-1.5">
                  {totalShares > 0 && `${totalShares.toLocaleString(undefined, { maximumFractionDigits: 0 })} shares · `}
                  ${sharePrice.toFixed(4)}/share
                </p>
              )}
            </div>

            {/* Current yield */}
            <div>
              <p className="text-[10px] text-slate-600 mb-1">Current Yield</p>
              <p className="text-2xl font-black leading-none" style={{ color: '#a78bfa' }}>
                {apyTotal > 0 ? `${(apyTotal * 100).toFixed(2)}%` : '—'}
              </p>
              {apyTotal > 0 && (
                <p className="text-[10px] text-slate-700 mt-1.5">APY · live rate</p>
              )}
            </div>
          </div>

          {/* Estimated earnings */}
          {earnPerYear > 0 && (
            <div
              className="mt-3 pt-3 flex items-center justify-between"
              style={{ borderTop: '1px solid rgba(139,92,246,0.1)' }}
            >
              <p className="text-[10px] text-slate-600">You're earning ~</p>
              <div className="flex items-center gap-3 text-right">
                <div>
                  <span className="text-sm font-black" style={{ color: '#34d399' }}>
                    {fmtUsd(earnPerYear)}
                  </span>
                  <span className="text-[10px] text-slate-600"> / year</span>
                </div>
                <div>
                  <span className="text-sm font-bold text-slate-400">
                    {fmtUsd(earnPerDay)}
                  </span>
                  <span className="text-[10px] text-slate-600"> / day</span>
                </div>
              </div>
            </div>
          )}

          {/* Farm rewards note */}
          {apyFarm > 0 && (
            <p className="text-[10px] text-slate-600 mt-2">
              Includes <span className="text-violet-400 font-semibold">{(apyFarm * 100).toFixed(2)}% incentive rewards</span>
              {' '}+ {(apyBase * 100).toFixed(2)}% base lending yield
            </p>
          )}
        </div>

        {/* ── Token peg (stablecoin only, and only if notable deviation) ── */}
        {tokenType === 'stablecoin' && tokenPrice !== null && (
          <div
            className="rounded-xl px-4 py-3 flex items-center justify-between"
            style={
              pegOk
                ? { background: 'rgba(16,185,129,0.03)', border: '1px solid rgba(16,185,129,0.07)' }
                : { background: 'rgba(249,115,22,0.05)', border: '1px solid rgba(249,115,22,0.15)' }
            }
          >
            <p className="text-[10px] text-slate-600">
              {tokenSymbol ?? 'Token'} price
            </p>
            <div className="text-right">
              <span
                className="text-sm font-mono font-bold"
                style={{ color: pegOk ? '#34d399' : '#f97316' }}
              >
                ${tokenPrice.toFixed(4)}
              </span>
              <p className="text-[10px] mt-0.5" style={{ color: pegOk ? '#475569' : '#f97316' }}>
                {pegOk ? 'Holding peg' : `${(pegDeviation! * 100).toFixed(3)}% off peg — monitor`}
              </p>
            </div>
          </div>
        )}

        <p className="text-[10px] text-slate-800 text-center">
          Earn-only · no liquidation risk · principal only at risk if utilization exceeds ~95%
        </p>
      </div>
    </div>
  )
}
