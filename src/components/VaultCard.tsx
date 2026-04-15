import type { KaminoVaultPosition } from '../api/kamino'

interface Props {
  position: KaminoVaultPosition
  index: number
}

function fmt(n: number): string {
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${n.toFixed(2)}`
}

export function VaultCard({ position, index }: Props) {
  const addr = position.vaultAddress || ''
  const shortAddr = addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : `Vault ${index + 1}`
  const totalShares = Number(position.totalShares ?? 0)
  const value = position.totalValueUsd ?? 0
  const sharePrice = position.sharePrice ?? null

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        background: '#0d1117',
        border: '1px solid rgba(255,255,255,0.06)',
        boxShadow: '0 4px 40px rgba(0,0,0,0.3)',
      }}
    >
      {/* Header */}
      <div
        className="px-6 pt-6 pb-5"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold tracking-[0.2em] text-slate-700 uppercase mb-1.5">
              Vault Position
            </p>
            <h3 className="text-slate-100 font-bold text-lg font-mono leading-tight">
              {shortAddr}
            </h3>
          </div>
          <span
            className="flex-shrink-0 mt-1 text-[10px] font-bold tracking-wider px-3 py-1 rounded-full border"
            style={{
              color: '#a78bfa',
              background: 'rgba(139,92,246,0.1)',
              borderColor: 'rgba(139,92,246,0.2)',
            }}
          >
            EARNING
          </span>
        </div>
      </div>

      {/* Stats */}
      <div className="px-6 py-6 space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-[11px] text-slate-600 font-medium mb-1.5">Position value</p>
            <p className="text-2xl font-black text-slate-100 leading-none">
              {value > 0 ? fmt(value) : '—'}
            </p>
            <p className="text-[11px] text-slate-700 mt-1.5">USD equivalent</p>
          </div>
          <div>
            <p className="text-[11px] text-slate-600 font-medium mb-1.5">Shares held</p>
            <p className="text-2xl font-black text-slate-300 leading-none">
              {totalShares > 0
                ? totalShares.toLocaleString(undefined, { maximumFractionDigits: 2 })
                : '—'}
            </p>
            {sharePrice !== null && sharePrice > 0 && (
              <p className="text-[11px] text-slate-700 mt-1.5">
                @ ${sharePrice.toFixed(4)} / share
              </p>
            )}
          </div>
        </div>

        {/* Explanation */}
        <div
          className="rounded-xl px-4 py-3.5"
          style={{
            background: 'rgba(139,92,246,0.05)',
            border: '1px solid rgba(139,92,246,0.1)',
          }}
        >
          <p className="text-xs text-slate-500 leading-relaxed">
            <span className="text-violet-400 font-semibold">Vault (yield strategy). </span>
            Your funds are automatically deployed into a Kamino yield strategy and earning
            interest. These positions carry{' '}
            <span className="text-slate-400 font-medium">no liquidation risk</span> — you can
            withdraw at any time.
          </p>
        </div>
      </div>
    </div>
  )
}
