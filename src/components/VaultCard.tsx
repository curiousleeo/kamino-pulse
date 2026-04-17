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

export function VaultCard({ position, index }: Props) {
  const addr        = position.vaultAddress || ''
  const shortAddr   = addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : `Vault ${index + 1}`
  const tokenSymbol = position.tokenSymbol ?? null
  const tokenType   = position.tokenType ?? 'unknown'
  const tokenPrice  = position.tokenPrice ?? null
  const value       = position.totalValueUsd ?? 0
  const totalShares = Number(position.totalShares ?? 0)
  const sharePrice  = position.sharePrice ?? null
  const holders     = position.numberOfHolders ?? 0

  // Vault TVL — total capital deployed by this vault into the lending protocol
  const vaultTvl     = position.vaultTvlUsd ?? 0
  const totalBorrowUsd = position.reserveTotalBorrowUsd ?? 0
  const utilization    = position.reserveUtilization ?? 0

  // Available = vault TVL minus what's currently borrowed across all reserves
  // (how much could be withdrawn at current utilization)
  const availableUsd = totalBorrowUsd > 0
    ? Math.max(vaultTvl - totalBorrowUsd, 0)
    : (position.tokensAvailableUsd ?? 0)
  const availablePct = vaultTvl > 0 ? ((availableUsd / vaultTvl) * 100).toFixed(1) : null

  const utilizationColor = utilization >= 0.92 ? '#ef4444' : utilization >= 0.82 ? '#f97316' : utilization >= 0.72 ? '#f59e0b' : '#10b981'

  // Yield — current live rate (apy = current, NOT 7d average)
  const apyBase  = position.apy ?? 0
  const apyFarm  = position.apyFarmRewards ?? 0
  const apyTotal = apyBase + apyFarm

  // Estimated earnings from user's position
  const earnPerYear  = value * apyTotal
  const earnPerMonth = earnPerYear / 12
  const earnPerDay   = earnPerYear / 365

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

            {/* Vault TVL + Available side by side */}
            <div className="grid grid-cols-2 gap-3">
              <div
                className="rounded-xl px-4 py-3"
                style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}
              >
                <p className="text-[10px] text-slate-600 mb-1">Vault TVL</p>
                <p className="text-base font-black text-slate-200">
                  {vaultTvl > 0 ? fmtUsd(vaultTvl) : '—'}
                </p>
                {vaultTvl > 0 && (
                  <p className="text-[10px] text-slate-700 mt-0.5">total deployed</p>
                )}
              </div>
              <div
                className="rounded-xl px-4 py-3"
                style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}
              >
                <p className="text-[10px] text-slate-600 mb-1">Available</p>
                <p
                  className="text-base font-black"
                  style={{ color: availableUsd > 100 ? '#34d399' : '#f97316' }}
                >
                  {availableUsd > 0 ? fmtUsd(availableUsd) : '—'}
                </p>
                {availablePct !== null && (
                  <p className="text-[10px] text-slate-700 mt-0.5">{availablePct}% of TVL</p>
                )}
              </div>
            </div>

            {/* Total Borrowed + Utilization side by side */}
            <div className="grid grid-cols-2 gap-3">
              <div
                className="rounded-xl px-4 py-3"
                style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}
              >
                <p className="text-[10px] text-slate-600 mb-1">Total Borrowed</p>
                <p className="text-base font-black text-slate-200">
                  {totalBorrowUsd > 0 ? fmtUsd(totalBorrowUsd) : '—'}
                </p>
                {totalBorrowUsd > 0 && <p className="text-[10px] text-slate-700 mt-0.5">reserve debt</p>}
              </div>
              <div
                className="rounded-xl px-4 py-3"
                style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}
              >
                <p className="text-[10px] text-slate-600 mb-1">Utilization</p>
                <p className="text-base font-black" style={{ color: utilization > 0 ? utilizationColor : '#f1f5f9' }}>
                  {utilization > 0 ? `${(utilization * 100).toFixed(1)}%` : '—'}
                </p>
                {utilization > 0 && <p className="text-[10px] text-slate-700 mt-0.5">of reserve</p>}
              </div>
            </div>

            {/* Total Users */}
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
                  <span className="text-sm font-bold text-slate-300">
                    {fmtUsd(earnPerMonth)}
                  </span>
                  <span className="text-[10px] text-slate-600"> / mo</span>
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

          {/* ── Personal withdrawal risk ── */}
          {value > 0 && availableUsd > 0 && (() => {
            const coverage = availableUsd / value
            const positionPct = vaultTvl > 0 ? (value / vaultTvl) * 100 : 0
            const [signal, signalColor] =
              coverage >= 10  ? ['Exit instantly — deep liquidity'     , '#34d399'] :
              coverage >= 3   ? ['Low risk — ample liquidity'          , '#a3e635'] :
              coverage >= 1   ? ['Monitor — liquidity tightening'      , '#f59e0b'] :
                                ['Caution — liquidity below position'  , '#ef4444']
            return (
              <div
                className="mt-3 pt-3 space-y-2"
                style={{ borderTop: '1px solid rgba(139,92,246,0.1)' }}
              >
                <div className="flex items-center justify-between">
                  <p className="text-[10px] text-slate-600">Withdrawal risk</p>
                  <span className="text-[10px] font-bold" style={{ color: signalColor }}>
                    {signal}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-slate-700">
                    Your {fmtUsd(value)} vs {fmtUsd(availableUsd)} available
                  </span>
                  <span className="text-slate-600">
                    {coverage >= 10
                      ? `${coverage.toFixed(0)}× your position`
                      : `${coverage.toFixed(1)}× your position`}
                    {positionPct > 0 && ` · ${positionPct < 0.01 ? '<0.01' : positionPct.toFixed(2)}% of vault`}
                  </span>
                </div>
              </div>
            )
          })()}
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
