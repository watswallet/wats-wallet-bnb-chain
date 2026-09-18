# WATS Wallet — Product Specification

> [`README.md`](README.md) is the quick tour. This document is the detailed specification:
> what the wallet does, for whom, under which constraints, and what is deliberately absent.

| | |
|---|---|
| **Version** | `1.7.0` (`package.json` → drives `manifest.version`) |
| **Platform** | Chrome / Chromium, Manifest V3, `minimum_chrome_version: 115` |
| **Custody** | Self-custodial. Keys are generated on-device and never leave it. |
| **This repository** | Extension client only. The backend it talks to is not part of this repository (§7). |
| **License** | [MIT](LICENSE) · Security policy: [SECURITY.md](SECURITY.md) |

---

## 1. Overview

WATS Wallet is a self-custodial multi-chain crypto wallet shipped as a browser extension. A single BIP-39 seed phrase produces accounts across three virtual machines — **EVM**, **TON** and **Solana** — sharing one account index, so "Account 2" is the same person on every chain.

Beyond the usual send / receive / swap surface, the wallet targets three problems that most wallets leave to the user:

1. **You need the native coin to move your own money.** The wallet can pay network fees in a token, so a user holding only USDT on Polygon can still transact.
2. **You cannot tell a real recipient from a poisoned one.** Every outgoing address is screened for address-poisoning lookalikes and against a reputation feed before the confirm button goes live.
3. **Each chain wants its own wallet.** EVM, TON and Solana dapps all reach the same account set through the protocol each ecosystem expects.

### 1.1 Design principles

| Principle | What it means in practice |
|---|---|
| **The backend is optional** | No server response may block spending. Price, history, reputation and news all fail *open* to a degraded-but-working screen. |
| **Fail-closed on authority, fail-open on advice** | Permission gates (which origin, which chain, which account) reject on doubt. Advisory data never rejects. |
| **The client keeps its own copy of safety-critical constants** | Paymaster, collector and router addresses are pinned client-side, so a compromised or confused backend cannot redirect funds. |
| **Extension code cannot hold a secret** | Anything requiring an API key lives behind the backend. The bundle ships no third-party credentials. |
| **Every money-critical decision is a pure, tested function** | Fee maths, route selection, commission regions and recipient matching live in network-free modules with unit tests, not inside components. |

---

## 2. Scope

### 2.1 In scope

- Browser-extension wallet for desktop Chromium browsers.
- Self-custodial key management: creation, import, export, encryption, lock.
- Multi-VM asset management: EVM chains, TON, Solana.
- Transfers, same-chain swaps, cross-chain bridging.
- Fee abstraction (paying gas in a token) on supported chains.
- Dapp connectivity for all three ecosystems.

### 2.2 Out of scope (explicit non-goals)

- **The backend.** This repository is the client. The hosted API is a separate service (§7).
- **Mobile and desktop-native apps.** Separate codebases; nothing verified here carries over to them.
- **Hardware-wallet signing.** No Ledger/Trezor transport.
- **Custodial or MPC key storage.** There is no recovery path that does not involve the user's own seed phrase.
- **Passkey/WebAuthn as a signing key.** Rejected by design: Solana and TON cannot verify a P-256 signature, and PRF support is incomplete — losing PRF would mean losing funds. A passkey may only ever unlock a locally stored vault.
- **Fiat off-ramp, staking, NFTs.** Not implemented.

---

## 3. Surfaces

| Surface | Entry point | Purpose |
|---|---|---|
| **Popup** | `src/popup/` | Main wallet UI. Single page, routed through `pageStore`. |
| **Onboarding tab** | `src/onboarding/`, `onboarding.html` | Opens as a full tab on first install — creation and import need more room than a popup. |
| **Approval window** | popup route, standalone window | Dapp connection, signature and transaction approvals. Serialized so two dapps cannot race. |
| **Service worker** | `src/background.js` | Session and lock state, dapp request routing, account derivation, chain writes. |
| **Content script** | `src/content.js` (isolated world) | Relay between page and worker. `<all_urls>`, all frames. |
| **Page providers** | `src/injected.js`, `src/tonInjected.js`, `src/solanaInjected.js` | Registered in the page's MAIN world at `document_start`, so the provider exists before any page script runs. |

