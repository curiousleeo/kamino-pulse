# KaminoPulse

A read-only risk monitoring dashboard for [Kamino Finance](https://kamino.finance) positions on Solana. Paste a wallet address and get a live, personalized view of your lending obligations, K-Vault positions, and protocol-wide risk signals — no wallet connection required.

![Vite](https://img.shields.io/badge/Vite-5-646CFF?logo=vite&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-3-38BDF8?logo=tailwindcss&logoColor=white)

---

## What it does

**Protocol layer** (always on, no wallet needed)
- Kamino TVL and reserve utilization across all markets
- Pyth oracle feed freshness, confidence intervals, and cross-source price deviation
- Stablecoin peg monitoring (USDC, USDT, PYUSD, USDS) and LST oracle classification
- Solana network health: TPS, congestion, and priority fee environment

**Position layer** (wallet address required)
- All active lending obligations across every Kamino market (Main, JLP, Altcoins, Jito, Marinade, Ethena, Bitcoin, Jupiter, INF/SOL, bSOL/SOL)
- Health factor, collateral ratio, deposited/borrowed breakdown per obligation
- K-Vault positions: share price, TVL, Total Borrowed, available liquidity, utilization, current APY + farm rewards
- Estimated earnings broken down per day, per month, and per year
- Personal withdrawal risk signal — shows how many times over the available liquidity covers your position size
- Stablecoin peg alerts directly on vault cards
- Pool liquidity panel showing utilization for the reserves you're exposed to

**Personalized overall risk score** collapses all signals into a single status: `ALL GOOD` / `WATCH` / `AT RISK` / `CRITICAL`.

The score is position-aware — a lend-only or vault-only user will never see `CRITICAL` just because an unrelated Kamino reserve is near cap. Context layers (protocol, oracle, network) can raise the score by at most one tier above your actual position risk.

---

## K-Vault multi-allocation support

Kamino K-Vaults deploy capital across multiple lending markets simultaneously (e.g. Main + JLP + Maple + Prime). KaminoPulse decodes the on-chain `VaultState` account to read each market allocation and computes:

- **Total Borrowed** — `Σ(vault allocation per market × that market's utilization rate)`
- **Available** — vault TVL minus total borrowed
- **Blended utilization** — weighted across all allocated markets

This gives you the true withdrawal availability for your vault position, not a protocol-wide estimate.

---

## Data sources

| Source | Used for |
|--------|----------|
| [Kamino Finance API](https://api.kamino.finance) | Markets, reserves, obligations, vault positions |
| [Pyth Network](https://pyth.network) | Oracle prices, confidence intervals, feed age |
| [Jupiter](https://jup.ag) | Cross-source price validation |
| [Helius](https://helius.dev) | Solana RPC — vault account decode + network health |
| [DeFiLlama](https://defillama.com) | Protocol TVL cross-reference |

All data is fetched client-side. No backend, no database, no wallet signatures.

---

## Getting started

```bash
git clone https://github.com/curiousleeo/kamino-pulse.git
cd kamino-pulse
npm install
npm run dev
```

The app works without any API keys — public RPC fallbacks are used automatically. For better reliability and accurate vault allocation data, add a Helius key:

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
    kamino.ts      # Markets, reserves, obligations, vault positions + on-chain allocation decode
    pyth.ts        # Oracle feeds
    jupiter.ts     # Price feeds
    helius.ts      # Solana RPC — vault account decode, network health
    defillama.ts   # TVL data
  engine/
    riskEngine.ts  # Scoring logic for all 5 risk layers (position-aware)
  components/
    LandingHero.tsx
    ObligationCard.tsx
    VaultCard.tsx       # Vault stats, withdrawal risk, earnings breakdown
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
| Protocol Health | Your vault's blended utilization (personalized when wallet loaded); Kamino-wide peak shown as context |
| Oracle Risk | Pyth feed age, confidence intervals, Pyth/Jupiter price divergence |
| Asset Risk | Stablecoin peg deviation, LST oracle method |
| Position Risk | Health factor, LTV, vault utilization, withdrawal coverage vs position size |
| Network Risk | Solana TPS, congestion, priority fee environment |

---

## How the overall score works

Protocol, oracle, network, and asset layers are **context** — they can warn you but won't dominate the score when your position is healthy. The algorithm:

1. Position Risk drives the headline tier
2. If position is green/yellow, context layers can bump overall by at most **one tier**
3. If no wallet is loaded, the score reflects aggregate protocol health

A vault-only user with no borrow risk and 80% vault utilization gets `WATCH`, not `CRITICAL`.

---

## Contributing

Issues and PRs are welcome. A few things to know:

- The app is intentionally read-only — no signing, no transactions, no wallet adapters
- All scoring logic lives in `src/engine/riskEngine.ts` — that's the right place for threshold changes
- Public API calls are made directly from the browser; no proxy needed
- On-chain vault account decoding lives in `src/api/helius.ts` (`decodeVaultAccount`)

---

## License

MIT
