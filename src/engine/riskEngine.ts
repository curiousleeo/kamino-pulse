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
  kaminoTVL: number
  defillamaTVL: number
  tvlChange24h: number
  maxReserveUtilization: number
}): RiskLayer {
  const signals: RiskSignal[] = []

  // Independent TVL cross-check (Kamino self-reported vs DeFiLlama on-chain)
  const tvlDev =
    p.kaminoTVL > 0 && p.defillamaTVL > 0
      ? Math.abs(p.kaminoTVL - p.defillamaTVL) / Math.max(p.kaminoTVL, p.defillamaTVL)
      : 0

  signals.push({
    label: 'TVL Cross-Check',
    value: `${usd(p.defillamaTVL)} (DeFiLlama)`,
    status: thresh(tvlDev, [[0.2, 'red'], [0.1, 'orange'], [0.03, 'yellow']]),
    detail:
      tvlDev > 0.03
        ? `${pct(tvlDev)} deviation between Kamino & DeFiLlama — investigate`
        : 'Kamino and DeFiLlama TVL consistent',
  })

  // 24h TVL change — rapid outflow = bank run signal
  const changeAbs = Math.abs(p.tvlChange24h)
  const isNeg = p.tvlChange24h < 0
  signals.push({
    label: 'TVL 24h Change',
    value: `${p.tvlChange24h >= 0 ? '+' : ''}${pct(p.tvlChange24h)}`,
    status: isNeg
      ? thresh(changeAbs, [[0.25, 'red'], [0.15, 'orange'], [0.05, 'yellow']])
      : 'green',
    detail:
      isNeg && changeAbs > 0.05
        ? 'Unusual TVL outflow — potential bank run signal'
        : 'Normal TVL movement',
  })

  // Highest reserve utilization across all markets
  signals.push({
    label: 'Peak Reserve Utilization',
    value: pct(p.maxReserveUtilization),
    status: thresh(p.maxReserveUtilization, [[0.95, 'red'], [0.9, 'orange'], [0.8, 'yellow']]),
    detail:
      p.maxReserveUtilization >= 0.8
        ? 'High utilization — withdrawal liquidity constrained'
        : 'Liquidity available across reserves',
  })

  return {
    id: 'protocol',
    name: 'Protocol Health',
    description: 'TVL cross-check, reserve utilization, and liquidity depth',
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
    const staleStatus  = thresh(feed.ageSeconds, [[120, 'red'], [60, 'orange'], [30, 'yellow']])
    const confStatus   = thresh(feed.confRatio,  [[0.01, 'red'], [0.005, 'orange'], [0.001, 'yellow']])

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
  const { prices, solPrice } = p

  // Stablecoin peg deviation
  for (const sym of ['USDC', 'USDT']) {
    const price = prices[sym]
    if (price === null || price === undefined) {
      signals.push({ label: `${sym} Peg`, value: 'N/A', status: 'yellow', detail: 'Price unavailable' })
      continue
    }
    const dev = Math.abs(price - 1.0)
    signals.push({
      label: `${sym} Peg`,
      value: `$${price.toFixed(4)}`,
      status: thresh(dev, [[0.01, 'red'], [0.005, 'orange'], [0.003, 'yellow']]),
      detail:
        dev >= 0.003
          ? `Deviating ${pct(dev)} from $1.00 — depeg in progress`
          : 'Holding peg',
    })
  }

  // LST/SOL ratio — LSTs accumulate staking rewards so their ratio to SOL grows over time.
  // A ratio of 1.30+ is normal for LSTs that have been running for years.
  // We only flag a DISCOUNT (ratio dropping below expected), not the absolute level.
  const lsts = ['jitoSOL', 'mSOL', 'bSOL']
  for (const sym of lsts) {
    const lstPrice = prices[sym]
    if (!lstPrice || !solPrice) {
      // Don't penalise missing prices — just skip silently with green
      signals.push({ label: `${sym}/SOL`, value: 'N/A', status: 'green', detail: 'Price data unavailable — not flagging' })
      continue
    }
    const ratio = lstPrice / solPrice
    // Only flag if the LST is trading BELOW SOL (genuine depeg)
    // Normal accumulated exchange rate can be 1.05 to 1.40+ depending on LST age
    signals.push({
      label: `${sym}/SOL`,
      value: `${ratio.toFixed(4)}x`,
      status:
        ratio < 0.97 ? 'red'
        : ratio < 0.99 ? 'orange'
        : 'green',
      detail:
        ratio < 0.99
          ? `Trading at a discount to SOL — possible depeg event`
          : `${ratio.toFixed(3)}x SOL — includes accumulated staking yield, healthy`,
    })
  }

  return {
    id: 'asset',
    name: 'Asset Risk',
    description: 'Stablecoin peg deviation and LST discount / depeg monitoring',
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
    if (totalShares > 0) {
      const addr = (pos.vaultAddress as string | undefined) ?? ''
      const shortAddr = addr ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : 'K-Vault'
      const value = (pos as { totalValueUsd?: number }).totalValueUsd
      signals.push({
        label: `K-Vault ${shortAddr}`,
        value: value !== undefined ? usd(value) : `${totalShares.toLocaleString(undefined, { maximumFractionDigits: 2 })} shares`,
        status: 'green',
        detail: value !== undefined
          ? `${totalShares.toLocaleString(undefined, { maximumFractionDigits: 2 })} shares · no liquidation risk`
          : 'K-Vault earn position — no liquidation risk',
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
  const tpsStatus: SignalStatus =
    p.tps < 800 ? 'red'
    : p.tps < 1500 ? 'orange'
    : p.tps < 2500 ? 'yellow'
    : 'green'

  signals.push({
    label: 'Solana TPS',
    value: `${Math.round(p.tps).toLocaleString()} tx/s`,
    status: tpsStatus,
    detail:
      tpsStatus !== 'green'
        ? 'Network congested — time-sensitive txs may fail or delay'
        : 'Network healthy',
  })

  // Priority fee — spike = congestion, costs more to land urgent txs
  const feeStatus: SignalStatus =
    p.avgPriorityFee > 200_000 ? 'red'
    : p.avgPriorityFee > 50_000 ? 'orange'
    : p.avgPriorityFee > 10_000 ? 'yellow'
    : 'green'

  signals.push({
    label: 'Avg Priority Fee',
    value: `${Math.round(p.avgPriorityFee).toLocaleString()} μLamports`,
    status: feeStatus,
    detail:
      feeStatus !== 'green'
        ? 'Elevated fees to land transactions — add priority fee if saving a position'
        : 'Normal fee environment',
  })

  return {
    id: 'network',
    name: 'Network Risk',
    description: 'Solana TPS, congestion level, and priority fee environment',
    tier: worst(signals.map(s => s.status)),
    signals,
  }
}

// ─── Overall score ───────────────────────────────────────────────────────────

export function computeOverall(layers: RiskLayer[]): RiskTier {
  const activeLayers = layers.filter(l => l.tier !== 'error' && l.tier !== 'loading')
  return activeLayers.length > 0 ? worst(activeLayers.map(l => l.tier)) : 'loading'
}
