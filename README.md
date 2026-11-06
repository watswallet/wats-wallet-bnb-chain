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
  TON address. Private-key accounts are EVM-only. A raw 128-hex TON secret key cannot
  be imported; the import screen points to the recovery-phrase import instead.
  When a recovery phrase is imported, the wallet looks for the accounts already in use
  (see below).
- **Security** — AES-encrypted keystore, password change, configurable auto-lock
  timer, gated reveal flows for the recovery phrase, EVM private key and TON key.
  Screens that reveal an existing recovery phrase, private key or TON key close
  themselves after 60 seconds or when the wallet is hidden.
- **Account discovery on import** — importing a BIP39 phrase scans the derived EVM
  accounts (`m/44'/60'/0'/0/i`) and adds the ones that have been used on any of the
  10 EVM networks: a transaction, a native balance, or a balance in a short fixed list
  of well-known tokens. The scan stops after 3 unused indexes in a row, adds at most
  20 accounts and takes at most 60 seconds; the Skip button keeps only the first
  account. It sends only public addresses to the public RPC endpoints already bundled
  in the app. Solana and TON addresses are not scanned.
- **Portfolio** — token balances, total value, per-token price charts, custom token
  import by contract address, transaction history grouped by day. New and imported
  accounts start with a default token list (ETH and USDT on Ethereum, ATS and BNB on
  BNB Smart Chain).
- **Token logos** — every token row shows a logo or, failing that, a letter monogram.
  Sources, in order: logo files bundled with the extension, the image URL already on
  the token record, then the Trust Wallet asset repository on
  `raw.githubusercontent.com` (the host sees the requester's IP and the contract
  address being displayed, not a wallet address). Search and token-picker lists hide
  tokens that have no logo, except that a token the account holds with a non-zero
  balance stays visible in the wallet's own asset lists. Address identicons are generated locally.
- **Display currency** — values can be shown in a fiat currency chosen under
  Settings → Preferences (a searchable list). Prices are held in USD and converted
  only for display, using a rate table served by the backend; if the selected
  currency has no rate, or the rates are older than 24 hours, amounts fall back to
  USD. The default follows the browser's region and language. The Send amount field
  also accepts an amount in the selected currency.
- **Tokenized stocks** — a Stocks tab with two curated, on-chain-verified catalogs.
  bStocks are tokenized-stock certificates on BNB Smart Chain issued by BTech Holdings
  Limited (ADGM/FSRA), bought and sold through the wallet's PancakeSwap route.
  xStocks are tracker certificates issued by Backed Assets (JE) Limited, bought and
  sold on Ethereum, BNB Smart Chain and Arbitrum One through CoW Protocol orders that
  the user signs (EIP-712) in the wallet, paid in USDC or USDT. A 0.1% partner fee is
  included in each xStocks order. These are certificates over shares, not shares.
  Neither kind can be bridged out, and xStocks also cannot be used in the general
  Swap screen or as a bridge destination.
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
- **Private Account** — an optional private mode with one extra, EVM-only account per
  wallet, derived from the same recovery phrase. Money moves between the regular
  accounts and the Private Account only through SilentSwap, a third-party service,
  on 10 EVM networks; network fees in this mode are paid in ATS. While it is on, the
  wallet hides its accounts from dApps, stops price and rate requests, and keeps the
  Private Account's records on the device only. SilentSwap and the other services
  involved can still see addresses and the requester's IP, and several limits apply;
  see [spec.md §6.15](spec.md#615-private-account) before relying on it.
- **Send** — fee quote with its USD value, confirmation screen, live status, address
  book, and recipient-address safety checks (poisoned-address and reputation
  screening).
- **Swap & bridge** — same-chain swaps on the EVM networks over Uniswap V2/V3-style
  routers, TON swaps via STON.fi, and cross-chain bridging between EVM networks via
  LI.FI. Swaps whose measured price impact is above 5% need explicit confirmation;
  if the impact cannot be measured, a warning is shown. A bridge quote is remembered
  on the client, and the wallet refuses to sign it if the quoted receiver is not the
  signing account.
- **dApp integration** — EIP-1193 provider for EVM (also announced via EIP-6963) and
  a TonConnect bridge for TON; per-dApp connection approval, message signing
  (`personal_sign`, and EIP-712 `eth_signTypedData_v4` with a risk summary for
  permits and orders), network-switch requests (`wallet_switchEthereumChain`) with an
  approval screen, permission management and revocation. Sites that open signing or
  transaction approval windows too quickly are rate-limited.
- **Side panel or popup** — the wallet opens in Chrome's side panel by default;
  popup mode can be chosen under Settings → Preferences.
- **i18n & theming** — 12 interface languages (English, Turkish, Spanish, Portuguese
  (Brazil), Russian, Simplified Chinese, Vietnamese, Indonesian, Korean, Japanese,
  German, French), auto-detected from the browser and changeable under Settings →
  Preferences; light/dark theme.

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
`src/data/supported_chains.json` (also used by the account scan on import, which
sends derived public addresses only), the Trust Wallet asset repository
(`raw.githubusercontent.com`) for token logos that are not bundled, SilentSwap
(`api.silentswap.com`) for Private Account transfers (it receives the source and
recipient addresses and the amount of each order), and, for xStocks, the CoW Protocol API
(`api.cow.fi`, which receives the order and quote data, including the wallet address)
and the issuer's public asset status endpoint (`api.xstocks.fi`, which receives no user
data). The wallet sends no usage statistics: a daily ping exists in the source but is
switched off in release builds.
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

