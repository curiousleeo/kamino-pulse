import { fetchVaultTokenInfo } from './helius'

const BASE = 'https://api.kamino.finance'

// ─── Market definitions ───────────────────────────────────────────────────────

export interface KaminoMarket {
  lendingMarket?: string
  pubkey?: string
  address?: string
  name?: string
  isPrimary?: boolean
}

// Well-known markets and their position type classification
// Used to infer risk profile without per-token breakdown
export const MARKET_NAMES: Record<string, string> = {
  '7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF': 'Main Market',
  'DxXdAyU3kCjnyggvHmY5nAwg5cRbbmdyX3npfDMjjMek': 'JLP Market',
  'ByYiZxp8QrdN9qbdtaAiePN8AAr3qvTPppNJDpf5DVJ5': 'Altcoins Market',
  'H6rHXmXoCQvq8Ue81MqNh7ow5ysPa1dSozwW3PU1dDH6': 'Jito Market',
  'GVDUXFwS8uvBG35RjZv6Y8S1AkV5uASiMJ9qTUKqb5PL': 'Marinade Market',
  'BJnbcRHqvppTyGesLzWASGKnmnF1wq9jZu6ExrjT7wvF': 'Ethena Market',
  'GMqmFygF5iSm5nkckYU6tieggFcR42SyjkkhK5rswFRs': 'Bitcoin Market',
  '3EZEy7vBTJ8Q9PWxKwdLVULRdsvVLT51rpBG3gH1TSJ5': 'Jupiter Market',
  'eNLm5e5KVDX2vEcCkt75PpZ2GMfXcZES3QrFshgpVzp':  'INF/SOL Market',
  'C7h9YnjPrDvNhe2cWWDhCu4CZEB1XTTH4RzjmsHuengV': 'bSOL/SOL Market',
}

// Markets where collateral and debt are both SOL-denominated (correlated)
// → price moves don't affect LTV; only risk is borrow rate > staking yield
export const CORRELATED_MARKETS = new Set([
  'H6rHXmXoCQvq8Ue81MqNh7ow5ysPa1dSozwW3PU1dDH6', // Jito
  'GVDUXFwS8uvBG35RjZv6Y8S1AkV5uASiMJ9qTUKqb5PL', // Marinade
  'eNLm5e5KVDX2vEcCkt75PpZ2GMfXcZES3QrFshgpVzp',  // INF/SOL
  'C7h9YnjPrDvNhe2cWWDhCu4CZEB1XTTH4RzjmsHuengV', // bSOL/SOL
])

// ─── Reserve types ────────────────────────────────────────────────────────────

export interface KaminoReserve {
  reserve?: string
  mint?: string
  symbol?: string
  liquidityToken?: string
  liquidityTokenMint?: string
  utilizationRatio?: number
  borrowUtilizationRatio?: number
  borrowUtilization?: number
  utilizationPct?: number
  totalSupply?: number | string
  totalBorrow?: number | string
  totalBorrows?: number | string
  totalSupplyUsd?: number | string
  totalBorrowUsd?: number | string
  liquidityAvailableAmount?: number
  borrowApy?: number | string
  supplyApy?: number | string
  maxLtv?: number | string
}

// Enriched reserve entry in the registry — keyed by reserve pubkey
export interface ReserveInfo {
  reservePubkey: string
  symbol: string
  mint: string
  utilization: number        // 0–1
  supplyApy: number          // 0–1 (e.g. 0.045 = 4.5%)
  borrowApy: number          // 0–1
  totalSupplyUsd: number
  totalBorrowUsd: number
  maxLtv: number             // 0–1
  marketKey: string
  marketName: string
}

// Registry: reserve pubkey → ReserveInfo
export type ReserveRegistry = Record<string, ReserveInfo>

// ─── Obligation types ─────────────────────────────────────────────────────────

