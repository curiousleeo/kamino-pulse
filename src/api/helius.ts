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
// Verified from Kamino-Finance/kvault programs/kvault/src/state.rs (master branch)
//
// VaultState layout (Anchor, 8-byte discriminator prefix):
//   offset   80 (32 bytes): token_mint pubkey
//   offset  112 ( 8 bytes): token_mint_decimals (u64)
//   offset  312          : vault_allocation_strategy — [VaultAllocation; 25]
//
// VaultAllocation layout (2160 bytes each):
//   offset    0 (32 bytes): reserve pubkey
//   offset 1104 ( 8 bytes): ctoken_allocation (u64)
//   offset 1120 (16 bytes): token_target_allocation_sf (u128, raw token units × 10^decimals)
const KVAULT_TOKEN_MINT_OFFSET      = 80
const KVAULT_TOKEN_DECIMALS_OFFSET  = 112
const KVAULT_ALLOC_ARRAY_OFFSET     = 312
const KVAULT_ALLOC_ENTRY_SIZE       = 2160
const KVAULT_ALLOC_MAX              = 25
// Within each VaultAllocation entry:
const ALLOC_RESERVE_OFFSET          = 0
const ALLOC_CTOKEN_OFFSET           = 1104   // u64
const ALLOC_TOKEN_SF_OFFSET         = 1120   // u128

export interface VaultAllocation {
  reserve: string       // lending reserve pubkey
  tokenAmount: number   // vault's allocation in token units (human-readable, e.g. 109_697_201 PYUSD)
}

export interface VaultTokenInfo {
  tokenMint: string
  reservePubkey: string  // first active reserve (kept for backward compat)
  decimals: number
  allocations: VaultAllocation[]
}

// Hardcoded fallback for vaults whose on-chain decode may fail (public RPC rate limits,
// CORS issues). Only the tokenMint is needed — enough to trigger the registry fallback
// in kamino.ts. Add entries here as new vaults are encountered.
const KNOWN_VAULT_MINTS: Record<string, string> = {
  'A2wsxhA7pF4B2UKVfXocb6TAAP9ipfPJam6oMKgDE5BK': '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo', // Sentora PYUSD
}

// Module-level cache — RPC is only hit once per vault per session
const vaultTokenInfoCache = new Map<string, VaultTokenInfo>()

function readU64LE(raw: Uint8Array, offset: number): number {
  let val = 0
  for (let i = 0; i < 8; i++) val += raw[offset + i] * Math.pow(2, 8 * i)
  return val
}

// token_target_allocation_sf is a Kamino scaled-fraction (u128, scale = 2^60).
// Must use BigInt — the raw value is ~10^32, well beyond Number.MAX_SAFE_INTEGER.
// After >> 60, the result (~10^14 base units) safely fits in a JS number.
const SF_SCALE = 1n << 60n

function readU128SF(raw: Uint8Array, offset: number): number {
  let val = 0n
  for (let i = 0; i < 16; i++) val += BigInt(raw[offset + i]) << BigInt(8 * i)
  return Number(val / SF_SCALE)  // base token units, safe as JS number
}

function decodeVaultAccount(raw: Uint8Array): VaultTokenInfo | null {
  const minSize = KVAULT_ALLOC_ARRAY_OFFSET + KVAULT_ALLOC_ENTRY_SIZE
  if (raw.length < minSize) return null

  const tokenMint  = base58Encode(raw.slice(KVAULT_TOKEN_MINT_OFFSET, KVAULT_TOKEN_MINT_OFFSET + 32))
  const decimals   = readU64LE(raw, KVAULT_TOKEN_DECIMALS_OFFSET)
  const divisor    = Math.pow(10, decimals)

  const allocations: VaultAllocation[] = []
  let firstReserve = ''

  for (let i = 0; i < KVAULT_ALLOC_MAX; i++) {
    const base    = KVAULT_ALLOC_ARRAY_OFFSET + i * KVAULT_ALLOC_ENTRY_SIZE
    if (base + ALLOC_TOKEN_SF_OFFSET + 16 > raw.length) break

    const ctokens  = readU64LE(raw, base + ALLOC_CTOKEN_OFFSET)
    const baseUnits = readU128SF(raw, base + ALLOC_TOKEN_SF_OFFSET)

    // Skip empty slots
    if (ctokens === 0 && baseUnits === 0) continue

    const reserve     = base58Encode(raw.slice(base + ALLOC_RESERVE_OFFSET, base + ALLOC_RESERVE_OFFSET + 32))
    const tokenAmount = baseUnits / divisor

    if (!firstReserve) firstReserve = reserve
    allocations.push({ reserve, tokenAmount })
  }

  return { tokenMint, reservePubkey: firstReserve, decimals, allocations }
}

/**
 * Reads the K-Vault program account on-chain and returns the token mint,
 * decimals, and per-reserve allocation amounts.
 * Cached in memory — RPC is only called once per vault per session.
 */
export async function fetchVaultTokenInfo(
  vaultAddress: string
): Promise<VaultTokenInfo | null> {
  const cached = vaultTokenInfoCache.get(vaultAddress)
  if (cached) return cached

  try {
    const result = await rpc('getAccountInfo', [vaultAddress, { encoding: 'base64' }])
    if (!result?.value?.data) return mintFallback(vaultAddress)

    const raw  = Uint8Array.from(atob(result.value.data[0]), c => c.charCodeAt(0))
    const info = decodeVaultAccount(raw)
    if (!info) return mintFallback(vaultAddress)

    vaultTokenInfoCache.set(vaultAddress, info)
    return info
  } catch {
    return mintFallback(vaultAddress)
  }
}

function mintFallback(vaultAddress: string): VaultTokenInfo | null {
  const mint = KNOWN_VAULT_MINTS[vaultAddress]
  if (!mint) return null
  // Return mint-only info — no allocations, but enough to trigger the
  // registry-based fallback aggregation in kamino.ts
  return { tokenMint: mint, reservePubkey: '', decimals: 0, allocations: [] }
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
