import { useCallback, useEffect, useState } from 'react'
import type { RiskLayer, RiskTier } from './types'
import type { KaminoObligation, KaminoVaultPosition, ReserveInfo, ReserveRegistry } from './api/kamino'
import { LandingHero } from './components/LandingHero'
import { ObligationCard } from './components/ObligationCard'
import { VaultCard } from './components/VaultCard'
import { RiskCard } from './components/RiskCard'
import {
  fetchMarkets,
  fetchReserveMetrics,
  fetchUserObligations,
  fetchUserVaultPositions,
  buildReserveRegistry,
  extractUtilization,
  getMarketKey,
} from './api/kamino'
import { fetchKaminoTVL } from './api/defillama'
import { fetchPythPrices } from './api/pyth'
import { fetchJupiterPrices } from './api/jupiter'
import { fetchNetworkHealth } from './api/helius'
import {
  scoreProtocolHealth,
  scoreOracleRisk,
  scoreAssetRisk,
  scorePositionRisk,
  scoreNetworkRisk,
  computeOverall,
} from './engine/riskEngine'

const REFRESH_MS = 60_000

// Minimum supply USD to show in pool liquidity panel
const MIN_POOL_SUPPLY_USD = 5_000_000  // $5M — filters out dust/micro reserves
// Max number of reserves to display in the liquidity panel
const MAX_POOL_ROWS = 12

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${n.toFixed(2)}`
}

function shortWallet(w: string) {
  return `${w.slice(0, 4)}…${w.slice(-4)}`
}

function errorLayer(id: string, name: string, description: string, detail: string): RiskLayer {
  return {
    id,
    name,
    description,
    tier: 'error',
    signals: [{ label: 'Fetch Error', value: 'Failed', status: 'yellow', detail }],
  }
}

function getActiveObligations(obs: KaminoObligation[]) {
  return obs.filter(obl => {
    if (obl.refreshedStats) {
      return (
        Number(obl.refreshedStats.userTotalBorrow ?? 0) > 0 ||
        Number(obl.refreshedStats.userTotalDeposit ?? 0) > 0
      )
    }
    return obl.healthFactor !== undefined || obl.depositedValue !== undefined
  })
}

function portfolioTotals(
  obligations: KaminoObligation[],
  vaults: KaminoVaultPosition[]
) {
  let deposited = 0
  let borrowed = 0
  let worstHF: number | null = null

  for (const obl of obligations) {
    if (obl.refreshedStats) {
      deposited += Number(obl.refreshedStats.userTotalDeposit ?? 0)
      const borrow = Number(obl.refreshedStats.userTotalBorrow ?? 0)
      borrowed += borrow
      if (borrow > 0) {
        const liqLimit = Number(obl.refreshedStats.borrowLiquidationLimit ?? 0)
        const hf = liqLimit / borrow
        if (worstHF === null || hf < worstHF) worstHF = hf
      }
    } else {
      deposited += obl.depositedValue ?? 0
      borrowed += obl.borrowedValue ?? 0
      if (obl.healthFactor !== undefined) {
        if (worstHF === null || obl.healthFactor < worstHF) worstHF = obl.healthFactor
      }
    }
  }

  for (const v of vaults) {
    deposited += v.totalValueUsd ?? 0
  }

  return { deposited, borrowed, net: deposited - borrowed, worstHF }
}

// Build a symbol-keyed map from the reserve registry for a given market
function reservesBySymbolForMarket(
  registry: ReserveRegistry,
  marketKey: string
): Record<string, ReserveInfo> {
  const map: Record<string, ReserveInfo> = {}
  for (const r of Object.values(registry)) {
    if (r.marketKey === marketKey) {
      map[r.symbol] = r
    }
  }
  return map
}

const OVERALL_CONFIG: Record<
  RiskTier,
  { label: string; color: string; desc: string }
> = {
  green:   { label: 'ALL GOOD',    color: '#10b981', desc: 'Your portfolio looks healthy across all risk factors.' },
  yellow:  { label: 'WATCH',       color: '#f59e0b', desc: 'Minor signals worth monitoring. No immediate action needed.' },
  orange:  { label: 'AT RISK',     color: '#f97316', desc: 'Multiple risk factors active. Consider reducing exposure.' },
  red:     { label: 'CRITICAL',    color: '#ef4444', desc: 'Severe risk detected. Take action to protect your positions.' },
  loading: { label: 'LOADING',     color: '#475569', desc: 'Fetching live data…' },
  error:   { label: 'ERROR',       color: '#334155', desc: 'Could not load data. Check your connection.' },
}

// ─── Pool Liquidity Panel ─────────────────────────────────────────────────────

function utilizationColor(u: number): string {
  if (u >= 0.92) return '#ef4444'
  if (u >= 0.82) return '#f97316'
  if (u >= 0.72) return '#f59e0b'
  return '#10b981'
}

function utilizationLabel(u: number, symbol: string): string {
  const isStable = ['USDC', 'USDT'].includes(symbol)
  const target = isStable ? 0.85 : 0.70
  if (u >= 0.95) return 'Near cap — withdrawals severely constrained'
  if (u >= target + 0.10) return 'Above target — borrow rates elevated, exiting may be slow'
  if (u >= target) return 'At target — normal conditions'
  return 'Below target — plenty of liquidity available'
}

interface PoolLiquidityPanelProps {
  registry: ReserveRegistry
  marketKey: string
}

function PoolLiquidityPanel({ registry, marketKey }: PoolLiquidityPanelProps) {
  const reserves = Object.values(registry)
    .filter(r => r.marketKey === marketKey && r.totalSupplyUsd >= MIN_POOL_SUPPLY_USD)
    .sort((a, b) => b.totalSupplyUsd - a.totalSupplyUsd)
    .slice(0, MAX_POOL_ROWS)

  if (reserves.length === 0) return null

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        background: '#0d1117',
        border: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <div className="px-6 pt-5 pb-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
        <p className="text-[10px] font-bold tracking-[0.2em] text-slate-700 uppercase mb-1">
          Pool Liquidity
        </p>
        <p className="text-xs text-slate-600">
          How much of each reserve is borrowed — high utilization means you may not be able to withdraw immediately.
        </p>
      </div>
      <div className="px-6 py-4 space-y-4">
        {reserves.map(r => {
          const u = r.utilization
          const color = utilizationColor(u)
          return (
            <div key={r.reservePubkey} className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-slate-300 font-semibold w-14">{r.symbol}</span>
                  <span className="text-slate-700">{fmt(r.totalSupplyUsd)} supplied</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-slate-600">
                    Earn {(r.supplyApy * 100).toFixed(2)}%
                  </span>
                  <span className="font-mono font-bold" style={{ color }}>
                    {(u * 100).toFixed(1)}% used
                  </span>
                </div>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#1a1f2e' }}>
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${Math.min(u * 100, 100)}%`, background: color }}
                />
              </div>
              <p className="text-[10px] text-slate-700">{utilizationLabel(u, r.symbol)}</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [wallet, setWallet] = useState('')
  const [layers, setLayers] = useState<RiskLayer[]>([])
  const [obligations, setObligations] = useState<KaminoObligation[]>([])
  const [vaultPositions, setVaultPositions] = useState<KaminoVaultPosition[]>([])
  const [overall, setOverall] = useState<RiskTier>('loading')
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [loading, setLoading] = useState(false)
  const [countdown, setCountdown] = useState(REFRESH_MS / 1000)
  const [kaminoTVL, setKaminoTVL] = useState(0)
  const [protocolExpanded, setProtocolExpanded] = useState(false)
  const [registry, setRegistry] = useState<ReserveRegistry>({})

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const newLayers: RiskLayer[] = []

    try {
      const [marketsRes, defillamaRes, pythRes, jupiterRes, networkRes] =
        await Promise.allSettled([
          fetchMarkets(),
          fetchKaminoTVL(),
          fetchPythPrices(),
          fetchJupiterPrices(),
          fetchNetworkHealth(),
        ])

      const markets    = marketsRes.status    === 'fulfilled' ? marketsRes.value    : []
      const defillama  = defillamaRes.status  === 'fulfilled' ? defillamaRes.value  : null
      const pythPrices = pythRes.status       === 'fulfilled' ? pythRes.value       : []
      const jupPrices  = jupiterRes.status    === 'fulfilled' ? jupiterRes.value    : []
      const network    = networkRes.status    === 'fulfilled' ? networkRes.value    : null

      if (defillama?.current) setKaminoTVL(defillama.current)

      // Build price map
      const priceMap: Record<string, number | null> = {}
      for (const f of pythPrices) priceMap[f.symbol.split('/')[0]] = f.price
      for (const p of jupPrices) if (p.price !== null) priceMap[p.symbol] = p.price

      // ── Build reserve registry across all markets ──────────────────────────
      // Do this in parallel with everything else; used for pool liquidity display
      // and reserve-by-symbol lookups in ObligationCard
      let newRegistry: ReserveRegistry = {}
      try {
        newRegistry = await buildReserveRegistry(markets)
        setRegistry(newRegistry)
      } catch (e) {
        console.warn('[reserve registry]', e)
      }

      // ── Layer 1: Protocol Health ───────────────────────────────────────────
      try {
        let maxUtil = 0
        const primaryMarkets = markets.filter(m => m.isPrimary).slice(0, 5)
        const reserveResults = await Promise.allSettled(
          primaryMarkets.map(m => fetchReserveMetrics(getMarketKey(m)))
        )
        for (const result of reserveResults) {
          if (result.status !== 'fulfilled') continue
          for (const r of result.value) {
            const supplyUsd = Number(r.totalSupplyUsd ?? 0)
            if (supplyUsd < 1_000_000) continue
            const u = extractUtilization(r)
            if (u > maxUtil) maxUtil = u
          }
        }
        newLayers.push(
          scoreProtocolHealth({
            kaminoTVL:             defillama?.current ?? 0,
            defillamaTVL:          defillama?.current ?? 0,
            tvlChange24h:          defillama?.change24h ?? 0,
            maxReserveUtilization: maxUtil,
          })
        )
      } catch (e) {
        newLayers.push(errorLayer('protocol', 'Protocol Health', 'TVL, reserve utilization, and liquidity depth', String(e)))
      }

      // ── Layer 2: Oracle Risk ───────────────────────────────────────────────
      try {
        const feeds = pythPrices.map(feed => ({
          symbol:       feed.symbol,
          confRatio:    feed.confRatio,
          ageSeconds:   feed.ageSeconds,
          pythPrice:    feed.price,
          jupiterPrice: priceMap[feed.symbol.split('/')[0]] ?? null,
        }))
        newLayers.push(scoreOracleRisk({ feeds }))
      } catch (e) {
        newLayers.push(errorLayer('oracle', 'Oracle Risk', 'Pyth feed staleness, confidence intervals, and cross-source deviation', String(e)))
      }

      // ── Layer 3: Asset Risk ────────────────────────────────────────────────
      try {
        newLayers.push(scoreAssetRisk({ solPrice: priceMap['SOL'] ?? 0, prices: priceMap }))
      } catch (e) {
        newLayers.push(errorLayer('asset', 'Asset Risk', 'Stablecoin peg deviation and LST oracle method', String(e)))
      }

      // ── Layer 4: Position Risk (wallet required) ───────────────────────────
      if (wallet) {
        try {
          const [obligationResults, rawVaults] = await Promise.all([
            Promise.allSettled(
              markets.map(m => fetchUserObligations(getMarketKey(m), wallet))
            ),
            fetchUserVaultPositions(wallet, newRegistry).catch(() => [] as KaminoVaultPosition[]),
          ])
          const allObligations = obligationResults.flatMap(r =>
            r.status === 'fulfilled' ? r.value : []
          )

          setObligations(allObligations)
          setVaultPositions(rawVaults)

          newLayers.push(scorePositionRisk({ obligations: allObligations, vaultPositions: rawVaults }))
        } catch (e) {
          newLayers.push(errorLayer('position', 'Position Risk', 'Your health factor, collateral ratio, and vault positions', String(e)))
        }
      }

      // ── Layer 5: Network Risk ──────────────────────────────────────────────
      try {
        if (network) {
          newLayers.push(scoreNetworkRisk({ tps: network.tps, avgPriorityFee: network.avgPriorityFee }))
        } else {
          throw new Error('Network data unavailable')
        }
      } catch (e) {
        newLayers.push(errorLayer('network', 'Network Risk', 'Solana TPS, congestion, and priority fee environment', String(e)))
      }
    } finally {
      setLayers(newLayers)
      setOverall(computeOverall(newLayers))
      setLastUpdated(new Date())
      setLoading(false)
      setCountdown(REFRESH_MS / 1000)
    }
  }, [wallet])

  useEffect(() => { fetchAll() }, [fetchAll])

  useEffect(() => {
    const id = setInterval(fetchAll, REFRESH_MS)
    return () => clearInterval(id)
  }, [fetchAll])

  useEffect(() => {
    const id = setInterval(
      () => setCountdown(c => (c <= 1 ? REFRESH_MS / 1000 : c - 1)),
      1000
    )
    return () => clearInterval(id)
  }, [])

  function handleSearch(w: string) {
    setObligations([])
    setVaultPositions([])
    setWallet(w)
  }

  // ── No wallet → Landing ───────────────────────────────────────────────────
  if (!wallet) {
    return (
      <LandingHero
        onSearch={handleSearch}
        loading={loading}
        tvl={kaminoTVL || undefined}
      />
    )
  }

  // ── With wallet → Portfolio view ──────────────────────────────────────────
  const activeObligations = getActiveObligations(obligations)
  const activeVaults = vaultPositions.filter(v => Number(v.totalShares ?? 0) > 0)
  const hasPositions = activeObligations.length > 0 || activeVaults.length > 0
  const totals = portfolioTotals(activeObligations, activeVaults)
  const overall_cfg = OVERALL_CONFIG[overall]

  // Determine which markets the user actually has positions in
  const userMarketKeys = [...new Set(
    activeObligations
      .filter(o => o.marketKey)
      .map(o => o.marketKey as string)
  )]

  // Primary market key for pool liquidity panel
  const MAIN_MARKET = '7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF'
  const poolMarketKey = userMarketKeys.includes(MAIN_MARKET) ? MAIN_MARKET : userMarketKeys[0]

  // Protocol layers (exclude position — shown in its own section)
  const protocolLayers = layers.filter(l => l.id !== 'position')

  return (
    <div className="min-h-screen" style={{ background: '#07090e' }}>

      {/* ── Header ── */}
      <header
        className="sticky top-0 z-20"
        style={{
          background: 'rgba(7,9,14,0.85)',
          backdropFilter: 'blur(16px)',
          borderBottom: '1px solid rgba(255,255,255,0.05)',
        }}
      >
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          {/* Logo */}
          <button
            onClick={() => handleSearch('')}
            className="flex items-center gap-2.5 flex-shrink-0 group"
          >
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{
                background: 'rgba(139,92,246,0.15)',
                border: '1px solid rgba(139,92,246,0.3)',
              }}
            >
              <span className="text-violet-400 text-xs font-black">K</span>
            </div>
            <span className="text-slate-400 text-sm font-semibold group-hover:text-slate-300 transition-colors">
              KaminoPulse
            </span>
          </button>

          {/* Wallet pill */}
          <div className="flex items-center gap-2 flex-1 justify-center min-w-0">
            <span
              className="px-3 py-1.5 rounded-lg text-xs font-mono text-slate-400 truncate max-w-xs"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}
            >
              {shortWallet(wallet)}
            </span>
            <button
              onClick={() => handleSearch('')}
              className="text-xs text-slate-600 hover:text-slate-400 transition-colors flex-shrink-0"
            >
              ✕ clear
            </button>
          </div>

          {/* Refresh */}
          <div className="flex items-center gap-3 flex-shrink-0">
            <span className="text-[11px] text-slate-700 hidden sm:block">
              {loading ? 'refreshing…' : `next in ${countdown}s`}
            </span>
            <button
              onClick={fetchAll}
              disabled={loading}
              className="text-xs px-3 py-1.5 rounded-lg transition-all disabled:opacity-30"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.06)',
                color: '#64748b',
              }}
            >
              {loading ? '…' : '↻'}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-6">

        {/* ── Portfolio Summary ── */}
        <div
          className="rounded-2xl overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, #0d1117 0%, rgba(109,40,217,0.06) 100%)',
            border: '1px solid rgba(139,92,246,0.15)',
            boxShadow: '0 0 60px rgba(109,40,217,0.06)',
          }}
        >
          <div className="px-6 pt-6 pb-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <p className="text-[10px] font-bold tracking-[0.2em] text-slate-700 uppercase mb-2">
                  Portfolio Overview
                </p>
                <div className="flex items-center gap-3">
                  <div
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{
                      backgroundColor: overall_cfg.color,
                      boxShadow: `0 0 10px ${overall_cfg.color}88`,
                    }}
                  />
                  <h2
                    className="text-3xl font-black tracking-tight"
                    style={{ color: overall_cfg.color }}
                  >
                    {overall_cfg.label}
                  </h2>
                </div>
                <p className="text-slate-500 text-sm mt-1.5">{overall_cfg.desc}</p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-[11px] text-slate-700">
                  {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : 'Fetching…'}
                </p>
              </div>
            </div>
          </div>

          {/* Totals grid */}
          <div
            className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0"
            style={{ '--tw-divide-opacity': 0.04 } as React.CSSProperties}
          >
            {[
              { label: 'Total Deposited', value: totals.deposited > 0 ? fmt(totals.deposited) : '—', sub: 'collateral + vaults' },
              { label: 'Total Borrowed',  value: totals.borrowed  > 0 ? fmt(totals.borrowed)  : '—', sub: 'outstanding debt' },
              { label: 'Net Worth',       value: totals.deposited > 0 ? fmt(totals.net) : '—',         sub: 'deposited minus debt', highlight: totals.net },
              { label: 'Active Positions',value: loading ? '…' : String(activeObligations.length + activeVaults.length), sub: 'across all markets' },
            ].map(({ label, value, sub, highlight }) => (
              <div key={label} className="px-5 py-4" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
                <p className="text-[11px] text-slate-600 font-medium mb-1.5">{label}</p>
                <p
                  className="text-xl font-black leading-none"
                  style={{
                    color:
                      highlight !== undefined
                        ? highlight >= 0 ? '#34d399' : '#f87171'
                        : '#f1f5f9',
                  }}
                >
                  {value}
                </p>
                <p className="text-[11px] text-slate-700 mt-1.5">{sub}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Positions ── */}
        {loading && !hasPositions ? (
          <div className="space-y-4">
            {[0, 1].map(i => (
              <div
                key={i}
                className="rounded-2xl animate-pulse"
                style={{ background: '#0d1117', border: '1px solid rgba(255,255,255,0.04)', height: 220 }}
              />
            ))}
          </div>
        ) : !hasPositions ? (
          <div
            className="rounded-2xl px-6 py-10 text-center"
            style={{ background: '#0d1117', border: '1px solid rgba(255,255,255,0.06)' }}
          >
            <p className="text-slate-400 font-semibold mb-2">No active Kamino positions found</p>
            <p className="text-slate-600 text-sm leading-relaxed max-w-sm mx-auto">
              This wallet doesn't appear to have any open lending, borrowing, or vault positions
              on Kamino Finance right now.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <h2 className="text-[10px] font-bold tracking-[0.2em] text-slate-700 uppercase px-1">
              Your Positions ({activeObligations.length + activeVaults.length})
            </h2>

            {activeObligations.map((obl, i) => {
              const symMap = obl.marketKey
                ? reservesBySymbolForMarket(registry, obl.marketKey)
                : {}
              return (
                <ObligationCard
                  key={obl.obligationAddress || i}
                  obligation={obl}
                  index={i}
                  reservesBySymbol={symMap}
                />
              )
            })}

            {activeVaults.map((vault, i) => (
              <VaultCard key={vault.vaultAddress || i} position={vault} index={i} registry={registry} />
            ))}
          </div>
        )}

        {/* ── Pool Liquidity (shown when user has positions) ── */}
        {hasPositions && poolMarketKey && Object.keys(registry).length > 0 && (
          <PoolLiquidityPanel registry={registry} marketKey={poolMarketKey} />
        )}

        {/* ── Protocol Health (collapsible) ── */}
        <div>
          <button
            onClick={() => setProtocolExpanded(e => !e)}
            className="w-full flex items-center justify-between px-5 py-3.5 rounded-xl transition-all"
            style={{
              background: 'rgba(255,255,255,0.025)',
              border: '1px solid rgba(255,255,255,0.05)',
            }}
          >
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-bold tracking-[0.2em] text-slate-600 uppercase">
                Protocol Health Context
              </span>
              <span className="text-[11px] text-slate-700">
                — Kamino-wide risk signals
              </span>
            </div>
            <span
              className="text-slate-700 text-sm transition-transform duration-200"
              style={{ display: 'inline-block', transform: protocolExpanded ? 'rotate(180deg)' : 'none' }}
            >
              ▾
            </span>
          </button>

          {protocolExpanded && (
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
              {protocolLayers.map(layer => (
                <RiskCard key={layer.id} layer={layer} />
              ))}
            </div>
          )}
        </div>

        {/* ── Trust signal ── */}
        <div
          className="rounded-xl px-5 py-4 flex items-start gap-3"
          style={{
            background: 'rgba(16,185,129,0.04)',
            border: '1px solid rgba(16,185,129,0.08)',
          }}
        >
          <span className="text-emerald-500 text-base mt-0.5 flex-shrink-0">✓</span>
          <p className="text-[11px] text-slate-600 leading-relaxed">
            <span className="text-emerald-500 font-semibold">Zero bad debt on record.</span>{' '}
            Kamino processed 55,649 liquidations during the February 2026 SOL crash without
            a single bad debt event. Protocol parameters and dynamic liquidation bonuses are
            designed to keep collateral liquidated before positions go underwater.
          </p>
        </div>

        {/* Footer */}
        <footer className="text-center pt-2 pb-6">
          <p className="text-[11px] text-slate-800">
            Data from Kamino Finance · DeFiLlama · Pyth Network · Jupiter · Helius
          </p>
          <p className="text-[11px] text-slate-900 mt-1">
            Read-only · no wallet connection required · not financial advice
          </p>
        </footer>

      </main>
    </div>
  )
}