export interface KaminoObligationStats {
  borrowLimit?: string | number
  borrowLiquidationLimit?: string | number
  userTotalBorrow?: string | number
  userTotalBorrowBorrowFactorAdjusted?: string | number
  userTotalDeposit?: string | number
  netAccountValue?: string | number
  leverage?: string | number
  loanToValue?: string | number
  liquidationLtv?: string | number
  borrowUtilization?: string | number
}

// Per-token deposit/borrow entries — may or may not be returned by the API
export interface ObligationDeposit {
  reserveAddress?: string
  mintAddress?: string
  symbol?: string
  amount?: string | number
  amountUsd?: string | number
  marketValueUsd?: string | number
}

export interface ObligationBorrow {
  reserveAddress?: string
  mintAddress?: string
  symbol?: string
  amount?: string | number
  amountUsd?: string | number
  marketValueUsd?: string | number
  borrowedAmountUsd?: string | number
}

export interface KaminoObligation {
  obligationAddress?: string
  humanTag?: string
  refreshedStats?: KaminoObligationStats
  // Per-token breakdown (populated if returned by API)
  deposits?: ObligationDeposit[]
  borrows?: ObligationBorrow[]
  // Market context — injected by our fetch function
  marketKey?: string
  marketName?: string
  isCorrelated?: boolean   // true = LST/SOL eMode-style, price moves don't affect LTV
  // Legacy flat fields
  healthFactor?: number
  loanToValue?: number
  depositedValue?: number
  borrowedValue?: number
  netAccountValue?: number
}

// ─── Vault types ──────────────────────────────────────────────────────────────

