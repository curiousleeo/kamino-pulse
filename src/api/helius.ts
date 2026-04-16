const API_KEY = import.meta.env.VITE_HELIUS_API_KEY || ''
const RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${API_KEY}`

// Multiple public fallback RPCs — tried in parallel, first successful wins
const PUBLIC_RPCS = [
  'https://api.mainnet-beta.solana.com',
  'https://rpc.ankr.com/solana',
]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function rpcOnce(url: string, method: string, params: unknown[]): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  if (!res.ok) throw new Error(`RPC ${res.status}`)
  const data = await res.json()
  if (data.error) throw new Error(`RPC: ${data.error.message}`)
  return data.result
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function rpc(method: string, params: unknown[] = []): Promise<any> {
  if (API_KEY) return rpcOnce(RPC_URL, method, params)
  // No API key — try public RPCs sequentially, return first successful result
  let lastErr: unknown
  for (const url of PUBLIC_RPCS) {
    try { return await rpcOnce(url, method, params) } catch (e) { lastErr = e }
  }
  throw lastErr
}

// ─── Base58 decode (no external dep) ─────────────────────────────────────────

const B58_ALPHA = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

function base58Decode(s: string): Uint8Array {
  const bytes = [0]
  for (const c of s) {
    let carry = B58_ALPHA.indexOf(c)
    if (carry < 0) throw new Error('Invalid base58')
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58
      bytes[i] = carry & 0xff
      carry >>= 8
    }
    while (carry) { bytes.push(carry & 0xff); carry >>= 8 }
  }
  for (const c of s) { if (c === '1') bytes.push(0); else break }
  return new Uint8Array(bytes.reverse())
}

function base58Encode(bytes: Uint8Array): string {
  const digits = [0]
  for (const byte of bytes) {
    let carry = byte
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8
      digits[i] = carry % 58
      carry = Math.floor(carry / 58)
    }
    while (carry) { digits.push(carry % 58); carry = Math.floor(carry / 58) }
  }
  let result = ''
  for (const byte of bytes) { if (byte === 0) result += '1'; else break }
  return result + digits.reverse().map(d => B58_ALPHA[d]).join('')
}

// ─── K-Vault account struct offsets ──────────────────────────────────────────
// The Kamino K-Vault program (KvauGMspG5k6rtzrqqn7WNn3oZdyKqLKwK2XWQ8FLjd)
// stores these fields at fixed offsets in its Anchor account layout:
//   offset  80 (32 bytes): underlying token mint pubkey
//   offset 312 (32 bytes): associated Kamino lending reserve pubkey
const KVAULT_TOKEN_MINT_OFFSET   = 80
const KVAULT_RESERVE_PUBKEY_OFFSET = 312

// Hardcoded fallback for known vaults — vault-to-reserve relationships are
// permanent on-chain. Used when the RPC call fails (rate limit on public endpoint).
// Add entries as new vaults are decoded.
const KNOWN_VAULT_TOKEN_INFO: Record<string, { tokenMint: string; reservePubkey: string }> = {
  // Sentora PYUSD Vault → Main Market PYUSD reserve
  'A2wsxhA7pF4B2UKVfXocb6TAAP9ipfPJam6oMKgDE5BK': {
    tokenMint:    '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo',
    reservePubkey: '2gc9Dm1eB6UgVYFBUN9bWks6Kes9PbWSaPaa9DqyvEiN',
  },
}

// Module-level cache: once we decode a vault's on-chain data, store it
// so subsequent refreshes don't need to re-hit the RPC endpoint
const vaultTokenInfoCache = new Map<string, { tokenMint: string; reservePubkey: string }>()

/**
 * Reads the K-Vault program account on-chain and extracts the underlying
 * token mint and lending reserve pubkey from their fixed struct offsets.
 * Results are cached in memory so the RPC is only hit once per vault per session.
 * Returns null if the account cannot be read or is too small.
 */
export async function fetchVaultTokenInfo(
  vaultAddress: string
): Promise<{ tokenMint: string; reservePubkey: string } | null> {
  // 1. In-memory cache (populated on first successful decode)
  const cached = vaultTokenInfoCache.get(vaultAddress)
  if (cached) return cached

  // 2. Hardcoded map for known vaults (works even without RPC)
  const known = KNOWN_VAULT_TOKEN_INFO[vaultAddress]
  if (known) {
    vaultTokenInfoCache.set(vaultAddress, known)
    return known
  }

  // 3. On-chain decode via RPC (falls back across public endpoints)
  try {
    const result = await rpc('getAccountInfo', [vaultAddress, { encoding: 'base64' }])
    if (!result?.value?.data) return null

    const raw = Uint8Array.from(atob(result.value.data[0]), c => c.charCodeAt(0))
    if (raw.length < KVAULT_RESERVE_PUBKEY_OFFSET + 32) return null

    const tokenMintBytes     = raw.slice(KVAULT_TOKEN_MINT_OFFSET, KVAULT_TOKEN_MINT_OFFSET + 32)
    const reservePubkeyBytes = raw.slice(KVAULT_RESERVE_PUBKEY_OFFSET, KVAULT_RESERVE_PUBKEY_OFFSET + 32)

    const info = {
      tokenMint:    base58Encode(tokenMintBytes),
      reservePubkey: base58Encode(reservePubkeyBytes),
    }
    vaultTokenInfoCache.set(vaultAddress, info)
    return info
  } catch {
    return null
  }
}

// Export for tests / debugging
export { base58Decode, base58Encode }

export interface NetworkHealth {
  tps: number
  avgPriorityFee: number // microlamports
}

export async function fetchNetworkHealth(): Promise<NetworkHealth> {
  // Use allSettled so one failing RPC call doesn't kill the whole fetch
  const [perfResult, feeResult] = await Promise.allSettled([
    rpc('getRecentPerformanceSamples', [10]),
    rpc('getRecentPrioritizationFees', []),
  ])

  let tps = 0
  if (perfResult.status === 'fulfilled' && Array.isArray(perfResult.value)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const valid = perfResult.value.filter((s: any) => s.samplePeriodSecs > 0)
    if (valid.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tpsValues = valid.map((s: any) => s.numTransactions / s.samplePeriodSecs)
      tps = tpsValues.reduce((a: number, b: number) => a + b, 0) / tpsValues.length
    }
  }

  let avgPriorityFee = 0
  if (feeResult.status === 'fulfilled' && Array.isArray(feeResult.value)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fees = feeResult.value.map((f: any) => Number(f.prioritizationFee))
    if (fees.length > 0) {
      avgPriorityFee = fees.reduce((a: number, b: number) => a + b, 0) / fees.length
    }
  }

  return { tps, avgPriorityFee }
}
