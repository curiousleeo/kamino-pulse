const BASE = 'https://api.llama.fi'

export interface DefiLlamaTVL {
  current: number
  change24h: number
}

export async function fetchKaminoTVL(): Promise<DefiLlamaTVL> {
  const res = await fetch(`${BASE}/protocol/kamino`)
  if (!res.ok) throw new Error(`DeFiLlama ${res.status}`)
  const data = await res.json()

  // DeFiLlama: `tvl` can be a number OR a historical array [{date, totalLiquidityUSD}]
  const tvlArray: Array<{ date: number; totalLiquidityUSD: number }> =
    Array.isArray(data.tvl) ? data.tvl : Array.isArray(data.tvlList) ? data.tvlList : []

  let current = 0
  if (typeof data.tvl === 'number') {
    current = data.tvl
  } else if (tvlArray.length > 0) {
    current = tvlArray[tvlArray.length - 1].totalLiquidityUSD || 0
  }

  // Fallback: currentChainTvls sum
  if (current === 0 && data.currentChainTvls) {
    current = Object.values(data.currentChainTvls as Record<string, number>).reduce(
      (a, b) => a + b, 0
    )
  }

  let change24h = 0
  if (tvlArray.length >= 2) {
    const latest = tvlArray[tvlArray.length - 1].totalLiquidityUSD
    const previous = tvlArray[tvlArray.length - 2].totalLiquidityUSD
    if (previous > 0) change24h = (latest - previous) / previous
  }

  return { current, change24h }
}