- The suite has 727 test files and 17,021 tests. A run of `npm run test:az-bellek`
  (two workers) at the v1.10.0 tag of this repository finished with 5 failing tests,
  and 9 of the 727 test files failed. All nine are
  cross-repository contract tests: they read the maintainers' test dApp page, backend
  source or internal documents from the private repository, which are not part of this
  repository. `src/testDappSolana.test.js`, `src/testDappTon.test.js`,
  `src/utils/routerManifest.test.js` and
  `src/utils/privacy/privateRequestCoverage.test.js` fail to load (0 tests run), and
  one test each fails in `src/utils/nativeToken.test.js`,
  `src/utils/ton/linkedAccounts.test.js`, `src/utils/analyticsPing.test.js`,
  `src/utils/currencyCatalog.test.js` and `src/utils/privacy/deliveryChains.test.js`.
  The full run needs a few GB of free memory.
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
the backend base URLs (`VITE_API_URL`, `VITE_BUNDLER_BASE`), the public SilentSwap
integrator id and the build flags described under [Feature flags](#feature-flags).

To override a value locally, create `.env.development.local` or
`.env.production.local` (both git-ignored). A plain `.env.local` does not work for
these keys: Vite loads the mode-specific files after it, so they win.

```
VITE_API_URL=http://localhost:8000
VITE_BUNDLER_BASE=http://localhost:8000
```

### Feature flags

All flags are strict: only the exact string `true` enables a feature.

| Flag | Release builds | Effect |
|---|---|---|
| `VITE_SOLANA_ENABLED` | `false` | Solana: content script, service-worker actions and the network record |
| `VITE_XSTOCKS_ENABLED` | `true` | xStocks trading through CoW Protocol. When off, every `COW_*` service-worker action is refused |
| `VITE_XSTOCKS_ATS_FEE_ENABLED` | `false` | Paying the xStocks network fee in ATS, with a refund claim. The code is present but not used |
| `VITE_ANALYTICS_ENABLED` | `false` | An anonymous daily usage ping. The code is present but not used |
| `VITE_PRIVACY_ENABLED` | `true` | The Private Account and private mode. When off, the private-mode service-worker actions answer `PRIVACY_DISABLED` |
| `VITE_PRIVATE_ATS_SALE` | `true` | Buying ATS from the Private Account |
| `VITE_PRIVATE_SWAP_BRIDGE` | `true` | Private Swap and Bridge screens (self-transfers into the Private Account through SilentSwap) |
| `VITE_PRIVATE_SEND_CHAINS`, `VITE_PRIVATE_FUND_CHAINS` | all 10 EVM networks | Networks on which private Send and private Fund (add funds) are offered |
| `VITE_SILENTSWAP_INTEGRATOR_ID` | public id | Integrator id sent with SilentSwap orders; not a secret |

When `VITE_SOLANA_ENABLED` is off:

- the Solana content script is not written into the manifest,
- the service worker refuses every Solana action,
- Solana is dropped from the network list.

A production build with `VITE_PRIVACY_ENABLED=true` fails if the integrator id is
empty or malformed, or if the fund-chain list is invalid, lacks BNB Smart Chain or
lists a network that has no Send source (`manifest.config.js`).

The test suite forces the flags on (`vitest.config.js`) so the disabled code stays
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