**Permissions requested:** `storage`, `alarms`, `tabs`, plus `host_permissions: <all_urls>`.

**Why MAIN-world injection.** The earlier approach had `content.js` append a `<script src>` tag. A `src` script loads asynchronously, so the provider could be created *after* the page's own scripts had already run — and a dapp's first probe reported "no wallet". A `world: "MAIN"` content-script registration is executed by the browser before any page script (Chrome 111+; the minimum here is 115).

**Why the Solana bridge is narrower.** Solana sessions are keyed by **full origin**, so the Solana script is injected only into `https://` and localhost, top frame only. Injecting into `http://` would open an authority surface confusable with the same host's `https://` session, and allowing iframes would let the approving site differ from the one in the address bar. That scope is enforced a second time, fail-closed, in the background handler — the generic relay content script runs on all frames and schemes, so the manifest scope alone protects only the injection point, not the dispatcher.

---

## 4. Account & key model

### 4.1 One seed, three chains

| Chain | Curve | Standard | Derivation path |
|---|---|---|---|
| EVM (all chains) | secp256k1 | BIP-32 | `m/44'/60'/0'/0/{i}` |
| Solana | Ed25519 | SLIP-10 | `m/44'/501'/{i}'/0'` |
| TON | Ed25519 | SLIP-10 | `m/44'/607'/{i}'` |

The account index `{i}` is shared. TON accounts use contract version **V5R1 (W5)**, and the version is written into the account record rather than read from config — if a V6 ships tomorrow, existing accounts must keep their addresses.

Two properties of TON that shape the UI:

- **The same keypair under a different contract version is a different address.** V5R1 and V4 of one key are two distinct accounts. Import therefore probes several contract versions rather than assuming one.
- **On W5 the network id is inside the contract.** Mainnet and testnet are not just an encoding difference; deriving without the network id produces a valid-looking address that belongs to neither.

### 4.2 Vaults and accounts

- Multiple **vaults** (each one seed phrase), multiple **accounts** per vault.
- Accounts can be created, renamed and switched; a switch applies across all chains at once.
- **Imported** accounts (a single private key, or a TON-native mnemonic) live outside the HD tree, are labelled as such, and need their own backup.
- Reveal flows for mnemonic, EVM private key and **raw TON key** are each gated behind password re-entry plus an explicit acknowledgement screen. The TON raw-key export exists because of the portability limit in §10.

### 4.3 Storage & encryption

- Private material is encrypted at rest with a key derived from the user's password; plaintext exists only in the unlocked session.
- An activity heartbeat drives a user-configurable **auto-lock timer**. On expiry the session is dropped and the UI returns to the unlock screen.
- A pending dapp request survives a lock: after unlocking, the user lands on the relevant approval screen rather than on the home screen.
- Password change re-encrypts the vault. "Reset app" clears all local state.

---

## 5. Supported networks

| Chain | ID | VM | Native |
|---|---|---|---|
| Ethereum | 1 | EVM | ETH |
| BNB Smart Chain | 56 | EVM | BNB |
| Optimism | 10 | EVM | ETH |
| Polygon | 137 | EVM | POL |
| Arbitrum One | 42161 | EVM | ETH |
| Base | 8453 | EVM | ETH |
| Gnosis | 100 | EVM | XDAI |
| Celo | 42220 | EVM | CELO |
| Mantle | 5000 | EVM | MNT |
| Cronos | 25 | EVM | CRO |
| TON | −239 | TON | TON |
| TON Testnet | −3 | TON | TON |
| Solana | `solana-mainnet` | Solana | SOL |

