const API_KEY = import.meta.env.VITE_HELIUS_API_KEY || ''
const RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${API_KEY}`

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function rpc(method: string, params: unknown[] = []): Promise<any> {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  if (!res.ok) throw new Error(`Helius RPC ${res.status}`)
  const data = await res.json()
  if (data.error) throw new Error(`Helius: ${data.error.message}`)
  return data.result
}

export interface NetworkHealth {
  tps: number
  avgPriorityFee: number // microlamports
}

export async function fetchNetworkHealth(): Promise<NetworkHealth> {
  const [perfSamples, priorityFees] = await Promise.all([
    rpc('getRecentPerformanceSamples', [10]),
    rpc('getRecentPrioritizationFees', []),
  ])

  let tps = 0
  if (Array.isArray(perfSamples) && perfSamples.length > 0) {
    const valid = perfSamples.filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (s: any) => s.samplePeriodSecs > 0
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tpsValues = valid.map((s: any) => s.numTransactions / s.samplePeriodSecs)
    tps = tpsValues.reduce((a: number, b: number) => a + b, 0) / tpsValues.length
  }

  let avgPriorityFee = 0
  if (Array.isArray(priorityFees) && priorityFees.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fees = priorityFees.map((f: any) => Number(f.prioritizationFee))
    avgPriorityFee = fees.reduce((a: number, b: number) => a + b, 0) / fees.length
  }

  return { tps, avgPriorityFee }
}
