const BASE = 'https://api.jup.ag'
const API_KEY = import.meta.env.VITE_JUPITER_API_KEY || ''

// Solana token mint addresses
export const TOKEN_MINTS: Record<string, string> = {
  SOL:     'So11111111111111111111111111111111111111112',
  USDC:    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  USDT:    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  PYUSD:   '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo',
  USDS:    'USDSwr9ApdHk57E8Ab6YvfGqDmb4Goqn8jdQjiSJFk',
  jitoSOL: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn',
  mSOL:    'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
  bSOL:    'bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1',
}

export interface JupiterPrice {
  symbol: string
  mint: string
  price: number | null
}

export async function fetchJupiterPrices(): Promise<JupiterPrice[]> {
  const mintBySymbol = TOKEN_MINTS
  const mints = Object.values(mintBySymbol)
  const symbolByMint = Object.fromEntries(
    Object.entries(mintBySymbol).map(([sym, mint]) => [mint, sym])
  )

  const headers: Record<string, string> = {}
  if (API_KEY) headers['x-api-key'] = API_KEY

  const res = await fetch(`${BASE}/price/v3?ids=${mints.join(',')}`, { headers })
  if (!res.ok) throw new Error(`Jupiter ${res.status}`)
  // Jupiter /price/v3 returns { mintAddress: { usdPrice: number, ... } }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: Record<string, any> = await res.json()

  return mints.map(mint => ({
    symbol: symbolByMint[mint] || mint,
    mint,
    price: data[mint]?.usdPrice != null ? Number(data[mint].usdPrice) : null,
  }))
}