export interface KaminoVaultPosition {
  vaultAddress?: string
  stakedShares?: string | number
  unstakedShares?: string | number
  totalShares?: string | number
  // enriched after fetching vault metrics
  totalValueUsd?: number
  sharePrice?: number
  tokenPrice?: number          // underlying token USD price — ≈1.00 = stablecoin
  tokenType?: 'stablecoin' | 'volatile' | 'unknown'
  tokenMint?: string           // underlying token mint pubkey (from on-chain)
  tokenSymbol?: string         // resolved symbol from reserve registry
  reservePubkey?: string       // associated Kamino lending reserve (from on-chain)
  tokensAvailable?: number     // tokens in vault buffer available to withdraw NOW
  tokensAvailableUsd?: number
  tokensInvested?: number      // tokens deployed into lending market
  vaultTvlUsd?: number         // vault total TVL = tokensInvestedUsd (vault-level stat)
  apy?: number                 // current base APY (0–1)
  apy7d?: number               // 7-day APY
  apy30d?: number              // 30-day APY
  apyFarmRewards?: number      // additional farm/incentive rewards APY
  numberOfHolders?: number
  // Reserve-level stats (from vault metrics API or registry) — NOT shown in VaultCard,
  // used only by the risk engine for protocol-level utilization analysis
  reserveTotalSupplyUsd?: number
  reserveTotalBorrowUsd?: number
  reserveUtilization?: number  // 0–1
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getMarketKey(market: KaminoMarket): string {
  return (market.lendingMarket || market.pubkey || market.address || '') as string
}

export function extractUtilization(r: KaminoReserve): number {
  // Try explicit ratio fields first
  const raw = r.utilizationRatio ?? r.borrowUtilizationRatio ?? r.borrowUtilization ?? r.utilizationPct
  if (raw !== undefined && raw !== null) {
    const v = Number(raw) > 1 ? Number(raw) / 100 : Number(raw)
    return Math.min(v, 1)
  }
  // Calculate from totalBorrow / totalSupply
  const supply = Number(r.totalSupply ?? r.totalSupplyUsd ?? 0)
  const borrow = Number(r.totalBorrow ?? r.totalBorrows ?? r.totalBorrowUsd ?? 0)
  if (supply > 0) return Math.min(borrow / supply, 1)
  return 0
}

// ─── API calls ────────────────────────────────────────────────────────────────

export async function fetchMarkets(): Promise<KaminoMarket[]> {
  const res = await fetch(`${BASE}/v2/kamino-market`)
  if (!res.ok) throw new Error(`Kamino markets ${res.status}`)
  const raw = await res.json()
  return Array.isArray(raw) ? raw : (raw.markets || raw.data || [])
}

export async function fetchReserveMetrics(marketPubkey: string): Promise<KaminoReserve[]> {
  const res = await fetch(`${BASE}/kamino-market/${marketPubkey}/reserves/metrics`)
  if (!res.ok) throw new Error(`Kamino reserves ${res.status}`)
  const raw = await res.json()
  return Array.isArray(raw) ? raw : (raw.reserves || raw.data || [])
}

/**
 * Builds a registry of reserve pubkey → enriched reserve info across all provided markets.
 * Used to map obligation deposit/borrow reserve pubkeys to human-readable token info.
 */
export async function buildReserveRegistry(
  markets: KaminoMarket[]
): Promise<ReserveRegistry> {
  const registry: ReserveRegistry = {}

  const results = await Promise.allSettled(
    markets.map(async (market) => {
      const marketKey = getMarketKey(market)
      if (!marketKey) return
      const marketName = market.name ?? MARKET_NAMES[marketKey] ?? marketKey.slice(0, 8)
      const reserves = await fetchReserveMetrics(marketKey)

      for (const r of reserves) {
        const pubkey = r.reserve
        if (!pubkey) continue
        const symbol = r.liquidityToken ?? r.symbol ?? 'Unknown'
        const mint   = r.liquidityTokenMint ?? r.mint ?? ''
        const supplyUsd = Number(r.totalSupplyUsd ?? 0)
        if (supplyUsd < 1_000) continue // skip dust reserves

        const utilization = extractUtilization(r)
        const supplyApy   = Number(r.supplyApy ?? 0)
        const borrowApy   = Number(r.borrowApy ?? 0)
        const maxLtv      = Number(r.maxLtv ?? 0)

        registry[pubkey] = {
          reservePubkey: pubkey,
          symbol,
          mint,
          utilization,
          supplyApy,
          borrowApy,
          totalSupplyUsd: supplyUsd,
          totalBorrowUsd: Number(r.totalBorrowUsd ?? 0),
          maxLtv,
          marketKey,
          marketName,
        }
      }
    })
  )

  // Surface any unexpected errors in dev
  for (const r of results) {
    if (r.status === 'rejected') console.warn('[reserve registry]', r.reason)
  }

  return registry
}

export async function fetchUserObligations(
  marketPubkey: string,
  wallet: string
): Promise<KaminoObligation[]> {
  const res = await fetch(`${BASE}/kamino-market/${marketPubkey}/users/${wallet}/obligations`)
  if (res.status === 404) return []
  if (!res.ok) throw new Error(`Kamino obligations ${res.status}`)
  const raw = await res.json()
  const obligations: KaminoObligation[] = Array.isArray(raw)
    ? raw
    : (raw.obligations || raw.data || [])

  // Inject market context into each obligation
  const marketName   = MARKET_NAMES[marketPubkey] ?? 'Unknown Market'
  const isCorrelated = CORRELATED_MARKETS.has(marketPubkey)
  return obligations.map(obl => ({
    ...obl,
    marketKey:    marketPubkey,
    marketName,
    isCorrelated,
  }))
}

interface VaultMetrics {
  sharePrice: number
  tokenPrice: number
  tokenType: 'stablecoin' | 'volatile' | 'unknown'
  tokensAvailable: number
  tokensAvailableUsd: number
  tokensInvested: number
  apy: number
  apy7d: number
  apy30d: number
  apyFarmRewards: number
  numberOfHolders: number
  // Reserve-level stats — populated when the vault metrics API returns them
  // (curated vaults like Sentora expose these; fallback to 0 if not present)
  totalSupplyUsd: number
  totalBorrowUsd: number
  reserveUtilization: number  // 0–1
}

interface VaultReserveStats {
  totalSupplyUsd: number
  totalBorrowUsd: number
  reserveUtilization: number
  // Bonus structural fields that may be returned by vault API
  resolvedReservePubkey?: string
  resolvedMarketPubkey?: string
  resolvedTokenMint?: string
  resolvedTokenSymbol?: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractReserveStatsFromObj(d: Record<string, any>): Partial<VaultReserveStats> {
  const supply = Number(
    d.totalSupplyUsd ?? d.totalDeposited ?? d.totalSupplied ??
    d.tvl ?? d.totalLiquidity ?? d.totalValueLocked ?? 0
  )
  const borrow = Number(
    d.totalBorrowUsd ?? d.totalBorrowed ?? d.totalBorrows ?? d.totalDebt ?? 0
  )
  let util = Number(
    d.utilizationRatio ?? d.utilizationRate ?? d.utilization ??
    d.reserveUtilization ?? d.borrowUtilization ?? d.utilizationPct ?? 0
  )
  if (util === 0 && supply > 0 && borrow > 0) util = Math.min(borrow / supply, 1)
  if (util > 1) util = util / 100
  return {
    totalSupplyUsd: supply,
    totalBorrowUsd: borrow,
    reserveUtilization: util,
    resolvedReservePubkey: d.reservePubkey ?? d.reserve ?? d.reserveAddress,
    resolvedMarketPubkey:  d.marketPubkey  ?? d.lendingMarket ?? d.market ?? d.marketAddress,
    resolvedTokenMint:     d.tokenMint     ?? d.mint ?? d.underlyingMint ?? d.underlyingTokenMint,
    resolvedTokenSymbol:   d.tokenSymbol   ?? d.symbol ?? d.tokenName ?? d.name,
  }
}

/**
 * Multi-strategy reserve stats fetch for a K-Vault:
 * 1. Call /kvaults/{addr} — may return supply/borrow directly, or a marketPubkey
 * 2. If we get a marketPubkey, call fetchReserveMetrics() and find our reserve
 * 3. reservePubkeyHint (from on-chain decode) helps us find the right reserve in step 2
 */
async function fetchVaultReserveStats(
  vaultAddress: string,
  reservePubkeyHint?: string
): Promise<VaultReserveStats> {
  const empty: VaultReserveStats = {
    totalSupplyUsd: 0, totalBorrowUsd: 0, reserveUtilization: 0,
  }

  try {
    const res = await fetch(`${BASE}/kvaults/${vaultAddress}`)
    if (res.ok) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d: Record<string, any> = await res.json()
      const extracted = extractReserveStatsFromObj(d)

      // If direct stats are present, return them
      if ((extracted.totalSupplyUsd ?? 0) > 0 || (extracted.reserveUtilization ?? 0) > 0) {
        return { totalSupplyUsd: 0, totalBorrowUsd: 0, reserveUtilization: 0, ...extracted } as VaultReserveStats
      }

      // If we got a market pubkey, fetch reserve metrics for that specific market
      const marketKey = extracted.resolvedMarketPubkey
      if (marketKey) {
        try {
          const reserves = await fetchReserveMetrics(marketKey)
          const rpk = reservePubkeyHint ?? extracted.resolvedReservePubkey
          const found = rpk
            ? reserves.find(r => r.reserve === rpk)
            : reserves.sort((a, b) => Number(b.totalSupplyUsd ?? 0) - Number(a.totalSupplyUsd ?? 0))[0]

          if (found) {
            const u = extractUtilization(found)
            return {
              totalSupplyUsd:       Number(found.totalSupplyUsd ?? 0),
              totalBorrowUsd:       Number(found.totalBorrowUsd ?? 0),
              reserveUtilization:   u,
              resolvedReservePubkey: found.reserve ?? rpk,
              resolvedMarketPubkey: marketKey,
              resolvedTokenMint:    found.liquidityTokenMint ?? extracted.resolvedTokenMint,
              resolvedTokenSymbol:  found.liquidityToken ?? found.symbol ?? extracted.resolvedTokenSymbol,
            }
          }
        } catch { /* fall through */ }
      }

      // No supply data but we may have structural info — return what we have
      return { totalSupplyUsd: 0, totalBorrowUsd: 0, reserveUtilization: 0, ...extracted } as VaultReserveStats
    }
  } catch { /* fall through */ }

