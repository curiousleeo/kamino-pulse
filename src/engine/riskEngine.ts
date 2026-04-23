import type { RiskLayer, RiskSignal, RiskTier } from '../types'

// ─── Helpers ────────────────────────────────────────────────────────────────

type SignalStatus = RiskSignal['status']

/** Returns the first tier whose threshold is met (thresholds ordered high→low) */
function thresh(value: number, levels: [number, SignalStatus][]): SignalStatus {
  for (const [t, s] of levels) if (value >= t) return s
  return 'green'
}

function worst(tiers: (RiskTier | SignalStatus)[]): RiskTier {
  const order: RiskTier[] = ['red', 'orange', 'yellow', 'green']
  for (const t of order) if (tiers.includes(t)) return t
  return 'green'
}

function pct(n: number, dp = 2): string {
  return `${(n * 100).toFixed(dp)}%`
}

function usd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${n.toFixed(2)}`
}

// ─── Layer 1 — Protocol Health ───────────────────────────────────────────────

export function scoreProtocolHealth(p: {
  kaminoTVL: number              // summed from reserve registry (Kamino's own data)
  maxReserveUtilization: number
  userVaultUtilization?: number  // blended utilization across user's vault allocations
}): RiskLayer {
  const signals: RiskSignal[] = []

  // Kamino TVL from reserve registry
  signals.push({
    label: 'Kamino TVL',
    value: usd(p.kaminoTVL),
    status: 'green',
    detail: 'Total value locked across all scanned Kamino lending markets',
  })

  if (p.userVaultUtilization !== undefined) {
    // User has vault positions — show their blended utilization as the primary signal.
    // Kamino-wide peak is still shown for context but does not drive the layer tier.
    const u = p.userVaultUtilization
    signals.push({
      label: 'Your Vault Utilization',
      value: pct(u),
      status: thresh(u, [[0.95, 'red'], [0.9, 'orange'], [0.8, 'yellow']]),
      detail:
        u >= 0.95
          ? "Near cap — your vault's liquidity is severely constrained, monitor withdrawal availability"
          : u >= 0.8
          ? "High utilization — watch your vault's available liquidity"
          : "Your vault's liquidity is healthy",
    })
    // Protocol-wide peak: context only — high Kamino utilization in an unrelated reserve
    // shouldn't alarm a user whose own vault is fine.
    const kPeak = p.maxReserveUtilization
    signals.push({
      label: 'Kamino Peak (context)',
      value: pct(kPeak),
      status: thresh(kPeak, [[0.95, 'red'], [0.9, 'orange'], [0.8, 'yellow']]),
      detail: 'Highest utilization across all $1M+ Kamino reserves — protocol-wide context, may not affect your vault',
    })
    // Tier is driven by TVL + user vault signals only; Kamino peak is context
    const tierSignals = signals.filter(s => s.label !== 'Kamino Peak (context)')
    return {
      id: 'protocol',
      name: 'Protocol Health',
      description: "Kamino TVL and your vault's utilization across allocated markets",
      tier: worst(tierSignals.map(s => s.status)),
      signals,
    }
  }

  // No user vault context — show Kamino-wide peak as primary
  signals.push({
    label: 'Peak Reserve Utilization',
    value: pct(p.maxReserveUtilization),
    status: thresh(p.maxReserveUtilization, [[0.95, 'red'], [0.9, 'orange'], [0.8, 'yellow']]),
    detail:
      p.maxReserveUtilization >= 0.95
        ? 'Near cap — some reserve withdrawals severely constrained'
        : p.maxReserveUtilization >= 0.8
        ? 'High utilization in at least one reserve — check Pool Liquidity'
        : 'Liquidity available across reserves',
  })

  return {
    id: 'protocol',
    name: 'Protocol Health',
    description: 'Kamino TVL and reserve utilization across lending markets',
    tier: worst(signals.map(s => s.status)),
    signals,
  }
}

// ─── Layer 2 — Oracle Risk ───────────────────────────────────────────────────

export function scoreOracleRisk(p: {
  feeds: Array<{
    symbol: string
    confRatio: number
    ageSeconds: number
    pythPrice: number
    jupiterPrice: number | null
  }>
}): RiskLayer {
  const signals: RiskSignal[] = []

  for (const feed of p.feeds) {
    // Staleness: REST API polling means prices are routinely 60–120s old — that's
    // normal latency, not a risk. Only flag genuinely stale feeds (5+ min = orange).
    const staleStatus  = thresh(feed.ageSeconds, [[600, 'red'], [300, 'orange'], [120, 'yellow']])
    // Confidence: Pyth conf intervals vary by asset liquidity. 2% is a real signal;
    // sub-1% is normal market microstructure noise for most assets.
    const confStatus   = thresh(feed.confRatio,  [[0.05, 'red'], [0.02, 'orange'], [0.005, 'yellow']])

    let devStatus: SignalStatus = 'green'
    let deviation = 0
    if (feed.jupiterPrice !== null && feed.jupiterPrice > 0) {
      deviation = Math.abs(feed.pythPrice - feed.jupiterPrice) / feed.jupiterPrice
      devStatus = thresh(deviation, [[0.03, 'red'], [0.015, 'orange'], [0.005, 'yellow']])
    }

    const rowStatus = worst([staleStatus, confStatus, devStatus]) as SignalStatus

    const details: string[] = [
      `${feed.ageSeconds}s old`,
      `conf ${(feed.confRatio * 100).toFixed(3)}%`,
    ]
    if (deviation > 0.001) details.push(`${(deviation * 100).toFixed(2)}% vs DEX`)

    signals.push({
      label: feed.symbol,
      value: `$${feed.pythPrice.toFixed(feed.pythPrice < 1 ? 4 : 2)}`,
      status: rowStatus,
      detail: details.join(' · '),
    })
  }

  return {
    id: 'oracle',
    name: 'Oracle Risk',
    description: 'Pyth feed staleness, confidence intervals, and Pyth vs DEX price deviation',
    tier: worst(signals.map(s => s.status)),
    signals,
  }
}

// ─── Layer 3 — Asset Risk ────────────────────────────────────────────────────

export function scoreAssetRisk(p: {
  solPrice: number
  prices: Record<string, number | null>
}): RiskLayer {
  const signals: RiskSignal[] = []
  const { prices } = p

  // Stablecoin peg deviation — check every stablecoin we have a price for.
  // Kamino uses price bands (±1% for pegged assets) as a circuit breaker.
  // We surface smaller deviations so users can react before the band fires.
  // If price is unavailable, skip the signal — no data is not a risk signal.
  for (const sym of ['USDC', 'USDT', 'PYUSD', 'USDS']) {
    const price = prices[sym]
    if (price === null || price === undefined) continue
    const dev = Math.abs(price - 1.0)
    signals.push({
      label: `${sym} Peg`,
      value: `$${price.toFixed(4)}`,
      status: thresh(dev, [[0.01, 'red'], [0.005, 'orange'], [0.003, 'yellow']]),
      detail:
        dev >= 0.003
          ? `${pct(dev)} deviation from $1.00 — depeg in progress`
          : 'Holding peg',
    })
  }

  // LST oracle note — Kamino prices jitoSOL / mSOL / bSOL using the on-chain
  // stake-pool exchange rate (SOL_staked / LST_minted), NOT DEX spot price.
  // A DEX depeg of 5% has zero effect on positions. We do NOT flag DEX depegs.
  // The only real LST risk is a stake-pool smart contract exploit, which would
  // require a separate incident response — no oracle signal can predict it.
  signals.push({
    label: 'LST Oracle Method',
    value: 'Stake-pool rate',
    status: 'green',
    detail: 'jitoSOL / mSOL / bSOL priced by on-chain stake pool — DEX price moves cannot trigger Kamino liquidations',
  })

  return {
    id: 'asset',
    name: 'Asset Risk',
    description: 'Stablecoin peg deviation · LST oracle method',
    tier: worst(signals.map(s => s.status)),
    signals,
  }
}

// ─── Layer 4 — Position Risk ─────────────────────────────────────────────────

export function scorePositionRisk(p: {
  obligations: Array<{
    obligationAddress?: string
    humanTag?: string
    refreshedStats?: {
      borrowLiquidationLimit?: string | number
      userTotalBorrow?: string | number
      userTotalDeposit?: string | number
      netAccountValue?: string | number
      loanToValue?: string | number
      borrowUtilization?: string | number
    }
    // legacy flat fields
    healthFactor?: number
    depositedValue?: number
    borrowedValue?: number
  }>
  vaultPositions: Array<{
    vaultAddress?: string
    totalShares?: string | number
    stakedShares?: string | number
    totalValueUsd?: number
    sharePrice?: number
    reserveUtilization?: number
    vaultTvlUsd?: number
    reserveTotalBorrowUsd?: number
    // legacy fields
    totalValue?: number
    symbol?: string
    vaultName?: string
    sharesAmount?: number
  }>
}): RiskLayer {
  const signals: RiskSignal[] = []

  // Filter to obligations that have actual borrow activity
  const activeObligations = p.obligations.filter(obl => {
    if (obl.refreshedStats) {
      return Number(obl.refreshedStats.userTotalBorrow ?? 0) > 0 ||
             Number(obl.refreshedStats.userTotalDeposit ?? 0) > 0
    }
    return obl.healthFactor !== undefined || obl.depositedValue !== undefined
  })

  if (activeObligations.length === 0 && p.vaultPositions.length === 0) {
    signals.push({
      label: 'No Kamino Positions',
      value: '—',
      status: 'green',
      detail: 'This wallet has no active lending, borrow, or vault positions on Kamino',
    })
  }

  for (const obl of activeObligations) {
    let hf: number | null = null
    let depositedValue: number | null = null
    let borrowedValue: number | null = null
    let netValue: number | null = null
    const tag = obl.humanTag ? ` (${obl.humanTag})` : ''

    if (obl.refreshedStats) {
      const liqLimit = Number(obl.refreshedStats.borrowLiquidationLimit ?? 0)
      const totalBorrow = Number(obl.refreshedStats.userTotalBorrow ?? 0)
      depositedValue = Number(obl.refreshedStats.userTotalDeposit ?? 0)
      borrowedValue = totalBorrow
      netValue = Number(obl.refreshedStats.netAccountValue ?? 0)
      // Health factor = liquidation limit / total borrow (>1 = healthy)
      hf = totalBorrow > 0 ? liqLimit / totalBorrow : null
    } else if (obl.healthFactor !== undefined) {
      hf = obl.healthFactor
      depositedValue = obl.depositedValue ?? null
      borrowedValue = obl.borrowedValue ?? null
    }

    if (hf !== null) {
      signals.push({
        label: `Health Factor${tag}`,
        value: hf.toFixed(3),
        status:
          hf < 1.1 ? 'red'
          : hf < 1.5 ? 'orange'
          : hf < 2.0 ? 'yellow'
          : 'green',
        detail:
          hf < 1.1 ? 'CRITICAL — liquidation imminent, act now'
          : hf < 1.5 ? 'Add collateral or repay to reduce risk'
          : hf < 2.0 ? 'Monitor — getting close to threshold'
          : 'Healthy position',
      })
    }

    if (depositedValue !== null && borrowedValue !== null) {
      signals.push({
        label: `Collateral / Debt${tag}`,
        value: `${usd(depositedValue)} / ${usd(borrowedValue)}`,
        status: 'green',
        detail: netValue !== null ? `Net: ${usd(netValue)}` : `Collateral minus debt`,
      })
    }
  }

  for (const pos of p.vaultPositions) {
    const totalShares = Number(pos.totalShares ?? pos.sharesAmount ?? 0)
    if (totalShares <= 0) continue

    const addr      = pos.vaultAddress ?? ''
    const shortAddr = addr ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : 'K-Vault'
    const value     = pos.totalValueUsd
    const util      = pos.reserveUtilization ?? 0
    const tvl       = pos.vaultTvlUsd ?? 0
    const borrowed  = pos.reserveTotalBorrowUsd ?? 0
    const available = tvl > 0 && borrowed > 0 ? Math.max(tvl - borrowed, 0) : 0
    const coverage  = value && value > 0 && available > 0 ? available / value : null

    signals.push({
      label: `K-Vault ${shortAddr}`,
      value: value !== undefined ? usd(value) : `${totalShares.toLocaleString(undefined, { maximumFractionDigits: 2 })} shares`,
      status: 'green',
      detail: value !== undefined
        ? `${totalShares.toLocaleString(undefined, { maximumFractionDigits: 2 })} shares · no liquidation risk`
        : 'K-Vault earn position — no liquidation risk',
    })

    if (util > 0) {
      const utilStatus = thresh(util, [[0.95, 'red'], [0.9, 'orange'], [0.8, 'yellow']])
      const coverageNote = coverage !== null
        ? ` · ${coverage >= 10 ? coverage.toFixed(0) : coverage.toFixed(1)}× your position available`
        : ''
      signals.push({
        label: 'Vault Utilization',
        value: pct(util),
        status: utilStatus,
        detail:
          util >= 0.95
            ? `Near cap — withdrawal may be severely delayed${coverageNote}`
            : util >= 0.8
            ? `High — monitor withdrawal availability${coverageNote}`
            : `Normal — exit liquidity available${coverageNote}`,
      })
    }
  }

  return {
    id: 'position',
    name: 'Position Risk',
    description: 'Your health factor, collateral ratio, and vault positions',
    tier: worst(signals.map(s => s.status)),
    signals,
  }
}

// ─── Layer 5 — Network Risk ──────────────────────────────────────────────────

export function scoreNetworkRisk(p: {
  tps: number
  avgPriorityFee: number
}): RiskLayer {
  const signals: RiskSignal[] = []

  // TPS — low TPS means txs won't land, can't save position from liquidation
  // If TPS = 0 it means the RPC call returned no data (likely rate-limited
  // on the public endpoint) — treat as unknown, not Critical
  if (p.tps === 0) {
    signals.push({
      label: 'Solana TPS',
      value: 'Unavailable',
      status: 'yellow',
      detail: 'TPS data not returned by RPC — add a VITE_HELIUS_API_KEY for reliable network data',
    })
  } else {
    const tpsStatus: SignalStatus =
      p.tps < 800 ? 'red'
      : p.tps < 1500 ? 'orange'
      : p.tps < 2500 ? 'yellow'
      : 'green'
    signals.push({
      label: 'Solana TPS',
      value: `${Math.round(p.tps).toLocaleString()} tx/s`,
      status: tpsStatus,
      detail: tpsStatus !== 'green'
        ? 'Network congested — time-sensitive txs may fail or delay'
        : 'Network healthy',
    })
  }

  // Priority fee — spike = congestion, costs more to land urgent txs
  // Skip if fee is 0 (no data from RPC — not a signal)
  if (p.avgPriorityFee > 0) {
    const feeStatus: SignalStatus =
      p.avgPriorityFee > 200_000 ? 'red'
      : p.avgPriorityFee > 50_000 ? 'orange'
      : p.avgPriorityFee > 10_000 ? 'yellow'
      : 'green'
    signals.push({
      label: 'Avg Priority Fee',
      value: `${Math.round(p.avgPriorityFee).toLocaleString()} μLamports`,
      status: feeStatus,
      detail: feeStatus !== 'green'
        ? 'Elevated fees to land transactions — add priority fee if saving a position'
        : 'Normal fee environment',
    })
  }

  return {
    id: 'network',
    name: 'Network Risk',
    description: 'Solana TPS, congestion level, and priority fee environment',
    tier: worst(signals.map(s => s.status)),
    signals,
  }
}

// ─── Overall score ───────────────────────────────────────────────────────────

/**
 * Position risk drives the headline — it's the user's actual exposure.
 * Protocol/oracle/network/asset are context layers that can bump the overall
 * by at most one tier above the position tier. A lend-only user with no borrow
 * risk should never see "AT RISK" just because a protocol-wide reserve is high.
 */
export function computeOverall(layers: RiskLayer[]): RiskTier {
  const activeLayers = layers.filter(l => l.tier !== 'error' && l.tier !== 'loading')
  if (activeLayers.length === 0) return 'loading'

  const positionLayer = layers.find(l => l.id === 'position')

  // No position layer (no wallet) — show aggregate protocol health
  if (!positionLayer || positionLayer.tier === 'loading' || positionLayer.tier === 'error') {
    return worst(activeLayers.map(l => l.tier))
  }

  const posTier = positionLayer.tier

  // Orange/red positions are the user's headline risk — show it directly
  if (posTier === 'orange' || posTier === 'red') return posTier

  // Detect whether the user has any borrow exposure.
  // Supply-only (vault/lend-only) users are not affected by oracle deviations,
  // network congestion, or protocol-wide utilization in the same way borrowers are.
  // For them, context layers can push the overall to yellow at most — never "AT RISK".
  const hasBorrowExposure = positionLayer.signals.some(
    s => s.label.startsWith('Health Factor')
  )

  const tierOrder: RiskTier[] = ['green', 'yellow', 'orange', 'red']
  const posIdx = tierOrder.indexOf(posTier)
  const contextTiers = activeLayers.filter(l => l.id !== 'position').map(l => l.tier)
  const contextTier  = contextTiers.length > 0 ? worst(contextTiers) : 'green'
  const ctxIdx       = tierOrder.indexOf(contextTier)

  if (!hasBorrowExposure) {
    // Supply-only: context can push to yellow but never beyond
    const finalIdx = Math.max(posIdx, Math.min(1, ctxIdx))
    return tierOrder[finalIdx]
  }

  // Borrowers: context layers can bump by at most 1 tier above their position tier
  const finalIdx = Math.max(posIdx, Math.min(posIdx + 1, ctxIdx))
  return tierOrder[finalIdx]
}
