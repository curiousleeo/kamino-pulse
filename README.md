# KaminoPulse

A read-only risk monitoring dashboard for [Kamino Finance](https://kamino.finance) positions on Solana. Paste a wallet address and get a live view of your lending obligations, vault positions, and protocol-wide risk signals — no wallet connection required.

![Vite](https://img.shields.io/badge/Vite-5-646CFF?logo=vite&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-3-38BDF8?logo=tailwindcss&logoColor=white)

---

## What it does

**Protocol layer** (always on, no wallet needed)
- Kamino TVL and reserve utilization across all markets
- Pyth oracle feed freshness, confidence intervals, and cross-source price deviation
- Stablecoin peg monitoring and LST oracle classification
- Solana network health: TPS, congestion, and priority fee environment

**Position layer** (wallet address required)
- All active lending obligations across every Kamino market (Main, JLP, Altcoins, Jito, Marinade, Ethena, Bitcoin, Jupiter, INF/SOL, bSOL/SOL)
- Health factor, collateral ratio, deposited/borrowed breakdown per position
- K-Vault positions: share price, TVL, available liquidity, current APY + farm rewards, estimated earnings per day/year
- Stablecoin peg alerts directly on vault cards
- Pool liquidity panel showing utilization for the reserves you're exposed to

**Overall risk score** collapses all signals into a single status: `ALL GOOD` / `WATCH` / `AT RISK` / `CRITICAL`.

---

## Data sources

| Source | Used for |
|--------|----------|
| [Kamino Finance API](https://api.kamino.finance) | Markets, reserves, obligations, vault positions |
| [Pyth Network](https://pyth.network) | Oracle prices, confidence intervals, feed age |
| [Jupiter](https://jup.ag) | Cross-source price validation |
| [Helius](https://helius.dev) | Solana TPS and network state via RPC |
| [DeFiLlama](https://defillama.com) | Protocol TVL cross-reference |

All data is fetched client-side. No backend, no database, no wallet signatures.

---

## Getting started

```bash
git clone https://github.com/<your-username>/kamino-pulse.git
cd kamino-pulse
npm install
npm run dev
```

The app works without any API keys — public RPC fallbacks are used automatically for network data. For better reliability, add a Helius key:

```bash
# .env.local
VITE_HELIUS_API_KEY=your_key_here
```

Get a free key at [helius.dev](https://helius.dev).

---

## Building

```bash
npm run build      # outputs to dist/
npm run preview    # preview the production build locally
```

---

## Project structure

```
src/
  api/
    kamino.ts      # Markets, reserves, obligations, vault positions
    pyth.ts        # Oracle feeds
    jupiter.ts     # Price feeds
    helius.ts      # Solana RPC / network health
    defillama.ts   # TVL data
  engine/
    riskEngine.ts  # Scoring logic for all 5 risk layers
  components/
    LandingHero.tsx
    ObligationCard.tsx
    VaultCard.tsx
    RiskCard.tsx
    OverallScore.tsx
    HealthBar.tsx
    WalletInput.tsx
  types/
    index.ts       # RiskTier, RiskLayer, RiskSignal
  App.tsx
```

---

## Risk layers

| Layer | What it measures |
|-------|-----------------|
| Protocol Health | Kamino TVL stability and peak reserve utilization |
| Oracle Risk | Pyth feed age, confidence intervals, Pyth/Jupiter price divergence |
| Asset Risk | Stablecoin peg deviation, LST oracle method |
| Position Risk | Health factor, LTV, vault liquidity availability |
| Network Risk | Solana TPS, congestion, priority fee environment |

---

## Contributing

Issues and PRs are welcome. A few things to know:

- The app is intentionally read-only — no signing, no transactions, no wallet adapters
- All scoring logic lives in `src/engine/riskEngine.ts` — that's the right place for threshold changes
- Public API calls are made directly from the browser; no proxy needed

---

## License

MIT