  return empty
}

async function fetchVaultMetrics(vaultAddress: string): Promise<VaultMetrics> {
  const defaults: VaultMetrics = {
    sharePrice: 1, tokenPrice: 0, tokenType: 'unknown',
    tokensAvailable: 0, tokensAvailableUsd: 0, tokensInvested: 0,
    apy: 0, apy7d: 0, apy30d: 0, apyFarmRewards: 0, numberOfHolders: 0,
    totalSupplyUsd: 0, totalBorrowUsd: 0, reserveUtilization: 0,
  }
  try {
    const res = await fetch(`${BASE}/kvaults/${vaultAddress}/metrics`)
    if (!res.ok) return defaults
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d: Record<string, any> = await res.json()

    const tokenPrice = Number(d.tokenPrice ?? 0)
    const tokenType: 'stablecoin' | 'volatile' | 'unknown' =
      tokenPrice >= 0.95 && tokenPrice <= 1.05 ? 'stablecoin'
      : tokenPrice > 0 ? 'volatile'
      : 'unknown'

    // tokensInvestedUsd = total vault capital deployed to the lending reserve
    // This IS the vault's total supply in USD — confirmed from API response inspection
    const totalSupplyUsd = Number(
      d.tokensInvestedUsd ?? d.totalSupplyUsd ?? d.totalDeposited ?? d.totalSupplied ?? d.tvl ?? 0
    )
    const totalBorrowUsd = Number(
      d.totalBorrowUsd ?? d.totalBorrowed ?? d.totalBorrows ?? d.totalDebt ?? 0
    )
    // Utilization: prefer explicit ratio, fall back to borrow/supply calc
    let reserveUtilization = Number(
      d.utilizationRatio ?? d.utilizationRate ?? d.utilization ??
      d.reserveUtilization ?? d.borrowUtilization ?? 0
    )
    if (reserveUtilization === 0 && totalSupplyUsd > 0 && totalBorrowUsd > 0) {
      reserveUtilization = Math.min(totalBorrowUsd / totalSupplyUsd, 1)
    }
    if (reserveUtilization > 1) reserveUtilization = reserveUtilization / 100

    return {
      sharePrice:         Number(d.sharePrice ?? 1),
      tokenPrice,
      tokenType,
      tokensAvailable:    Number(d.tokensAvailable ?? 0),
      tokensAvailableUsd: Number(d.tokensAvailableUsd ?? 0),
      tokensInvested:     Number(d.tokensInvested ?? 0),
      apy:                Number(d.apy ?? 0),
      apy7d:              Number(d.apy7d ?? 0),
      apy30d:             Number(d.apy30d ?? 0),
      apyFarmRewards:     Number(d.apyFarmRewards ?? 0),
      numberOfHolders:    Number(d.numberOfHolders ?? 0),
      totalSupplyUsd,
      totalBorrowUsd,
      reserveUtilization,
    }
  } catch {
    return defaults
  }
}

// Well-known mint → symbol fallback for vaults in curated markets not in registry
const KNOWN_MINTS: Record<string, string> = {
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 'USDC',
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 'USDT',
  '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo': 'PYUSD',
  'USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA':  'USDS',
  'So11111111111111111111111111111111111111112':    'SOL',
  'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn': 'jitoSOL',
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So':  'mSOL',
  'bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1':  'bSOL',
}

export async function fetchUserVaultPositions(
  wallet: string,
  // Optional registry to resolve token symbols from on-chain mint pubkeys
  registry?: ReserveRegistry
): Promise<KaminoVaultPosition[]> {
  const res = await fetch(`${BASE}/kvaults/users/${wallet}/positions`)
  if (res.status === 404) return []
  if (!res.ok) throw new Error(`Kamino vault positions ${res.status}`)
  const raw = await res.json()
  const positions: KaminoVaultPosition[] = Array.isArray(raw) ? raw : (raw.positions || raw.data || [])

  const enriched = await Promise.allSettled(
    positions.map(async (pos) => {
      if (!pos.vaultAddress) return pos

      // Wave 1: metrics + on-chain token info in parallel
      const [metrics, tokenInfo] = await Promise.all([
        fetchVaultMetrics(pos.vaultAddress),
        fetchVaultTokenInfo(pos.vaultAddress),
      ])

      // Wave 2: reserve stats — pass on-chain reserve pubkey as hint so we
      // can find the exact reserve when the vault API returns a market key
      const vaultStats = await fetchVaultReserveStats(
        pos.vaultAddress,
        tokenInfo?.reservePubkey
      )

      const totalShares = Number(pos.totalShares ?? 0)

      // Resolve token symbol:
      // 1. Registry by reserve pubkey (most reliable)
      // 2. Registry by mint
      // 3. Well-known mints map (fallback for curated vaults not in registry)
      // 4. Symbol returned by vault API
      const resolvedReservePubkey = tokenInfo?.reservePubkey ?? vaultStats.resolvedReservePubkey
      const resolvedTokenMint     = tokenInfo?.tokenMint     ?? vaultStats.resolvedTokenMint
      let tokenSymbol: string | undefined
      if (resolvedReservePubkey && registry) {
        tokenSymbol = registry[resolvedReservePubkey]?.symbol
      }
      if (!tokenSymbol && resolvedTokenMint && registry) {
        tokenSymbol = Object.values(registry).find(r => r.mint === resolvedTokenMint)?.symbol
      }
      if (!tokenSymbol && resolvedTokenMint) {
        tokenSymbol = KNOWN_MINTS[resolvedTokenMint]
      }
      if (!tokenSymbol) tokenSymbol = vaultStats.resolvedTokenSymbol

      // Reserve-level stats: vault API (two-step) → metrics API → registry
      const reserveInfo = registry && resolvedReservePubkey ? registry[resolvedReservePubkey] : undefined
      const reserveTotalSupplyUsd = vaultStats.totalSupplyUsd || metrics.totalSupplyUsd || reserveInfo?.totalSupplyUsd || 0
      const reserveTotalBorrowUsd = vaultStats.totalBorrowUsd || metrics.totalBorrowUsd || reserveInfo?.totalBorrowUsd || 0
      const reserveUtilization    = vaultStats.reserveUtilization || metrics.reserveUtilization || reserveInfo?.utilization || 0

      return {
        ...pos,
        sharePrice:           metrics.sharePrice,
        totalValueUsd:        totalShares * metrics.sharePrice,
        tokenPrice:           metrics.tokenPrice,
        tokenType:            metrics.tokenType,
        tokenMint:            resolvedTokenMint,
        tokenSymbol,
        reservePubkey:        resolvedReservePubkey,
        tokensAvailable:      metrics.tokensAvailable,
        tokensAvailableUsd:   metrics.tokensAvailableUsd,
        tokensInvested:       metrics.tokensInvested,
        // vaultTvlUsd: total capital deployed by this vault into lending (vault-level stat)
        vaultTvlUsd:          metrics.totalSupplyUsd,
        apy:                  metrics.apy,
        apy7d:                metrics.apy7d,
        apy30d:               metrics.apy30d,
        apyFarmRewards:       metrics.apyFarmRewards,
        numberOfHolders:      metrics.numberOfHolders,
        reserveTotalSupplyUsd,
        reserveTotalBorrowUsd,
        reserveUtilization,
      }
    })
  )
  return enriched.map((r, i) => r.status === 'fulfilled' ? r.value : positions[i])
}

/** Compute total TVL across all reserves in the registry */
export function computeTVLFromRegistry(registry: ReserveRegistry): number {
  return Object.values(registry).reduce((sum, r) => sum + r.totalSupplyUsd, 0)
}

export { getMarketKey }
