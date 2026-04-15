const BASE = 'https://api.kamino.finance'

export interface KaminoMarket {
  lendingMarket?: string
  pubkey?: string
  address?: string
  name?: string
  isPrimary?: boolean
}

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
}

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

export interface KaminoObligation {
  obligationAddress?: string
  humanTag?: string
  refreshedStats?: KaminoObligationStats
  // Legacy flat fields (some API responses may still include these)
  healthFactor?: number
  loanToValue?: number
  depositedValue?: number
  borrowedValue?: number
  netAccountValue?: number
}

export interface KaminoVaultPosition {
  vaultAddress?: string
  stakedShares?: string | number
  unstakedShares?: string | number
  totalShares?: string | number
  // enriched after fetching vault metrics
  totalValueUsd?: number
  sharePrice?: number
}

function getMarketKey(market: KaminoMarket): string {
  return (market.lendingMarket || market.pubkey || market.address || '') as string
}

export function extractUtilization(r: KaminoReserve): number {
  // Try explicit ratio fields first
  const raw = r.utilizationRatio ?? r.borrowUtilizationRatio ?? r.borrowUtilization ?? r.utilizationPct
  if (raw !== undefined && raw !== null) {
    const v = raw > 1 ? raw / 100 : raw
    return Math.min(v, 1) // cap at 100% — tiny reserves can report >100% due to rounding
  }
  // Calculate from totalBorrow / totalSupply
  const supply = Number(r.totalSupply ?? r.totalSupplyUsd ?? 0)
  const borrow = Number(r.totalBorrow ?? r.totalBorrows ?? r.totalBorrowUsd ?? 0)
  if (supply > 0) return Math.min(borrow / supply, 1)
  return 0
}

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

export async function fetchUserObligations(
  marketPubkey: string,
  wallet: string
): Promise<KaminoObligation[]> {
  const res = await fetch(`${BASE}/kamino-market/${marketPubkey}/users/${wallet}/obligations`)
  if (res.status === 404) return []
  if (!res.ok) throw new Error(`Kamino obligations ${res.status}`)
  const raw = await res.json()
  return Array.isArray(raw) ? raw : (raw.obligations || raw.data || [])
}

async function fetchVaultSharePrice(vaultAddress: string): Promise<number> {
  try {
    const res = await fetch(`${BASE}/kvaults/${vaultAddress}/metrics`)
    if (!res.ok) return 1
    const data = await res.json()
    return Number(data.sharePrice ?? 1)
  } catch {
    return 1
  }
}

export async function fetchUserVaultPositions(wallet: string): Promise<KaminoVaultPosition[]> {
  const res = await fetch(`${BASE}/kvaults/users/${wallet}/positions`)
  if (res.status === 404) return []
  if (!res.ok) throw new Error(`Kamino vault positions ${res.status}`)
  const raw = await res.json()
  const positions: KaminoVaultPosition[] = Array.isArray(raw) ? raw : (raw.positions || raw.data || [])

  // Enrich each position with USD value from vault metrics
  const enriched = await Promise.allSettled(
    positions.map(async (pos) => {
      if (!pos.vaultAddress) return pos
      const sharePrice = await fetchVaultSharePrice(pos.vaultAddress)
      const totalShares = Number(pos.totalShares ?? 0)
      return {
        ...pos,
        sharePrice,
        totalValueUsd: totalShares * sharePrice,
      }
    })
  )
  return enriched.map((r, i) => r.status === 'fulfilled' ? r.value : positions[i])
}

export { getMarketKey }
