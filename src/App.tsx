import { useCallback, useEffect, useState } from 'react'
import type { RiskLayer, RiskTier } from './types'
import { WalletInput } from './components/WalletInput'
import { OverallScore } from './components/OverallScore'
import { RiskCard } from './components/RiskCard'
import {
  fetchMarkets,
  fetchReserveMetrics,
  fetchUserObligations,
  fetchUserVaultPositions,
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

function errorLayer(
  id: string,
  name: string,
  description: string,
  detail: string
): RiskLayer {
  return {
    id,
    name,
    description,
    tier: 'error',
    signals: [{ label: 'Fetch Error', value: 'Failed', status: 'yellow', detail }],
  }
}

export default function App() {
  const [wallet, setWallet] = useState('')
  const [layers, setLayers] = useState<RiskLayer[]>([])
  const [overall, setOverall] = useState<RiskTier>('loading')
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [loading, setLoading] = useState(false)
  const [countdown, setCountdown] = useState(REFRESH_MS / 1000)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const newLayers: RiskLayer[] = []

    try {
      // ── Parallel top-level fetches ──────────────────────────────────────
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

      // Build price map — Pyth as base, Jupiter overrides where available
      const priceMap: Record<string, number | null> = {}
      for (const f of pythPrices) {
        const sym = f.symbol.split('/')[0] // 'SOL' from 'SOL/USD'
        priceMap[sym] = f.price
      }
      for (const p of jupPrices) {
        if (p.price !== null) priceMap[p.symbol] = p.price
      }
      const jupBySymbol = priceMap

      // ── Layer 1: Protocol Health ────────────────────────────────────────
      try {
        let maxUtil = 0
        // Only check primary markets for protocol health (performance)
        const primaryMarkets = markets.filter(m => m.isPrimary).slice(0, 5)
        const reserveResults = await Promise.allSettled(
          primaryMarkets.map(m => fetchReserveMetrics(getMarketKey(m)))
        )
        for (const result of reserveResults) {
          if (result.status !== 'fulfilled') continue
          for (const r of result.value) {
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

      // ── Layer 2: Oracle Risk ────────────────────────────────────────────
      try {
        const feeds = pythPrices.map(feed => {
          const baseSymbol = feed.symbol.split('/')[0] // 'SOL' from 'SOL/USD'
          return {
            symbol:       feed.symbol,
            confRatio:    feed.confRatio,
            ageSeconds:   feed.ageSeconds,
            pythPrice:    feed.price,
            jupiterPrice: jupBySymbol[baseSymbol] ?? null,
          }
        })
        newLayers.push(scoreOracleRisk({ feeds }))
      } catch (e) {
        newLayers.push(errorLayer('oracle', 'Oracle Risk', 'Pyth feed staleness, confidence intervals, and cross-source deviation', String(e)))
      }

      // ── Layer 3: Asset Risk ─────────────────────────────────────────────
      try {
        newLayers.push(
          scoreAssetRisk({
            solPrice: jupBySymbol['SOL'] ?? 0,
            prices:   jupBySymbol,
          })
        )
      } catch (e) {
        newLayers.push(errorLayer('asset', 'Asset Risk', 'Stablecoin peg deviation and LST depeg monitoring', String(e)))
      }

      // ── Layer 4: Position Risk (wallet required) ────────────────────────
      if (wallet) {
        try {
          // Check ALL markets in parallel — position can be in any of the 29 markets
          const [obligationResults, vaultPositions] = await Promise.all([
            Promise.allSettled(
              markets.map(m => fetchUserObligations(getMarketKey(m), wallet))
            ),
            fetchUserVaultPositions(wallet).catch(() => []),
          ])
          const allObligations = obligationResults
            .flatMap(r => r.status === 'fulfilled' ? r.value : [])

          newLayers.push(scorePositionRisk({ obligations: allObligations, vaultPositions }))
        } catch (e) {
          newLayers.push(errorLayer('position', 'Position Risk', 'Your health factor, collateral ratio, and vault positions', String(e)))
        }
      }

      // ── Layer 5: Network Risk ───────────────────────────────────────────
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

  // Initial load + wallet change
  useEffect(() => { fetchAll() }, [fetchAll])

  // Auto-refresh
  useEffect(() => {
    const id = setInterval(fetchAll, REFRESH_MS)
    return () => clearInterval(id)
  }, [fetchAll])

  // Countdown ticker
  useEffect(() => {
    const id = setInterval(
      () => setCountdown(c => (c <= 1 ? REFRESH_MS / 1000 : c - 1)),
      1000
    )
    return () => clearInterval(id)
  }, [])

  function handleWalletChange(w: string) {
    setWallet(w)
  }

  const showSkeleton = layers.length === 0

  return (
    <div className="min-h-screen bg-slate-950">
      {/* ── Header ── */}
      <header className="sticky top-0 z-10 border-b border-slate-800/80 bg-slate-950/90 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          {/* Logo */}
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="w-7 h-7 rounded-lg bg-violet-500/20 border border-violet-500/30 flex items-center justify-center">
              <span className="text-violet-400 text-xs font-bold">K</span>
            </div>
            <div>
              <span className="font-semibold text-slate-100 text-sm">KaminoPulse</span>
              <span className="ml-2 text-xs text-slate-600 hidden sm:inline">Protocol Risk Monitor</span>
            </div>
          </div>

          {/* Wallet input */}
          <div className="flex-1 max-w-sm">
            <WalletInput wallet={wallet} onChange={handleWalletChange} />
          </div>
        </div>
      </header>

      {/* ── Main ── */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-5">

        {/* Overall score */}
        <OverallScore
          tier={overall}
          lastUpdated={lastUpdated}
          onRefresh={fetchAll}
          loading={loading}
          countdown={countdown}
        />

        {/* No wallet banner */}
        {!wallet && (
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-5 py-4 text-sm text-slate-500 flex items-center gap-3">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-500 flex-shrink-0" />
            Paste a wallet address above to also monitor your personal position health and liquidation risk.
          </div>
        )}

        {/* Risk cards grid */}
        {showSkeleton ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {['Protocol Health', 'Oracle Risk', 'Asset Risk', 'Network Risk'].map(name => (
              <div key={name} className="bg-slate-900 border border-slate-800 rounded-xl p-5 animate-pulse">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-2 h-2 rounded-full bg-slate-700" />
                  <div className="h-3.5 bg-slate-800 rounded w-32" />
                </div>
                <div className="space-y-3">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="flex justify-between gap-4">
                      <div className="h-3 bg-slate-800 rounded w-24" />
                      <div className="h-3 bg-slate-800 rounded w-16" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {layers.map(layer => (
              <RiskCard key={layer.id} layer={layer} />
            ))}
          </div>
        )}

        {/* Footer */}
        <footer className="border-t border-slate-800/60 pt-5 text-center">
          <p className="text-xs text-slate-700">
            Data from{' '}
            <span className="text-slate-600">Kamino Finance · DeFiLlama · Pyth Network · Jupiter · Helius</span>
          </p>
          <p className="text-xs text-slate-800 mt-1">
            Read-only · no wallet connection required · not financial advice
          </p>
        </footer>
      </main>
    </div>
  )
}
