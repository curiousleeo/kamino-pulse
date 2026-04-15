import { useState } from 'react'

const ADDR_MIN = 32
const ADDR_MAX = 44

interface Props {
  onSearch: (wallet: string) => void
  loading: boolean
  tvl?: number
}

export function LandingHero({ onSearch, loading, tvl }: Props) {
  const [input, setInput] = useState('')
  const [error, setError] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = input.trim()
    if (trimmed && (trimmed.length < ADDR_MIN || trimmed.length > ADDR_MAX)) {
      setError("That doesn't look like a valid Solana address")
      return
    }
    setError('')
    onSearch(trimmed)
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4 relative overflow-hidden"
      style={{ background: '#07090e' }}
    >
      {/* Purple glow backdrop */}
      <div className="absolute inset-0 pointer-events-none select-none">
        <div
          className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[600px] rounded-full blur-3xl"
          style={{
            background:
              'radial-gradient(ellipse, rgba(109,40,217,0.18) 0%, rgba(79,70,229,0.08) 50%, transparent 70%)',
          }}
        />
      </div>

      {/* Content */}
      <div className="relative z-10 w-full max-w-lg text-center">

        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-14">
          <div
            className="w-10 h-10 rounded-2xl flex items-center justify-center"
            style={{
              background: 'rgba(139,92,246,0.15)',
              border: '1px solid rgba(139,92,246,0.35)',
            }}
          >
            <span className="text-violet-400 font-black text-base tracking-tight">K</span>
          </div>
          <span className="text-slate-300 font-semibold text-lg tracking-tight">KaminoPulse</span>
        </div>

        {/* Headline */}
        <h1 className="text-5xl sm:text-6xl font-black text-white leading-[1.05] tracking-tight mb-5">
          Your Kamino<br />
          <span
            style={{
              background: 'linear-gradient(135deg, #a78bfa 0%, #818cf8 60%, #c4b5fd 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            Portfolio
          </span>
          ,{' '}
          <span className="text-slate-400 font-black">clearly.</span>
        </h1>

        <p className="text-slate-400 text-base sm:text-lg leading-relaxed mb-10 max-w-sm mx-auto">
          See your lending positions, health factors, and liquidation risk — explained in plain English.
          Read-only. No sign-up.
        </p>

        {/* Wallet input */}
        <form onSubmit={handleSubmit} className="w-full space-y-3">
          <div className="relative">
            <input
              type="text"
              value={input}
              onChange={e => { setInput(e.target.value); setError('') }}
              placeholder="Paste your Solana wallet address…"
              className="w-full px-5 py-4 pr-36 rounded-2xl text-sm font-mono text-slate-200 placeholder-slate-700 outline-none transition-all duration-200"
              style={{
                background: 'rgba(13,17,23,0.9)',
                border: error
                  ? '1px solid rgba(239,68,68,0.5)'
                  : input
                  ? '1px solid rgba(139,92,246,0.5)'
                  : '1px solid rgba(255,255,255,0.07)',
                boxShadow: input && !error
                  ? '0 0 0 3px rgba(139,92,246,0.08), 0 1px 24px rgba(0,0,0,0.4)'
                  : '0 1px 24px rgba(0,0,0,0.3)',
              }}
              spellCheck={false}
              autoComplete="off"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="absolute right-2 top-1/2 -translate-y-1/2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-150 disabled:opacity-30 disabled:cursor-not-allowed"
              style={{
                background: 'linear-gradient(135deg, #7c3aed, #6d28d9)',
                color: 'white',
                boxShadow: '0 2px 12px rgba(109,40,217,0.4)',
              }}
            >
              {loading ? 'Loading…' : 'Track →'}
            </button>
          </div>
          {error && (
            <p className="text-red-400 text-xs text-left px-1">{error}</p>
          )}
        </form>

        {/* Trust signals */}
        <div className="flex items-center justify-center gap-5 mt-10 flex-wrap">
          {[
            tvl ? `$${(tvl / 1e9).toFixed(1)}B+ protocol TVL` : '$1B+ protocol TVL',
            '29 Kamino markets',
            'No wallet connection',
            'Real-time data',
          ].map((item, i, arr) => (
            <span key={item} className="flex items-center gap-5">
              <span className="text-xs text-slate-700">{item}</span>
              {i < arr.length - 1 && <span className="text-slate-800">·</span>}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
