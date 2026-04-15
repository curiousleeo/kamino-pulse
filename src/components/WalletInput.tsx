import { useState } from 'react'

// Solana address: 32–44 chars (base58 chars, but be lenient — some valid addresses
// use chars that strict base58 regex rejects depending on encoding)
const ADDR_MIN_LEN = 32
const ADDR_MAX_LEN = 44

interface Props {
  wallet: string
  onChange: (wallet: string) => void
}

export function WalletInput({ wallet, onChange }: Props) {
  const [input, setInput] = useState(wallet)
  const [error, setError] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = input.trim()
    if (trimmed && (trimmed.length < ADDR_MIN_LEN || trimmed.length > ADDR_MAX_LEN)) {
      setError(`Address should be ${ADDR_MIN_LEN}–${ADDR_MAX_LEN} characters`)
      return
    }
    setError('')
    onChange(trimmed)
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 w-full">
      <div className="flex-1 min-w-0">
        <input
          type="text"
          value={input}
          onChange={e => { setInput(e.target.value); setError('') }}
          placeholder="Paste Solana wallet address..."
          className={`w-full bg-slate-800 border rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none font-mono ${error ? 'border-red-500/60 focus:border-red-500' : 'border-slate-700 focus:border-slate-500'}`}
          spellCheck={false}
          autoComplete="off"
        />
        {error && <p className="text-red-400 text-xs mt-1 px-1">{error}</p>}
      </div>
      <button
        type="submit"
        className="px-3 py-2 bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium rounded-lg transition-colors whitespace-nowrap"
      >
        Track
      </button>
      {wallet && (
        <button
          type="button"
          onClick={() => { setInput(''); onChange('') }}
          className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-400 text-xs rounded-lg transition-colors border border-slate-700"
          title="Clear wallet"
        >
          ×
        </button>
      )}
    </form>
  )
}
