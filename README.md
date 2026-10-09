# WATS Wallet

A self-custody, multi-chain crypto wallet browser extension. Keys are generated,
encrypted and stored on the user's device — they never leave it.

Built with Vue 3 + Vite + CRXJS as a Manifest V3 extension (Chrome 115+).

**Networks:** 10 EVM networks (Ethereum, BNB Smart Chain, Optimism, Gnosis, Celo,
Mantle, Base, Cronos, Arbitrum One, Polygon) · TON

Solana support is in the source but switched off in release builds — see
[Feature flags](#feature-flags).

For the detailed product specification, see [spec.md](spec.md).

---

## Features

- **Wallet & accounts** — BIP39 mnemonic generation; import of a BIP39 recovery
  phrase, a 24-word TON phrase or an EVM private key; multiple vaults with multiple
  accounts each. Every account created from a recovery phrase has both an EVM and a
  TON address. Private-key accounts are EVM-only.
- **Security** — AES-encrypted keystore, password change, configurable auto-lock
  timer, gated reveal flows for the recovery phrase, EVM private key and TON key.
  Screens that reveal an existing recovery phrase, private key or TON key close
  themselves after 60 seconds or when the wallet is hidden.
- **Portfolio** — token balances, total value, per-token price charts, custom token
  import by contract address, transaction history grouped by day. New and imported
  accounts start with a default token list (ETH and USDT on Ethereum, ATS and BNB on
  BNB Smart Chain).
- **Tokenized stocks** — a Stocks tab with a curated, on-chain-verified catalog of
  bStocks tokenized-stock certificates on BNB Smart Chain, issued by BTech Holdings
  Limited (ADGM/FSRA). These are certificates over shares, not shares, and they
  cannot be bridged out of BNB Smart Chain.
- **Multi-chain** — switching between the supported networks with fastest-RPC racing
  and automatic reconnection. TON's native coin is shown as GRAM; the network is
  still called TON. Custom networks cannot be added.
- **Network fees in ATS** — on all 10 EVM networks, the fee for sends, swaps, bridges
  and dApp transactions is paid in ATS through an ERC-4337 paymaster (EIP-7702
  delegation, EntryPoint v0.8) instead of the native coin. The fee is always charged
  from the account's ATS balance on BNB Smart Chain, after a one-time setup there.
  For cross-chain collection the service can ask for a per-operation fee signature
  (EIP-712), which the wallet checks against the operation before signing.
  On TON, fees can be paid in ATS when the fee relay is available, otherwise in GRAM.
- **Buy ATS** — ATS can be bought inside the wallet with USDT, USDC or BNB on BNB
  Smart Chain, from the Swap screen or from any screen that reports too little ATS.
  The quote comes from a sale desk contract whose address is pinned in the client;
  the purchase carries no network fee.
- **Send** — fee quote with its USD value, confirmation screen, live status, address
  book, and recipient-address safety checks (poisoned-address and reputation
  screening).
- **Swap & bridge** — same-chain swaps on the EVM networks over Uniswap V2/V3-style
  routers, TON swaps via STON.fi, and cross-chain bridging between EVM networks via
  LI.FI. Swaps whose measured price impact is above 5% need explicit confirmation;
  if the impact cannot be measured, a warning is shown.
- **dApp integration** — EIP-1193 provider for EVM (also announced via EIP-6963) and
  a TonConnect bridge for TON; per-dApp connection approval, message signing
  (`personal_sign`, and EIP-712 `eth_signTypedData_v4` with a risk summary for
  permits and orders), network-switch requests (`wallet_switchEthereumChain`) with an
  approval screen, permission management and revocation. Sites that open signing or
  transaction approval windows too quickly are rate-limited.
- **Side panel or popup** — the wallet opens in Chrome's side panel by default;
  popup mode can be chosen under Settings → Preferences.
- **i18n & theming** — English and Turkish, light/dark theme.

## Architecture

| Part | Path | Role |
|---|---|---|
| Side panel | `src/sidepanel/`, `src/shared/bootstrap.js` | The wallet UI in Chrome's side panel (default mode) |
| Popup UI | `src/popup/` | The same wallet UI as a popup (single page, `pageStore` routing); also used for dApp approval windows |
| Onboarding | `src/onboarding/`, `onboarding.html` | First-run setup; opens in a tab when the toolbar icon is clicked while no wallet exists |
| Service worker | `src/background.js` | Session/lock state, dApp request bridge |
| Content script | `src/content.js` | Isolated-world relay between page and worker |
| EVM provider | `src/injected.js` | EIP-1193 provider, injected into the page's MAIN world |
| TON provider | `src/tonInjected.js` | TonConnect bridge |
| Solana provider | `src/solanaInjected.js` | Wallet Standard; registered only in builds with `VITE_SOLANA_ENABLED=true` |

Provider scripts are registered as `world: "MAIN"` content scripts at
`document_start`, so the provider exists before any page script runs. The EVM
provider sets `window.ethereum` only when no other wallet has claimed it; dApps
that use EIP-6963 discovery find it either way.

When Solana is enabled at build time, its bridge is deliberately narrower than the
others: sessions are keyed by full origin, so it is injected only into top-level
`https://` pages and `http://localhost` / `http://127.0.0.1` — never into other
`http://` pages or iframes. The site in the address bar is always the site that
approved the request. See the comments in [`manifest.config.js`](manifest.config.js)
for the reasoning.

## Backend

This repository contains the **extension client only**. It talks to:

- a hosted backend (`VITE_API_URL`) that stores the username profile created during
  onboarding (username and EVM address) and proxies token metadata and prices, price
  history, transaction history, news, address reputation, TON RPC and TON swap
  quotes (and Solana RPC when Solana is enabled);
- an ERC-4337 bundler proxy (`VITE_BUNDLER_BASE`);
- the ATS paymaster service that sponsors network fees and also serves the in-wallet
  ATS purchase quotes. Its address is fixed in
  [`src/utils/atsConfig.js`](src/utils/atsConfig.js), not configured through env.

These services exist so third-party API keys stay server-side: extension code is
public by nature and cannot hold a secret. None of them is part of this repository.

The client also calls some public services directly: the LI.FI API (`li.quest`) for
bridge quotes and token lists, the public EVM RPC endpoints listed in
`src/data/supported_chains.json`, and DiceBear (`api.dicebear.com`) for identicons
generated from account addresses.
The full list of endpoints the client calls is in [spec.md §7](spec.md#7-backend-contract).

## Getting started

Requires Node.js 20.19+ (or 22+) and npm.

```bash
npm install
npm run dev
```

Then open `chrome://extensions/`, enable **Developer mode**, and choose
**Load unpacked** → the `dist/` directory.

`npm run dev` uses `.env.development`, which points at a local backend
(`http://localhost:8000`) that is not part of this repository.

Production build against the hosted backend (also writes a zip to `release/`):

```bash
npm run build
```

Run the test suite:

```bash
npm test
```

- There are 442 test files (about 8,800 tests). The full run needs a few GB of free
  memory; on smaller machines use `npm run test:az-bellek` (two workers).
- Five test files are cross-repository contract tests. They read the maintainers'
  test dApp page, backend source or internal documents from the private repository
  and fail here: `src/testDappSolana.test.js`, `src/testDappTon.test.js` and
  `src/utils/routerManifest.test.js` fail to load, and one test each fails in
  `src/utils/nativeToken.test.js` and `src/utils/ton/linkedAccounts.test.js`.
- The TON key-derivation tests are CPU-heavy and can occasionally hit the 15-second
  timeout under a fully parallel run. Run the affected files on their own to confirm.

Other scripts: `npm run verify:routers` and `npm run verify:bstocks` re-check the
swap router and tokenized-stock tables against the chain; `npm run measure:bstocks`
re-measures each tokenized stock's DEX liquidity through the wallet's own BSC swap
route; `npm run ton:test` serves a local TonConnect test page.
`scripts/walletconnect-qa/` is the harness the maintainers use to test the injected
EVM provider against Reown AppKit dApps; it is not part of `npm test`, and its
README refers to the private repository's layout. The wallet itself does not
implement the WalletConnect relay protocol.

### Environment

`.env.development` and `.env.production` are committed and contain no secrets —
only the backend base URLs (`VITE_API_URL`, `VITE_BUNDLER_BASE`) and one build flag
(`VITE_SOLANA_ENABLED`).

To override a value locally, create `.env.development.local` or
`.env.production.local` (both git-ignored). A plain `.env.local` does not work for
these keys: Vite loads the mode-specific files after it, so they win.

```
VITE_API_URL=http://localhost:8000
VITE_BUNDLER_BASE=http://localhost:8000
```

### Feature flags

`VITE_SOLANA_ENABLED` — only the exact string `true` enables Solana. It is `false`
in both committed env files. When it is off:

- the Solana content script is not written into the manifest,
- the service worker refuses every Solana action,
- Solana is dropped from the network list.

The test suite forces the flag on (`vitest.config.js`) so the Solana code stays
tested.

## Security

This is wallet software. If you find a vulnerability, please report it privately —
see [SECURITY.md](SECURITY.md). Do not open a public issue for security problems.

## Contributing

Issues and pull requests are welcome. Please run `npm test` before opening a PR.

Note: most source comments are written in Turkish, and some refer to internal
design documents or backend files that are not part of this repository.

## License

[MIT](LICENSE)