**Custom EVM networks.** Beyond the curated list, `src/data/chain-list.json` carries 2000+ EVM chain records for manual network addition. Curated chains get logos, token lists, swap routers and fee abstraction; custom ones get transfers only.

**RPC selection.** For each EVM chain the candidate RPC endpoints are raced and the fastest wins. A connectivity watcher retries on drop, so a dead public node costs latency rather than breaking the wallet.

---

## 6. Feature catalogue

### 6.1 Onboarding

Opens automatically as a full tab on install.

1. Create a new wallet — BIP-39 phrase generation, then a verification step requiring the user to reproduce it.
2. Or import — seed phrase, or a single private key.
3. Choose a username (uniqueness checked server-side).
4. Set a password; the encrypted vault is created.

### 6.2 Portfolio / home

- Per-token balances and total portfolio value.
- Token detail page with a price-history chart, served through the backend so no API key reaches the client. Chart failure shows "no price history" and never blocks the page.
- Token import by contract address, and token search across the chain's list.
- Token logos from the Trust Wallet CDN, with a monogram fallback.
- A **network scope** control: view one chain, or all of them at once.
- A **news strip** for announcements, served from the backend. Text is rendered as text, never as HTML — the content is outside the client's control, so a malformed record must not be able to do more than look wrong.

### 6.3 Send

- Native coin and token transfers on EVM, TON (including jettons) and Solana.
- Live gas estimation, a percentage/MAX helper, and a native-reserve guard that stops the user from spending the coin they need for the fee.
- A confirmation screen showing recipient identity, amount, fee and USD value, followed by live transaction status.
- **Address book** of saved recipients, plus recently-used and previously-sent recipients.
- **Own-account transfers** resolve to the account's name instead of a raw address.

### 6.4 Recipient safety

Two independent checks run before the confirm button goes live.

- **Address-poisoning detection.** The attack: a dust or zero-value transfer is dropped into the victim's history from a fake address whose first and last characters match a real recipient. The user copies it from history, the shortened form looks identical, and the money goes to the attacker. The comparison window is therefore exactly what the user *sees* — the first 6 and last 4 characters that `shortenAddress` renders. A wider threshold would miss most real attacks, because the attacker only forges what is visible. All three address formats are covered: EVM hex (case-insensitive, since the checksum is visual only), Solana base58 and TON base64url (both case-sensitive).
- **Reputation / phishing screening.** The backend proxies a reputation feed and returns a severity. The client recognises only `block` and `warn`; an unknown value is never escalated into a block. **Fail-open:** if the service is unreachable the answer is "unknown", never "dangerous". A third-party outage freezing a wallet is a larger harm than the one being prevented.

### 6.5 Receive

QR code plus copyable address, per chain.

### 6.6 History

Per-chain transaction history through the backend, grouped by date, with counterparty names resolved from the address book and the user's own accounts. Pending transactions appear immediately and reconcile when confirmed.

### 6.7 Swap

- **EVM:** same-chain token swaps on all 10 curated EVM chains, routing over Uniswap V2/V3-style and PancakeSwap routers. Direct and one-hop paths are both quoted. V3 fee tiers are read from the factory rather than hard-coded, and the correct router variant is selected per DEX — `SwapRouter` takes a `deadline` in its struct and `SwapRouter02` does not, and the wrong choice reverts on-chain without failing at quote time.
- **TON:** swaps via STON.fi. The swap message is built by the STON.fi SDK rather than hand-assembled, because the `TON → jetton` direction uses a different mechanism per router version, and the router is not fixed — it arrives in the quote response.
- Slippage and deadline are user-configurable.
- Router, factory and quoter addresses are verified on-chain and re-verifiable with `npm run verify:routers`. They are not edited by hand.

### 6.8 Bridge

Cross-chain asset movement, with source/destination chain and token selection and its own settings panel.

