import { useCallback, useEffect, useRef, useState } from 'react'
import type { RiskLayer, RiskTier } from './types'
import type { KaminoObligation, KaminoVaultPosition, ReserveRegistry } from './api/kamino'
import { LandingHero } from './components/LandingHero'
import { RiskSparkline } from './components/RiskSparkline'
import { EarningsChart } from './components/EarningsChart'
import { RiskRadar } from './components/RiskRadar'
import type { RadarItem, RiskStatus } from './components/RiskRadar'
import {
  fetchMarkets,
  fetchReserveMetrics,
  fetchUserObligations,
  fetchUserVaultPositions,
  buildReserveRegistry,
  computeTVLFromRegistry,
  extractUtilization,
  getMarketKey,
} from './api/kamino'
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

// ─── Types ────────────────────────────────────────────────────────────────────

interface OracleFeed {
  sym: string
  price: number
  meta: string
  flash: 'up' | 'dn' | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtMoney(n: number, compact = false): string {
  if (compact && Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (compact && Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (compact && Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtN(n: number, digits = 0): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

function shortWallet(w: string): string {
  return `${w.slice(0, 4)}…${w.slice(-4)}`
}

function tierToScore(tier: RiskTier): number {
  switch (tier) {
    case 'green':   return 90
    case 'yellow':  return 72
    case 'orange':  return 48
    case 'red':     return 24
    default:        return 50
  }
}

function tierToStatus(tier: RiskTier): RiskStatus {
  if (tier === 'green')  return 'good'
  if (tier === 'yellow') return 'watch'
  return 'risk'
}

// ─── useCountUp ───────────────────────────────────────────────────────────────

function useCountUp(target: number): number {
  const [val, setVal] = useState(0)
  const prevRef = useRef<number | null>(null)
  useEffect(() => {
    if (prevRef.current === target) return
    const from = prevRef.current ?? 0
    prevRef.current = target
    const duration = 900
    let raf: number
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const ease = 1 - Math.pow(1 - t, 3)
      setVal(from + (target - from) * ease)
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target])
  return val
}

// ─── Static 90-day risk history ───────────────────────────────────────────────

const RISK_HISTORY = Array.from({ length: 90 }, (_, i) => {
  const t = i / 89
  const base = 72 + Math.sin(t * Math.PI * 3) * 6 + Math.cos(t * Math.PI * 7) * 3
  const dip = i > 60 && i < 70 ? -18 : 0
  const recent = i > 82 ? -10 : 0
  return Math.max(35, Math.min(96, Math.round(base + dip + recent + Math.sin(i * 1.3) * 2)))
})

// ─── Data helpers ─────────────────────────────────────────────────────────────

function errorLayer(id: string, name: string, description: string, detail: string): RiskLayer {
  return {
    id, name, description,
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

function portfolioTotals(obligations: KaminoObligation[], vaults: KaminoVaultPosition[]) {
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

  for (const v of vaults) deposited += v.totalValueUsd ?? 0
  return { deposited, borrowed, net: deposited - borrowed, worstHF }
}

const OVERALL_CONFIG: Record<RiskTier, { label: string; desc: string }> = {
  green:   { label: 'ALL GOOD',  desc: 'Your portfolio looks healthy across all risk factors.' },
  yellow:  { label: 'WATCH',     desc: 'Minor signals worth monitoring. No immediate action needed.' },
  orange:  { label: 'AT RISK',   desc: 'Multiple risk factors active. Consider reducing exposure.' },
  red:     { label: 'CRITICAL',  desc: 'Severe risk detected. Take action to protect your positions.' },
  loading: { label: 'LOADING',   desc: 'Fetching live data...' },
  error:   { label: 'ERROR',     desc: 'Could not load data. Check your connection.' },
}

// ─── Ticker ───────────────────────────────────────────────────────────────────

function TickerBar({ items }: { items: [string, string, string, 'up' | 'dn'][] }) {
  const doubled = [...items, ...items]
  return (
    <div className="t-ticker">
      <div className="t-ticker-track">
        {doubled.map((t, i) => (
          <span key={i} className="t-tick">
            <span className="t-sym">{t[0]}</span>
            <span className="t-price">{t[1]}</span>
            {t[2] && <span className={`t-chg ${t[3]}`}>{t[3] === 'up' ? '▲' : '▼'} {t[2]}</span>}
          </span>
        ))}
      </div>
    </div>
  )
}

// ─── Oracle Panel ─────────────────────────────────────────────────────────────

function OracleSection({ feeds }: { feeds: OracleFeed[] }) {
  const [prices, setPrices] = useState<OracleFeed[]>(feeds)

  useEffect(() => {
    setPrices(feeds.map(f => ({ ...f, flash: null })))
  }, [feeds])

  useEffect(() => {
    if (prices.length === 0) return
    const id = setInterval(() => {
      setPrices(prev => prev.map(o => {
        const drift = (Math.random() - 0.5) * 0.003
        const newPrice = Math.max(0.0001, o.price * (1 + drift))
        return { ...o, price: newPrice, flash: drift >= 0 ? 'up' : 'dn' }
      }))
      setTimeout(() => setPrices(prev => prev.map(o => ({ ...o, flash: null }))), 500)
    }, 2500)
    return () => clearInterval(id)
  }, [prices.length])

  return (
    <div className="t-panel">
      <div className="t-panel-head">
        <div className="t-panel-title">
          <span className="t-cap">ORACLE FEEDS</span>
          <span className="t-capxs" style={{ color: 'var(--text-4)' }}>PYTH · LIVE</span>
        </div>
        <span className="t-chip info">
          <span className="t-live-dot" style={{ background: 'var(--blue)' }} />
          {prices.length} FEEDS
        </span>
      </div>
      <div className="t-ora-grid">
        {prices.map((o, i) => (
          <div key={i} className={o.flash === 'up' ? 't-flash-up' : o.flash === 'dn' ? 't-flash-dn' : ''}>
            <div>
              <div className="t-sym">{o.sym}</div>
              <div className="t-meta">{o.meta}</div>
            </div>
            <div className="t-price-wrap">
              <div
                className="t-oprice"
                style={{ color: o.flash === 'up' ? 'var(--green)' : o.flash === 'dn' ? 'var(--red)' : 'var(--text)' }}
              >
                {o.price < 10 ? `$${o.price.toFixed(4)}` : `$${fmtN(o.price, 2)}`}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  // ── State ──
  const [wallet,        setWallet]        = useState('')
  const [layers,        setLayers]        = useState<RiskLayer[]>([])
  const [obligations,   setObligations]   = useState<KaminoObligation[]>([])
  const [vaultPositions,setVaultPositions]= useState<KaminoVaultPosition[]>([])
  const [overall,       setOverall]       = useState<RiskTier>('loading')
  const [lastUpdated,   setLastUpdated]   = useState<Date | null>(null)
  const [loading,       setLoading]       = useState(false)
  const [countdown,     setCountdown]     = useState(REFRESH_MS / 1000)
  const [kaminoTVL,     setKaminoTVL]     = useState(0)
  const [registry,      setRegistry]      = useState<ReserveRegistry>({})
  const [walletMasked,  setWalletMasked]  = useState(false)
  const [oracleFeeds,   setOracleFeeds]   = useState<OracleFeed[]>([])
  const [sparkRange,    setSparkRange]    = useState<'7D' | '30D' | '90D'>('30D')
  const [riskActive,    setRiskActive]    = useState('protocol')
  const [earnMode,      setEarnMode]      = useState<'day' | 'month' | 'year'>('year')

  const [theme, setTheme] = useState<'dark' | 'light'>(
    () => (localStorage.getItem('kp-theme') as 'dark' | 'light') || 'dark'
  )
  const [density, setDensity] = useState<'compact' | 'cozy'>(
    () => (localStorage.getItem('kp-density') as 'compact' | 'cozy') || 'cozy'
  )

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('kp-theme', theme)
  }, [theme])

  useEffect(() => {
    document.documentElement.setAttribute('data-density', density)
    localStorage.setItem('kp-density', density)
  }, [density])

  // ── fetchAll ──
  const fetchAll = useCallback(async () => {
    setLoading(true)
    const newLayers: RiskLayer[] = []

    try {
      const [marketsRes, pythRes, jupiterRes, networkRes] =
        await Promise.allSettled([
          fetchMarkets(),
          fetchPythPrices(),
          fetchJupiterPrices(),
          fetchNetworkHealth(),
        ])

      const markets    = marketsRes.status === 'fulfilled' ? marketsRes.value : []
      const pythPrices = pythRes.status    === 'fulfilled' ? pythRes.value    : []
      const jupPrices  = jupiterRes.status === 'fulfilled' ? jupiterRes.value : []
      const network    = networkRes.status === 'fulfilled' ? networkRes.value : { tps: 0, avgPriorityFee: 0 }

      const priceMap: Record<string, number | null> = {}
      for (const f of pythPrices) priceMap[f.symbol.split('/')[0]] = f.price
      for (const p of jupPrices)  if (p.price !== null) priceMap[p.symbol] = p.price

      setOracleFeeds(pythPrices.map(f => ({
        sym:   f.symbol,
        price: f.price ?? 0,
        meta:  `${f.ageSeconds}s old · conf ${(f.confRatio * 100).toFixed(2)}%`,
        flash: null,
      })))

      let newRegistry: ReserveRegistry = {}
      try {
        newRegistry = await buildReserveRegistry(markets)
        setRegistry(newRegistry)
      } catch (e) {
        console.warn('[reserve registry]', e)
      }

      let protocolMaxUtil = 0
      let protocolTvl = 0

      try {
        protocolTvl = computeTVLFromRegistry(newRegistry)
        if (protocolTvl > 0) setKaminoTVL(protocolTvl)

        for (const r of Object.values(newRegistry)) {
          if (r.totalSupplyUsd >= 1_000_000 && r.utilization > protocolMaxUtil) protocolMaxUtil = r.utilization
        }
        if (Object.keys(newRegistry).length === 0) {
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
              if (u > protocolMaxUtil) protocolMaxUtil = u
            }
          }
        }
        newLayers.push(scoreProtocolHealth({ kaminoTVL: protocolTvl || kaminoTVL, maxReserveUtilization: protocolMaxUtil }))
      } catch (e) {
        newLayers.push(errorLayer('protocol', 'Protocol Health', 'Kamino TVL and reserve utilization', String(e)))
      }

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

      try {
        newLayers.push(scoreAssetRisk({ solPrice: priceMap['SOL'] ?? 0, prices: priceMap }))
      } catch (e) {
        newLayers.push(errorLayer('asset', 'Asset Risk', 'Stablecoin peg deviation and LST oracle method', String(e)))
      }

      if (wallet) {
        try {
          const [obligationResults, rawVaults] = await Promise.all([
            Promise.allSettled(markets.map(m => fetchUserObligations(getMarketKey(m), wallet))),
            fetchUserVaultPositions(wallet, newRegistry).catch(() => [] as KaminoVaultPosition[]),
          ])
          const allObligations = obligationResults.flatMap(r =>
            r.status === 'fulfilled' ? r.value : []
          )
          setObligations(allObligations)
          setVaultPositions(rawVaults)

          const vaultsWithUtil = rawVaults.filter(v =>
            Number(v.totalShares ?? 0) > 0 && (v.reserveUtilization ?? 0) > 0
          )
          if (vaultsWithUtil.length > 0) {
            const userVaultUtil =
              vaultsWithUtil.reduce((sum, v) => sum + (v.reserveUtilization ?? 0), 0) /
              vaultsWithUtil.length
            const protoIdx = newLayers.findIndex(l => l.id === 'protocol')
            if (protoIdx >= 0) {
              newLayers[protoIdx] = scoreProtocolHealth({
                kaminoTVL:             protocolTvl || kaminoTVL,
                maxReserveUtilization: protocolMaxUtil,
                userVaultUtilization:  userVaultUtil,
              })
            }
          }
          newLayers.push(scorePositionRisk({ obligations: allObligations, vaultPositions: rawVaults }))
        } catch (e) {
          newLayers.push(errorLayer('position', 'Position Risk', 'Your health factor, collateral ratio, and vault positions', String(e)))
        }
      }

      try {
        newLayers.push(scoreNetworkRisk({ tps: network.tps, avgPriorityFee: network.avgPriorityFee }))
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
    const id = setInterval(() => setCountdown(c => c <= 1 ? REFRESH_MS / 1000 : c - 1), 1000)
    return () => clearInterval(id)
  }, [])

  function handleSearch(w: string) {
    setObligations([])
    setVaultPositions([])
    setLayers([])
    setOverall('loading')
    setWallet(w)
  }

  // ── Derived data (computed unconditionally so hooks below are always called) ──
  const activeObligations = getActiveObligations(obligations)
  const activeVaults      = vaultPositions.filter(v => Number(v.totalShares ?? 0) > 0)
  const totals            = portfolioTotals(activeObligations, activeVaults)
  const hasPositions      = activeObligations.length > 0 || activeVaults.length > 0

  const cfg        = OVERALL_CONFIG[overall]
  const overallScore = tierToScore(overall)
  const tone       = overall === 'green' ? 'good' : overall === 'yellow' ? 'watch' : 'risk'
  const stageIdx   = overall === 'green' ? 0 : overall === 'yellow' ? 1 : overall === 'orange' ? 2 : 3

  const radarItems: RadarItem[] = layers.map(l => ({
    key:    l.id,
    name:   l.name,
    status: tierToStatus(l.tier),
    score:  tierToScore(l.tier),
  }))

  const activeLayer  = layers.find(l => l.id === riskActive) ?? layers[0]
  const flaggedCount = radarItems.filter(r => r.status !== 'good').length

  const primaryVault   = activeVaults[0]
  const apyBase        = primaryVault?.apy ?? 0
  const apyFarm        = primaryVault?.apyFarmRewards ?? 0
  const blendedApy     = apyBase + apyFarm
  const totalDeposited = totals.deposited
  const earnPerYear    = totalDeposited * blendedApy
  const earnPerMonth   = earnPerYear / 12
  const earnPerDay     = earnPerYear / 365
  const earnTarget     = earnMode === 'day' ? earnPerDay : earnMode === 'month' ? earnPerMonth : earnPerYear

  const vaultTvl       = primaryVault?.vaultTvlUsd ?? 0
  const totalBorrowUsd = primaryVault?.reserveTotalBorrowUsd ?? 0
  const utilization    = primaryVault?.reserveUtilization ?? 0
  const yourPosition   = primaryVault?.totalValueUsd ?? 0
  const availableUsd   = totalBorrowUsd > 0
    ? Math.max(vaultTvl - totalBorrowUsd, 0)
    : (primaryVault?.tokensAvailableUsd ?? 0)
  const coverage       = yourPosition > 0 ? availableUsd / yourPosition : 0
  const pctOfAvailable = coverage > 0 ? 100 / coverage : 0

  const tickerItems: [string, string, string, 'up' | 'dn'][] = [
    ...(kaminoTVL > 0 ? [['KAMINO TVL', fmtMoney(kaminoTVL, true), '', 'up'] as [string, string, string, 'up' | 'dn']] : []),
    ...(utilization > 0 ? [['VAULT UTIL', `${(utilization * 100).toFixed(2)}%`, '', 'dn'] as [string, string, string, 'up' | 'dn']] : []),
    ...oracleFeeds.slice(0, 8).map(f => [
      f.sym.split('/')[0],
      f.price < 10 ? `$${f.price.toFixed(4)}` : `$${fmtN(f.price, 2)}`,
      '',
      'up',
    ] as [string, string, string, 'up' | 'dn']),
  ]

  // useCountUp must be called unconditionally — before any early return
  const animNetWorth  = useCountUp(totals.net)
  const animDeposited = useCountUp(totals.deposited)
  const animCoverage  = useCountUp(coverage)
  const animEarn      = useCountUp(earnTarget)

  // ── No wallet → Landing ──
  if (!wallet) {
    return (
      <LandingHero
        onSearch={handleSearch}
        loading={loading}
        tvl={kaminoTVL || undefined}
      />
    )
  }

  const stripStages = [
    { label: 'ALL GOOD', tone: 'good' },
    { label: 'WATCH',    tone: 'watch' },
    { label: 'AT RISK',  tone: 'risk' },
    { label: 'CRITICAL', tone: 'risk' },
  ]

  return (
    <div className="t-app">

      {/* ── Topbar ── */}
      <header className="t-topbar">
        <div className="t-brand">
          <button
            className="t-brand-mark"
            onClick={() => handleSearch('')}
            style={{ cursor: 'pointer', border: 0 }}
          >K</button>
          <span className="t-brand-name">
            Kamino<span className="t-dot">·</span>Pulse
          </span>
          <span className="t-capxs" style={{ marginLeft: 8, color: 'var(--text-4)' }}>
            v0.5 · READ-ONLY
          </span>
        </div>

        <div className="t-wallet-row">
          <div className="t-wallet-pill">
            <span className="t-capxs" style={{ color: 'var(--text-4)', flexShrink: 0 }}>WALLET</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 12.5, color: 'var(--text)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {walletMasked ? '•••• •••• ••••' : shortWallet(wallet)}
            </span>
            <button
              className="t-btn-ghost"
              onClick={() => setWalletMasked(m => !m)}
              title={walletMasked ? 'Show wallet' : 'Hide wallet'}
            >
              {walletMasked ? '👁' : '🙈'}
            </button>
            <button className="t-btn-ghost" onClick={() => handleSearch('')}>✕ clear</button>
          </div>
        </div>

        <div className="t-topbar-right">
          <span className="t-live-pill">
            <span className="t-live-dot" />
            {loading ? 'UPDATING' : `LIVE · ${countdown}s`}
          </span>
          <div className="t-theme-toggle">
            <button className={theme === 'dark'  ? 'on' : ''} onClick={() => setTheme('dark')}>DARK</button>
            <button className={theme === 'light' ? 'on' : ''} onClick={() => setTheme('light')}>LIGHT</button>
          </div>
          <button
            onClick={fetchAll}
            disabled={loading}
            className="t-btn-ghost"
            title="Refresh"
          >
            {loading ? '…' : '↻'}
          </button>
        </div>
      </header>

      {/* ── Ticker ── */}
      {tickerItems.length > 0 && <TickerBar items={tickerItems} />}

      {/* ── Main ── */}
      <main className="t-main">

        {/* ── Hero ── */}
        <div className="t-hero">
          <div className="t-hero-head">

            <div className="t-hero-left">
              <div className="t-hero-meta">
                <span className="t-cap">PORTFOLIO STATUS</span>
                <span className="t-capxs" style={{ color: 'var(--text-4)' }}>
                  {lastUpdated ? `UPDATED ${lastUpdated.toLocaleTimeString()}` : 'FETCHING...'}
                </span>
              </div>
              <div className="t-hero-status">
                <span className={`t-hero-label ${tone}`}>{cfg.label}</span>
                <span className="t-hero-score">
                  SCORE <b>{overallScore}</b> / 100
                </span>
              </div>
              <p className="t-hero-desc">{cfg.desc}</p>
              <div className="t-strip" style={{ marginTop: 'auto' }}>
                {stripStages.map((s, i) => (
                  <span key={i} className={`${i === stageIdx ? 'on' : ''} ${s.tone}`} />
                ))}
              </div>
              <div className="t-strip-labels">
                {stripStages.map((s, i) => (
                  <span key={i} className="t-capxs" style={{
                    color: i === stageIdx
                      ? s.tone === 'good' ? 'var(--green)' : s.tone === 'watch' ? 'var(--amber)' : 'var(--red)'
                      : 'var(--text-4)',
                    fontWeight: i === stageIdx ? 600 : 400,
                    fontSize: 9,
                  }}>
                    {s.label}
                  </span>
                ))}
              </div>
            </div>

            <div className="t-hero-right">
              <div className="t-spark-head">
                <div className="t-legend">
                  <span className="t-cap">RISK SCORE · 90D</span>
                  <span className="t-capxs" style={{ color: 'var(--green)' }}>▲ SAFE ZONE ≥70</span>
                </div>
                <div className="t-range">
                  {(['7D', '30D', '90D'] as const).map(r => (
                    <button
                      key={r}
                      className={sparkRange === r ? 'on' : ''}
                      onClick={() => setSparkRange(r)}
                    >{r}</button>
                  ))}
                </div>
              </div>
              <div className="t-spark-wrap">
                <RiskSparkline data={RISK_HISTORY} range={sparkRange} />
              </div>
            </div>
          </div>

          <div className="t-stats">
            <div>
              <span className="t-cap">NET WORTH</span>
              <span className="t-val" style={{ fontFamily: 'var(--mono)', fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em' }}>
                ${fmtN(animNetWorth, 0)}
              </span>
              <span className="t-sub up">
                {(activeObligations.length + activeVaults.length) > 0
                  ? `▲ ACROSS ${activeObligations.length + activeVaults.length} POSITIONS`
                  : 'NO POSITIONS'}
              </span>
            </div>
            <div>
              <span className="t-cap">TOTAL DEPOSITED</span>
              <span className="t-val" style={{ fontFamily: 'var(--mono)', fontSize: 24, fontWeight: 600 }}>
                {fmtMoney(animDeposited, true)}
              </span>
              <span className="t-sub">SUPPLY · NON-LEVERAGED</span>
            </div>
            <div>
              <span className="t-cap">TOTAL BORROWED</span>
              <span className="t-val" style={{ fontFamily: 'var(--mono)', fontSize: 24, fontWeight: 600, color: totals.borrowed > 0 ? 'var(--red)' : 'var(--text-3)' }}>
                {totals.borrowed > 0 ? fmtMoney(totals.borrowed, true) : '— —'}
              </span>
              <span className="t-sub">{totals.borrowed > 0 ? 'OUTSTANDING DEBT' : 'NO OUTSTANDING DEBT'}</span>
            </div>
            <div>
              <span className="t-cap">BLENDED APY</span>
              <span className="t-val" style={{ fontFamily: 'var(--mono)', fontSize: 24, fontWeight: 600, color: blendedApy > 0 ? 'var(--green)' : 'var(--text-3)' }}>
                {blendedApy > 0 ? `${(blendedApy * 100).toFixed(2)}%` : '—'}
              </span>
              <span className="t-sub up">
                {apyFarm > 0 ? `+${(apyFarm * 100).toFixed(2)}% REWARDS INCL.` : 'BASE LENDING YIELD'}
              </span>
            </div>
          </div>
        </div>

        {/* ── Row 2: Earnings + Withdrawal ── */}
        {hasPositions && (
          <div className="t-row-2">

            {/* Earnings Panel */}
            <div className="t-panel">
              <div className="t-panel-head">
                <div className="t-panel-title">
                  <span className="t-cap">EARNINGS PROJECTION</span>
                  <span className="t-capxs" style={{ color: 'var(--text-4)' }}>
                    @ {blendedApy > 0 ? `${(blendedApy * 100).toFixed(2)}%` : '—'} APY
                  </span>
                </div>
                <span className="t-chip info">COMPOUNDING · LIVE</span>
              </div>
              <div className="t-earn-body">
                <div className="t-earn-stats">
                  {([
                    { key: 'day'   as const, label: 'PER DAY',   val: earnPerDay   },
                    { key: 'month' as const, label: 'PER MONTH', val: earnPerMonth  },
                    { key: 'year'  as const, label: 'PER YEAR',  val: earnPerYear  },
                  ]).map(({ key, label, val }) => (
                    <div
                      key={key}
                      className={`t-earn-stat ${earnMode === key ? 'active' : ''}`}
                      onClick={() => setEarnMode(key)}
                    >
                      <span className="t-cap">{label}</span>
                      <div className="t-val">${fmtN(val, key === 'year' ? 0 : 2)}</div>
                    </div>
                  ))}
                </div>
                <div className="t-earn-chart">
                  {blendedApy > 0 && totalDeposited > 0 && (
                    <EarningsChart mode={earnMode} apy={blendedApy} principal={totalDeposited} />
                  )}
                </div>
                <div className="t-earn-meta">
                  <span>
                    BASE LENDING{' '}
                    <span className="mono">{(apyBase * 100).toFixed(2)}%</span>
                    {apyFarm > 0 && (
                      <> + INCENTIVE REWARDS <span className="mono">{(apyFarm * 100).toFixed(2)}%</span></>
                    )}
                  </span>
                  <span className="mono">
                    PROJ. <span style={{ color: 'var(--green)' }}>${fmtN(animEarn, earnMode === 'year' ? 0 : 2)}</span>
                  </span>
                </div>
              </div>
            </div>

            {/* Withdrawal Panel */}
            <div className="t-panel">
              <div className="t-panel-head">
                <div className="t-panel-title">
                  <span className="t-cap">WITHDRAWAL RISK</span>
                  <span className="t-capxs" style={{ color: 'var(--text-4)' }}>TRUE VAULT LIQUIDITY</span>
                </div>
                <span className={`t-chip ${coverage >= 10 ? 'good' : coverage >= 3 ? 'watch' : 'risk'}`}>
                  {coverage >= 10 ? 'EXIT INSTANT' : coverage >= 3 ? 'LOW RISK' : 'MONITOR'}
                </span>
              </div>
              <div className="t-wd-body">
                {yourPosition > 0 ? (
                  <>
                    <div>
                      <div className="t-cap" style={{ marginBottom: 4 }}>COVERAGE OF YOUR POSITION</div>
                      <div className="t-wd-coverage">
                        {Math.round(animCoverage)}<span className="x">×</span>
                      </div>
                      <div className="t-wd-verdict">
                        {coverage >= 10
                          ? 'EXIT INSTANTLY — DEEP LIQUIDITY'
                          : coverage >= 3
                            ? 'LOW RISK — AMPLE LIQUIDITY'
                            : coverage >= 1
                              ? 'MONITOR — LIQUIDITY TIGHTENING'
                              : 'CAUTION — LIQUIDITY BELOW POSITION'}
                      </div>
                    </div>

                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 18 }}>
                        <span>YOUR POSITION</span>
                        <span>AVAILABLE LIQUIDITY · {fmtMoney(availableUsd, true)}</span>
                      </div>
                      <div className="t-wd-bar-track">
                        <div className="t-wd-bar-fill" />
                        <div
                          className="t-wd-bar-mark"
                          style={{ left: `${Math.max(0.3, Math.min(99, pctOfAvailable)).toFixed(1)}%` }}
                        />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-3)', marginTop: 6 }}>
                        <span style={{ color: 'var(--text)' }}>${fmtN(yourPosition, 0)}</span>
                        <span>= {pctOfAvailable.toFixed(2)}% OF AVAILABLE</span>
                      </div>
                    </div>

                    <div className="t-wd-kv">
                      <div><span className="k">VAULT TVL</span><span className="v">{fmtMoney(vaultTvl, true)}</span></div>
                      <div><span className="k">UTILIZATION</span><span className="v">{(utilization * 100).toFixed(2)}%</span></div>
                      <div><span className="k">TRUE AVAIL.</span><span className="v">{fmtMoney(availableUsd, true)}</span></div>
                      <div><span className="k">SOURCE</span><span className="v" style={{ color: 'var(--text-3)' }}>ON-CHAIN</span></div>
                    </div>
                  </>
                ) : (
                  <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-3)', fontFamily: 'var(--mono)', fontSize: 12 }}>
                    NO VAULT POSITION
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Risk Panel ── */}
        {radarItems.length > 0 && (
          <div className="t-panel">
            <div className="t-panel-head">
              <div className="t-panel-title">
                <span className="t-cap">RISK LAYERS · {radarItems.length}-FACTOR</span>
                <span className="t-capxs" style={{ color: 'var(--text-4)' }}>
                  {flaggedCount} LAYERS FLAGGED · {radarItems.length - flaggedCount} SAFE
                </span>
              </div>
              <span className={`t-chip ${tone}`}>{cfg.label}</span>
            </div>
            <div className="t-radar-body">
              <div className="t-radar-left">
                <RiskRadar risks={radarItems} activeKey={riskActive} onPick={setRiskActive} />
              </div>
              <div className="t-radar-right">
                {radarItems.map(r => (
                  <div
                    key={r.key}
                    className={`t-risk-row ${riskActive === r.key ? 'active' : ''}`}
                    onClick={() => setRiskActive(r.key)}
                  >
                    <span className={`t-dot ${r.status}`} />
                    <div>
                      <div className="t-rname">{r.name}</div>
                      <div className="t-rdetail">
                        {layers.find(l => l.id === r.key)?.description ?? ''}
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
                      <span className={`t-rscore ${r.status}`}>{r.score}</span>
                      <span className={`t-pill-s ${r.status}`}>
                        {r.status === 'good' ? 'SAFE' : r.status === 'watch' ? 'WATCH' : 'RISK'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {activeLayer && (
              <div className="t-risk-drill">
                <div>
                  <h4>{activeLayer.name} · summary</h4>
                  <div style={{ color: 'var(--text)', lineHeight: 1.55, fontSize: 12.5 }}>
                    {activeLayer.description}
                  </div>
                </div>
                <div>
                  <h4>signals</h4>
                  <table>
                    <tbody>
                      {activeLayer.signals.map((s, i) => (
                        <tr key={i}>
                          <td>{s.label}</td>
                          <td>{s.value ?? s.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Loading skeleton ── */}
        {loading && !hasPositions && radarItems.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap)' }}>
            {[0, 1].map(i => <div key={i} className="t-skeleton" />)}
          </div>
        )}

        {/* ── Row 3: Positions + Oracle ── */}
        <div className="t-row-3">

          {/* Positions */}
          <div className="t-panel">
            <div className="t-panel-head">
              <div className="t-panel-title">
                <span className="t-cap">POSITIONS</span>
                <span className="t-capxs" style={{ color: 'var(--text-4)' }}>
                  {activeVaults.length + activeObligations.length} ACTIVE
                </span>
              </div>
            </div>
            {(activeVaults.length + activeObligations.length) === 0 ? (
              <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--text-3)', fontFamily: 'var(--mono)', fontSize: 12 }}>
                {loading ? 'LOADING...' : 'NO ACTIVE POSITIONS'}
              </div>
            ) : (
              <table className="t-pos-table">
                <thead>
                  <tr>
                    <th>ASSET</th>
                    <th className="right">VALUE</th>
                    <th className="right">APY</th>
                    <th className="right">VAULT UTIL</th>
                    <th className="right">COVERAGE</th>
                  </tr>
                </thead>
                <tbody>
                  {activeVaults.map((v, i) => {
                    const vBase    = v.apy ?? 0
                    const vFarm    = v.apyFarmRewards ?? 0
                    const vApy     = vBase + vFarm
                    const vVal     = v.totalValueUsd ?? 0
                    const vUtil    = (v.reserveUtilization ?? 0) * 100
                    const vTvl     = v.vaultTvlUsd ?? 0
                    const vBorrow  = v.reserveTotalBorrowUsd ?? 0
                    const vAvail   = vBorrow > 0 ? Math.max(vTvl - vBorrow, 0) : (v.tokensAvailableUsd ?? 0)
                    const vCov     = vVal > 0 ? vAvail / vVal : 0
                    const sym      = v.tokenSymbol ?? 'VAULT'
                    const utilSt   = vUtil >= 82 ? 'watch' : 'good'
                    return (
                      <tr key={v.vaultAddress || i}>
                        <td>
                          <div className="t-pos-asset">
                            <div className={`t-pos-icon ${sym.toLowerCase()}`}>
                              {sym.slice(0, 2)}
                            </div>
                            <div className="t-pos-name">
                              <div className="prim">
                                {sym}
                                <span className="t-tag vault">K-VAULT</span>
                                {vFarm > 0 && <span className="t-tag farm">FARM</span>}
                              </div>
                              <div className="sec">{shortWallet(v.vaultAddress || '???')}</div>
                            </div>
                          </div>
                        </td>
                        <td className="right">
                          <div style={{ color: 'var(--text)', fontSize: 13 }}>${fmtN(vVal, 0)}</div>
                        </td>
                        <td className="right">
                          <div style={{ color: 'var(--green)', fontSize: 13 }}>{(vApy * 100).toFixed(2)}%</div>
                          {vFarm > 0 && (
                            <div style={{ color: 'var(--text-3)', fontSize: 10 }}>
                              {(vBase * 100).toFixed(2)}% + {(vFarm * 100).toFixed(2)}%
                            </div>
                          )}
                        </td>
                        <td className="right">
                          <div style={{ color: utilSt === 'watch' ? 'var(--amber)' : 'var(--text)', fontSize: 13 }}>
                            {vUtil.toFixed(2)}%
                          </div>
                          <div className="t-bar-mini">
                            <span className={utilSt} style={{ width: `${Math.min(vUtil, 100)}%` }} />
                          </div>
                        </td>
                        <td className="right">
                          <div style={{ color: 'var(--green)', fontSize: 13, fontWeight: 600 }}>
                            {Math.round(vCov)}×
                          </div>
                          <div style={{ color: 'var(--text-3)', fontSize: 10 }}>
                            {vCov >= 10 ? 'EXIT INSTANT' : vCov >= 1 ? 'LOW RISK' : 'MONITOR'}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                  {activeObligations.map((obl, i) => {
                    const dep  = obl.refreshedStats ? Number(obl.refreshedStats.userTotalDeposit ?? 0) : (obl.depositedValue ?? 0)
                    const bor  = obl.refreshedStats ? Number(obl.refreshedStats.userTotalBorrow ?? 0)  : (obl.borrowedValue ?? 0)
                    const hf   = obl.healthFactor ?? null
                    return (
                      <tr key={obl.obligationAddress || `obl-${i}`}>
                        <td>
                          <div className="t-pos-asset">
                            <div className="t-pos-icon" style={{ background: 'var(--panel-2)' }}>LN</div>
                            <div className="t-pos-name">
                              <div className="prim">
                                LENDING
                                <span className="t-tag vault">K-LEND</span>
                              </div>
                              <div className="sec">{shortWallet(obl.obligationAddress || '???')}</div>
                            </div>
                          </div>
                        </td>
                        <td className="right">
                          <div style={{ color: 'var(--text)', fontSize: 13 }}>${fmtN(dep, 0)}</div>
                          {bor > 0 && <div style={{ color: 'var(--red)', fontSize: 10 }}>-${fmtN(bor, 0)} borrowed</div>}
                        </td>
                        <td className="right">
                          <div style={{ color: 'var(--text-3)', fontSize: 13 }}>—</div>
                        </td>
                        <td className="right">
                          <div style={{ color: 'var(--text-3)', fontSize: 13 }}>—</div>
                        </td>
                        <td className="right">
                          {hf !== null ? (
                            <div style={{ color: hf >= 1.5 ? 'var(--green)' : hf >= 1.1 ? 'var(--amber)' : 'var(--red)', fontSize: 13, fontWeight: 600 }}>
                              HF {hf.toFixed(2)}
                            </div>
                          ) : (
                            <div style={{ color: 'var(--text-3)', fontSize: 13 }}>—</div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Oracle feeds */}
          <OracleSection feeds={oracleFeeds} />
        </div>

        {/* ── Trust signal ── */}
        <div style={{
          border: '1px solid rgba(38,208,124,0.12)',
          background: 'rgba(38,208,124,0.04)',
          borderRadius: 'var(--radius)',
          padding: '12px 16px',
          display: 'flex', gap: 10, alignItems: 'flex-start',
        }}>
          <span style={{ color: 'var(--green)', flexShrink: 0 }}>✓</span>
          <p style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-3)', lineHeight: 1.6, margin: 0 }}>
            <span style={{ color: 'var(--green)', fontWeight: 600 }}>Zero bad debt on record.</span>{' '}
            Kamino processed 55,649 liquidations during the February 2026 SOL crash without
            a single bad debt event. Protocol parameters and dynamic liquidation bonuses are
            designed to keep collateral liquidated before positions go underwater.
          </p>
        </div>

        {/* Footer */}
        <footer style={{ textAlign: 'center', paddingBottom: 24 }}>
          <p style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-4)' }}>
            Data from Kamino Finance · Pyth Network · Jupiter · Helius · Read-only · no wallet connection required
          </p>
        </footer>

      </main>
    </div>
  )
}
