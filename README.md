# WATS Wallet

A self-custody, multi-chain crypto wallet browser extension. Keys are generated,
encrypted and stored on the user's device — they never leave it.

Built with Vue 3 + Vite + CRXJS as a Manifest V3 extension (Chrome 115+).

**Networks:** 2000+ EVM chains · TON · Solana

---

## Features

- **Wallet & accounts** — BIP39 mnemonic generation with backup verification, seed
  phrase / private key import, multiple vaults and multiple accounts per vault.
- **Security** — AES-encrypted keystore, password change, configurable auto-lock
  timer with activity heartbeat, gated reveal flows for mnemonic and private key.
- **Portfolio** — token balances, total value, per-token price charts, custom token
  import by contract address, transaction history.
- **Multi-chain** — chain switching over a 2000+ EVM chain list with fastest-RPC
  racing and automatic reconnection, plus native TON and Solana support.
- **Send** — gas estimation, confirmation screen, live status, address book, and
  recipient-address safety checks (poisoned-address and reputation screening).
- **Swap & bridge** — same-chain swaps over Uniswap V2/V3 style routers, and
  cross-chain bridging.
- **Gasless transactions** — pay gas in ERC-20 tokens via EIP-7702 + ERC-4337
  smart accounts (EntryPoint v0.8) and an ERC-20 paymaster, on Ethereum, BNB Chain,
  Base, Optimism, Arbitrum and Polygon.
- **dApp integration** — EIP-1193 provider for EVM, TonConnect bridge for TON, and
  Wallet Standard for Solana; per-dApp connection approval, message signing,
  permission management and revocation.
- **Buy & receive** — MoonPay fiat on-ramp, QR code address sharing.
- **i18n & theming** — English and Turkish, light/dark theme.

## Architecture

| Part | Path | Role |
|---|---|---|
| Popup UI | `src/popup/` | Main wallet interface (single page, `pageStore` routing) |
| Onboarding | `src/onboarding/`, `onboarding.html` | First-run setup, opens automatically |
| Service worker | `src/background.js` | Session/lock state, dApp request bridge |
| Content script | `src/content.js` | Isolated-world relay between page and worker |
| EVM provider | `src/injected.js` | EIP-1193 provider, injected into the page's MAIN world |
| TON provider | `src/tonInjected.js` | TonConnect bridge |
| Solana provider | `src/solanaInjected.js` | Wallet Standard; HTTPS + localhost only, no iframes |

Provider scripts are registered as `world: "MAIN"` content scripts at
`document_start`, so the provider exists before any page script runs. The Solana
bridge is deliberately narrower than the others: sessions are keyed by full origin,
so it is never injected into `http://` pages or iframes — the site in the address
bar is always the site that approved the request. See the comments in
[`manifest.config.js`](manifest.config.js) for the reasoning.

## Backend

This repository contains the **extension client only**. It talks to a hosted
backend (`VITE_API_URL`) that proxies token metadata and prices, price history,
transaction history, the ERC-4337 bundler/paymaster, and TON/Solana RPC.

That backend exists so third-party API keys stay server-side: extension code is
public by nature and cannot hold a secret. The backend is not part of this
repository.

Endpoints the client calls: token data and search, profile/username, MoonPay signed
URL, wallet history, bundler auth and `/rpc/:chainId` proxy, TON and Solana RPC.

## Getting started

Requires Node.js 18+ and npm.

```bash
npm install
npm run dev
```

Then open `chrome://extensions/`, enable **Developer mode**, and choose
**Load unpacked** → the `dist/` directory.

Production build (also writes a zip to `release/`):

```bash
npm run build
```

Run the test suite:

```bash
npm test
```

### Environment

`.env.development` and `.env.production` are committed and contain no secrets —
only the backend base URL. For a local override, create `.env.local`:

```
VITE_API_URL=http://localhost:8000
VITE_BUNDLER_BASE=http://localhost:8000
```

## Security

This is wallet software. If you find a vulnerability, please report it privately —
see [SECURITY.md](SECURITY.md). Do not open a public issue for security problems.

## Contributing

Issues and pull requests are welcome. Please run `npm test` before opening a PR.

Note: most source comments and internal design docs are written in Turkish.

## License

[MIT](LICENSE)