### 6.9 Gas abstraction — paying fees in a token

Two independent mechanisms.

**A. ATS paymaster — transfer fees paid in ATS**

Chains: Ethereum, Optimism, Cronos, BNB Smart Chain, Gnosis, Polygon, Mantle, Base, Arbitrum One, Celo.

The fee is **always collected in ATS on BNB Smart Chain (56)**, because that is the only chain where the user's real ATS balance lives. On every other chain, collection is **cross-chain**: the operation is sponsored on the target chain while the fee is pulled on BSC through a collector contract.

Two design points worth stating explicitly, because both were paid for in production incidents:

- **Whether collection is cross-chain depends on the chain alone.** It is not derivable from the backend's sponsorship `mode`, which describes *how* the target chain is sponsored, not *where* the fee is taken. The two are orthogonal; conflating them produced pre-flight checks that never ran, screens that showed one fee while another was charged, and budgeted gas that was paid but never refunded.
- **Paymaster and collector addresses are pinned in the client.** If the backend returns a different paymaster, the send halts. Taking the address from the backend would have made that check a tautology — an unlimited approval would go to the wrong spender, the allowance would never register, and every attempt would revert while the paymaster paid gas and collected nothing.

Gas limits are estimated per operation rather than capped at a constant; a fixed ceiling was measured to use only ~18% of the budget on cross-chain routes, with no refund.

**B. ERC-4337 / EIP-7702 smart account — gasless**

Chains: Ethereum, BNB Smart Chain, Base, Optimism, Arbitrum One, Polygon.

An EIP-7702 delegated EOA plus an ERC-20 paymaster (EntryPoint v0.8, via `permissionless`), letting the user pay gas in a chosen ERC-20 instead of the native coin. A gas-token selector appears both in the send flow and inline on dapp approval screens, per-dapp opt-in.

The backend proxies the bundler: it hides the provider API key, enforces a chain and token allowlist, applies signature-verified token auth with nonce replay protection, and layers IP / hourly / daily rate limits.

**C. Swap/bridge commission**

A commission layer exists for swap and bridge operations, with a region rule — `local` on BSC, `src` on spoke chains — taken from the backend's `collection` field rather than a client-side chain rule. A client rule that drifted from the server's configuration would lose money in both directions: double-charging on a spoke chain, or producing an operation the server rejects on BSC. The commission is currently configured at **zero**, and the layer reproduces today's behaviour exactly at that value.

### 6.10 Dapp connectivity

| Ecosystem | Protocol | Implemented |
|---|---|---|
| EVM | EIP-1193 (`window.ethereum`) | Connect, message signing, transaction approval |
| TON | TonConnect | Connect + TON Proof, `sendTransaction`, `signData` |
| Solana | Wallet Standard (`window.solana`) | Connect, disconnect, events — **signing not implemented in this repository** (§10) |

- Approval requests are serialized; concurrent dapp requests queue instead of racing.
- **Permission management:** connected dapps are listed with their granted permissions, and access can be revoked per origin.
- **Cross-VM routing.** A user sitting on a TON account can still connect to an EVM dapp; the request is routed to the right VM rather than rejected.

### 6.11 Settings, localisation and theme

- **Languages:** English and Turkish, auto-detected, with extension metadata localised through `_locales`.
- **Theme:** light / dark.
- Sections: Preferences, Security, Wallets & accounts, Address book, Dapp permissions, Profile, About.

---

## 7. Backend contract

The backend is **not in this repository**. It exists because extension code is public by nature and cannot hold a secret: every third-party API key stays server-side.

Endpoints the client calls, by purpose:

