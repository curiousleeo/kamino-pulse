const BASE = 'https://hermes.pyth.network'

// Pyth price feed IDs (without 0x prefix)
export const PYTH_FEEDS: Record<string, string> = {
  'SOL/USD':  'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d',
  'USDC/USD': 'eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a',
  'USDT/USD': '2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b',
  'ETH/USD':  'ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
  'BTC/USD':  'e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
  'mSOL/USD': 'c2289a6a43d2ce91c6f55caec370f4acc38a2ed477f58813334c6d03749ff2a4',
}

export interface PythFeed {
  id: string
  symbol: string
  price: number
  confidence: number
  confRatio: number
  publishTime: number
  ageSeconds: number
}

export async function fetchPythPrices(): Promise<PythFeed[]> {
  const ids = Object.values(PYTH_FEEDS)
  const params = ids.map(id => `ids[]=${id}`).join('&')
  const res = await fetch(`${BASE}/v2/updates/price/latest?${params}&parsed=true`)
  if (!res.ok) throw new Error(`Pyth ${res.status}`)
  const data = await res.json()

  const now = Math.floor(Date.now() / 1000)
  const symbolById: Record<string, string> = {}
  for (const [sym, id] of Object.entries(PYTH_FEEDS)) {
    symbolById[id.toLowerCase()] = sym
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data.parsed || []).map((item: any) => {
    const p = item.price
    const expo = Number(p.expo)
    const scale = Math.pow(10, expo)
    const price = Number(p.price) * scale
    const conf = Number(p.conf) * scale
    const confRatio = Math.abs(price) > 0 ? conf / Math.abs(price) : 0
    const normalizedId = String(item.id).replace(/^0x/, '').toLowerCase()

    return {
      id: item.id,
      symbol: symbolById[normalizedId] || item.id,
      price,
      confidence: conf,
      confRatio,
      publishTime: Number(p.publish_time),
      ageSeconds: now - Number(p.publish_time),
    } satisfies PythFeed
  })
}