| Purpose | Endpoints |
|---|---|
| Token metadata, search, price | `/getTokenDataById`, `/getTokensDataById`, `/getChainTokens`, `/getTokenByName`, `/getTokenByAddress`, `/getImportedTokens`, `/getRates` |
| Price chart | `/getTokenPriceHistory` |
| Profile and username | `/profile`, `/checkUsername`, `/profile/changeUsername`, `/profile/getProfile` |
| History | `/wallet/history`, `/ton/history`, `/solana/history` |
| Recipient screening | `/wallet/reputation` |
| Announcements | `/news` |
| Gasless | `/bundler/auth`, `/rpc/:chainId` |
| Chain RPC proxies | `/ton/rpc`, `/ton/swap/simulate`, `/solana/rpc`, `/solana/tokens` |

**The contract the client assumes.** Read paths may fail; the UI degrades. Write paths are rate-limited and, for chain writes, authenticated with a token derived from the user's own EOA signature. The backend never holds a key, never signs on the user's behalf, and cannot move funds.

---

## 8. Configuration

`.env.development` and `.env.production` are committed and hold no secrets — only the backend base URL:

| Variable | Meaning |
|---|---|
| `VITE_API_URL` | Base URL for token, profile, history, reputation and news endpoints |
| `VITE_BUNDLER_BASE` | Base URL for the bundler/paymaster proxy |

Create `.env.local` to override either without touching the committed files.

---

## 9. Quality bar

- **237 test files** run with Vitest (`npm test`).
- Money-critical logic is extracted into **network-free pure modules** — fee maths, route selection, commission regions, recipient matching, swap validation, ATS quoting — so it can be unit-tested without an RPC or a live operation. Embedded in components, these could only ever be verified by spending real money.
- **On-chain verification instead of trusted constants.** `npm run verify:routers` re-checks every swap router, factory and quoter against the chain: bytecode presence, `router.factory()` agreement, V2 pool reserves and `getAmountsOut`, V3 quoter signature. Fee values were measured against the constant-product formula, not copied from documentation.
- **Manual browser verification is a separate gate.** A green test suite is not a release signal: MV3 service-worker behaviour and provider injection are only provable in a real browser. Node-only tests pass on code paths that fail inside a service worker, where `window` does not exist.

---

## 10. Known limitations

| # | Limitation |
|---|---|
| 1 | **Solana dapp signing is not implemented here.** The Wallet Standard descriptor advertises `signTransaction`, `signAndSendTransaction`, `signMessage` and `signIn`, but only connect, disconnect and events have handlers in this repository. A dapp reading the feature list will expect more than it gets. |
| 2 | **`window.ethereum` is claimed only when the slot is empty.** With another EVM wallet installed, a dapp may never reach WATS. |
| 3 | **TON accounts at index ≥ 1 are not portable by phrase.** Tonkeeper's BIP-39 path is pinned to index 0, so higher indices can only be migrated with the raw Ed25519 key — which is why that export exists (§4.2). |
| 4 | **TON contract version changes the address.** The same keypair under V4 and V5R1 yields different addresses, and on W5 the network id lives inside the contract, so a mainnet/testnet mix-up produces a valid-looking wrong address. |
| 5 | **No hardware-wallet support and no non-seed recovery path.** Losing the seed phrase and the password means losing the wallet. |

---

## 11. Glossary

| Term | Meaning |
|---|---|
| **Vault** | One seed phrase and the accounts derived from it. A user may hold several. |
| **Account index** | The shared `{i}` in the derivation paths; one index = one identity across EVM, TON and Solana. |
| **ATS** | The token in which transfer fees are collected. Always settled on BNB Smart Chain. |
| **Cross-chain collection** | Sponsoring an operation on the target chain while pulling the fee on BSC. |
| **Fail-open / fail-closed** | Advisory services degrade to "unknown" and let the user proceed; authority gates reject on doubt. |
| **Jetton** | A fungible token on TON, the equivalent of an ERC-20. |
| **W5 / V5R1** | The TON wallet contract version used for derived accounts. |

---

*Source comments and internal design notes in this repository are written in Turkish; see [`README.md`](README.md#contributing).*
