# WATS Wallet — Product Specification

> [`README.md`](README.md) is the quick tour. This document is the detailed specification:
> what the wallet does, for whom, under which constraints, and what is deliberately absent.

| | |
|---|---|
| **Version** | `1.7.0` (`package.json` → drives `manifest.version`) |
| **Platform** | Chrome / Chromium, Manifest V3, `minimum_chrome_version: 115` |
| **Custody** | Self-custodial. Keys are generated on-device and never leave it. |
| **This repository** | Extension client only. The services it talks to are not part of this repository (§7). |
| **License** | [MIT](LICENSE) · Security policy: [SECURITY.md](SECURITY.md) |

---

## 1. Overview

WATS Wallet is a self-custodial multi-chain crypto wallet shipped as a browser extension. A single BIP-39 seed phrase gives every account index an **EVM** account and a **TON** account, so "Account 2" is the same person on every supported chain. Solana derivation, transfers and dapp signing are also in the code, but they are switched off in release builds by the `VITE_SOLANA_ENABLED` build flag (§8).

Beyond the usual send / receive / swap surface, the wallet targets three problems that most wallets leave to the user:

1. **You need the native coin to move your own money.** The wallet pays network fees in ATS, collected on BNB Smart Chain, on all ten curated EVM chains, and on TON when the fee relay is active. A user who holds no ETH, POL, BNB or GRAM can still transact as long as they hold ATS on BNB Smart Chain.
2. **You cannot tell a real recipient from a poisoned one.** Every recipient entered in the wallet's own Send flow is checked for address-poisoning lookalikes (EVM and TON) and, for EVM addresses, against a reputation feed before the confirm button goes live. Transactions requested by dapps are not screened.
3. **Each chain wants its own wallet.** EVM dapps (EIP-1193 / EIP-6963) and TON dapps (TonConnect) reach the same account set through the protocol each ecosystem expects.

### 1.1 Design principles

| Principle | What it means in practice |
|---|---|
| **Advisory backends are optional** | Price, history, reputation and news all fail *open* to a degraded-but-working screen. **Exception, by design:** on the ten curated EVM chains the network fee is always paid in ATS through the ATS paymaster service. If that service cannot quote, or the user's ATS balance or allowance is insufficient, the transaction is blocked — it never silently falls back to a native-gas fee the user did not see. On TON, when the relay is off, the user pays in GRAM. |
| **Fail-closed on authority, fail-open on advice** | Permission gates (which origin, which chain, which account) reject on doubt. Advisory data never rejects. |
| **The client keeps its own copy of safety-critical constants** | Paymaster, collector and router addresses are pinned client-side, so a compromised or confused backend cannot redirect funds. |
| **Extension code cannot hold a secret** | Anything requiring an API key lives behind the backend. The bundle ships no third-party credentials. |
| **Every money-critical decision is a pure, tested function** | Fee maths, route selection, commission regions and recipient matching live in network-free modules with unit tests, not inside components. |

---

## 2. Scope

### 2.1 In scope

- Browser-extension wallet for desktop Chromium browsers.
- Self-custodial key management: creation, import, export, encryption, lock.
- Multi-VM asset management: EVM chains and TON. Solana support is present in the code but disabled in release builds (`VITE_SOLANA_ENABLED=false`).
- Tokenized-stock certificates (bStocks) on BNB Smart Chain.
- Transfers, same-chain swaps, cross-chain bridging between EVM chains.
- Fee abstraction (paying network fees in ATS) on supported chains.
- Dapp connectivity for EVM (EIP-1193 / EIP-6963) and TON (TonConnect). Solana (Wallet Standard) is implemented but disabled in release builds.

### 2.2 Out of scope (explicit non-goals)

- **The backend.** This repository is the client. The hosted API and the ATS paymaster service are separate services (§7).
- **Mobile and desktop-native apps.** Separate codebases; nothing verified here carries over to them.
- **Hardware-wallet signing.** No Ledger/Trezor transport.
- **Custodial or MPC key storage.** There is no recovery path that does not involve the user's own seed phrase.
- **Passkey/WebAuthn as a signing key.** Rejected by design: Solana and TON cannot verify a P-256 signature, and PRF support is incomplete — losing PRF would mean losing funds. A passkey may only ever unlock a locally stored vault.
- **Custom networks.** Only the curated chains in §5 are supported; `wallet_addEthereumChain` is refused.
- **Fiat off-ramp, staking, NFTs.** Not implemented.

---

## 3. Surfaces

| Surface | Entry point | Purpose |
|---|---|---|
| **Side panel** (default) | `src/sidepanel/` | Main wallet UI in Chrome's side panel. Same Vue app as the popup (shared bootstrap in `src/shared/bootstrap.js`), routed through `pageStore`. Panels open in several windows keep network and account in sync. |
| **Popup** | `src/popup/` | The same UI as a popup. Used when the user picks popup mode in Settings → Preferences, or when the browser has no Side Panel API. |
| **Onboarding tab** | `src/onboarding/`, `onboarding.html` | Full-tab creation and import flow. While no wallet exists, clicking the toolbar icon opens this tab (or brings an existing one forward) instead of the panel. In browsers without the Side Panel API the popup opens briefly, opens a new onboarding tab and closes itself. Settings → Add wallet opens it on the chosen import screen. |
| **Approval window** | popup route, standalone window | Dapp connection, signature and transaction approvals, one at a time. A new request closes the open approval window and rejects the request it was showing (4001 "Request replaced by a new one"); a request that arrives while a window is opening is rejected (4001). Two dapps therefore never share or race one approval window. Approvals never render inside the side panel. |
| **Service worker** | `src/background.js` | Session and lock state, dapp request routing, account derivation, chain writes. |
| **Content script** | `src/content.js` (isolated world) | Relay between page and worker. `<all_urls>`, all frames. |
| **Page providers** | `src/injected.js`, `src/tonInjected.js` (always); `src/solanaInjected.js` (only when built with `VITE_SOLANA_ENABLED=true`, which release builds are not) | Registered in the page's MAIN world at `document_start`, so the provider exists before any page script runs. |

**Permissions requested:** `storage`, `alarms`, `tabs`, `sidePanel`, plus `host_permissions: <all_urls>`. The manifest also declares a `side_panel` page.

**Why MAIN-world injection.** The earlier approach had `content.js` append a `<script src>` tag. A `src` script loads asynchronously, so the provider could be created *after* the page's own scripts had already run — and a dapp's first probe reported "no wallet". A `world: "MAIN"` content-script registration is executed by the browser before any page script (Chrome 111+; the minimum here is 115).

**Why the Solana bridge is narrower (only when Solana is enabled at build time).** Solana sessions are keyed by **full origin**, so when `VITE_SOLANA_ENABLED=true` the Solana script is injected only into `https://` and localhost, top frame only. Injecting into `http://` would open an authority surface confusable with the same host's `https://` session, and allowing iframes would let the approving site differ from the one in the address bar. That scope is enforced a second time, fail-closed, in the background handler — the generic relay content script runs on all frames and schemes, so the manifest scope alone protects only the injection point, not the dispatcher. In release builds the script is not registered at all, and the background dispatcher refuses every Solana action.

---

## 4. Account & key model

### 4.1 One seed, every chain

| Chain | Curve | Scheme | Derivation |
|---|---|---|---|
| EVM (all chains) | secp256k1 | BIP-32 | `m/44'/60'/0'/0/{i}` |
| TON | Ed25519 | TON-native mnemonic | A per-account 24-word TON phrase derived from the master seed (below) |
| Solana (disabled in release builds) | Ed25519 | SLIP-10 | `m/44'/501'/{i}'/0'` |

**TON phrase derivation.** `root = HMAC-SHA512(key = "wats/ton-from-seed/v1", data = BIP-39 seed (empty passphrase) ‖ index as 32-bit big-endian)`. For counter values 0, 1, 2, … (at most 4096 tries) the wallet computes `HMAC-SHA512(key = root, data = counter as 32-bit big-endian)`. It reads the first 264 bits of that output, most significant bit first, as 24 × 11-bit indices into the 2048-word TON word list (`mnemonicWordList` from `@ton/crypto`), and takes the first result that is a valid password-less TON phrase. The TON key comes from that phrase. Because it is an ordinary TON phrase, it can be exported and opened in other TON wallets at any account index. The domain string is frozen: changing it would give the same master phrase different TON addresses.

TON addresses written by earlier builds under the old SLIP-10 path (`m/44'/607'/{i}'`) are re-derived under the new scheme the next time the account's TON address is resolved. The first replaced address is kept in the account record (`tonAddressLegacy`) and is not shown in the UI. Known issue: if that first resolution happens on TON Testnet, the old mainnet address is not re-derived and mainnet TON signing fails with `TON_ADDRESS_MISMATCH` (§10).

The account index `{i}` is shared. TON accounts use contract version **V5R1 (W5)**. The version is fixed in code: `tonWalletContract` (`src/utils/ton/tonAccount.js`) is the only W5 factory and always builds V5R1. It is not stored per account — the record's `tonScheme` field stamps the key-derivation scheme, not the contract version — so adding a later contract version would first require recording the version per account, or existing accounts would change address.

Two properties of TON that shape the UI:

- **The same keypair under a different contract version is a different address.** V5R1 and V4 of one key are two distinct accounts. Import therefore checks the phrase's W5, v4R2 and v3R2 addresses on-chain. The wallet signs only for W5, so if the funds sit only in an older version, the import is blocked with an explanation instead of opening an empty W5 address.
- **On W5 the network id is part of the wallet contract's initial state.** The same key has different mainnet and testnet addresses. `@ton/ton` defaults the id to mainnet (−239), so deriving a testnet address without passing the network id silently produces the mainnet address. `tonWalletContract` always passes it explicitly.

### 4.2 Vaults and accounts

- Multiple **vaults** (each one seed phrase), multiple **accounts** per vault.
- Accounts can be created, renamed and switched; a switch applies across all chains at once.
- **Private-key imports** (one secp256k1 key) live outside the HD tree and are EVM-only (no TON address). Their vault is labelled "Private Key" in Settings → Create account, but the account list shows them with the same EVM badge as HD accounts. They need their own backup.
- **TON-phrase imports** (a Tonkeeper-style 24-word phrase) become a normal account with both TON and EVM. TON comes from the imported phrase; EVM comes from a BIP-39 phrase derived deterministically from it, so the TON phrase alone restores both.
- Reveal flows for the master mnemonic, the EVM private key and the **TON key** are each gated behind password re-entry plus an explicit acknowledgement screen. For accounts whose TON key is derived from the master seed, the TON key screen shows both the raw Ed25519 secret key (64-byte seed‖public-key form, hex) and the account's derived 24-word TON phrase; entering that phrase in another TON wallet (W5 version) opens the same address. For TON-phrase imports the screen shows only the raw key.
- Screens that reveal an existing secret (master mnemonic, EVM private key, TON key) clear themselves when the wallet surface is hidden and after 60 seconds. The screens that show a freshly generated phrase (onboarding, Settings → Create account) have no such timer. This matters because the side panel, unlike a popup, does not close when it loses focus.

### 4.3 Storage & encryption

- Private material is encrypted at rest with a key derived from the user's password; plaintext exists only in the unlocked session.
- An activity heartbeat drives a user-configurable **auto-lock timer**. Only user actions in the wallet UI count as activity: pointer and keyboard input (a throttled heartbeat), unlocking, locking, and a wallet surface opening (including an approval window opened by a dapp request). Background quote polling in an open panel therefore does not keep the wallet unlocked. "Immediately" means the wallet locks when the last wallet surface closes (after a 3-second grace period, so a panel reload does not lock it). On expiry the session is dropped and the UI returns to the unlock screen.
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
| TON | −239 | TON | GRAM |
| TON Testnet (development builds only) | −3 | TON | GRAM |
| Solana (disabled in release builds) | `solana-mainnet` | Solana | SOL |

TON's native coin is displayed as **GRAM** (name and symbol); the network is still called TON.

**Only curated networks.** The wallet supports exactly the chains above. `src/data/chain-list.json` (a large public EVM chain list) is still in the tree, but network resolution no longer reads it, and dapp requests to add a chain are refused (§6.10).

**RPC selection.** For each EVM chain the candidate RPC endpoints are raced and the fastest wins. A connectivity watcher retries on drop, so a dead public node costs latency rather than breaking the wallet.

---

## 6. Feature catalogue

### 6.1 Onboarding

Opens as a full tab whenever no wallet exists: clicking the toolbar icon opens it, or focuses an existing onboarding tab. If a side panel is already open, it shows a pointer to the tab with a button to reopen it.

1. Create a new wallet — set a password first. This step generates the BIP-39 phrase and creates the encrypted vault. The phrase is then shown and must be revealed before setup continues.
2. Or import — a BIP-39 seed phrase; a TON-native 24-word phrase (for example from Tonkeeper — the importer probes several contract versions, and a Tonkeeper multi-account root phrase is recognised and explained rather than rejected as invalid); or a single EVM private key (EVM-only account). Then set a password, which creates the encrypted vault.
3. Choose a username (uniqueness checked server-side). The username is stored by the backend together with the account's EVM address.

When onboarding finishes, the wallet opens in the side panel, or in the popup if the user chose popup mode.

### 6.2 Portfolio / home

- Per-token balances and total portfolio value.
- Token detail page with a price-history chart, served through the backend so no API key reaches the client. Chart failure shows "no price history" and never blocks the page.
- Token import by contract address, and token search across the chain's list.
- Token logos are resolved by a shared helper (`src/utils/tokenLogo.js`): the token record's `image` (large, then small, then thumb), then `logoURI`, then `logo`, then a bundled default. The dapp confirmation screen still uses its own order (`logo` first) with a contract placeholder. Where a component uses `TokenLogo`, an image that fails to load falls back to a monogram.
- A **network scope** control: view one chain, or all of them at once.
- A **Stocks** tab for tokenized stocks (§6.12), hidden for accounts that cannot use BNB Smart Chain.
- A **news strip** for announcements, served from the backend. Text is rendered as text, never as HTML — the content is outside the client's control, so a malformed record must not be able to do more than look wrong.

### 6.3 Send

- Native coin and token transfers on EVM and TON (GRAM and jettons, with an optional text comment on TON). Solana transfers are in the code but disabled in release builds.
- A fee figure on every network: a live gas estimate on EVM, a fixed approximate reserve on TON (≈0.01 GRAM, or up to 0.05 GRAM attached for a jetton transfer with the excess refunded), or the ATS fee when the fee is paid in ATS. Its USD value is shown whenever a price is available. There is also a percentage/MAX helper and a reserve guard that stops the user from spending what they need for the fee.
- A confirmation screen showing recipient identity, amount, fee and USD value, followed by live transaction status.
- **Address book** of saved recipients, plus recently-used and previously-sent recipients.
- **Own-account transfers** resolve to the account's name instead of a raw address.
- For tokenized stocks the displayed amount is scaled (§6.12); the amount the user enters, including MAX, is converted back to raw token units before sending.

### 6.4 Recipient safety

Two independent checks run in the wallet's own Send flow before the confirm button goes live. Transactions requested by dapps are not screened.

- **Address-poisoning detection.** The attack: a dust or zero-value transfer is dropped into the victim's history from a fake address whose first and last characters match a real recipient. The user copies it from history, the shortened form looks identical, and the money goes to the attacker. The comparison window is therefore exactly what the user *sees* — the first 6 and last 4 characters that `shortenAddress` renders. A wider threshold would miss most real attacks, because the attacker only forges what is visible. All three address formats are covered: EVM hex (case-insensitive, since the checksum is visual only), Solana base58 and TON base64url (both case-sensitive).
- **Reputation / phishing screening (EVM addresses only).** The backend proxies a reputation feed and returns a severity. The client recognises only `block` and `warn`; an unknown value is never escalated into a block. Solana addresses are shown as "not checked on this network". TON addresses are not sent for screening, so on TON only the address-poisoning check applies. **Fail-open:** if the service is unreachable, the result is treated as no finding — no warning is shown, exactly as for a clean address — and never as "dangerous". A third-party outage freezing a wallet is a larger harm than the one being prevented.

### 6.5 Receive

QR code plus copyable address, per chain.

### 6.6 History

Per-chain transaction history through the backend, grouped by day (Today / Yesterday / date), with counterparty names resolved from the address book and the user's own accounts. Row titles use the provider's summary when one exists (on TON, the transfer comment); otherwise, and always for pending rows, the row gets a localized type label: send, receive, token send, token swap, approval, cross-chain transfer or self transfer. Pending transactions appear immediately in an in-progress indicator and reconcile when confirmed.

### 6.7 Swap

- **EVM:** same-chain token swaps on all 10 curated EVM chains, routing over Uniswap V2/V3-style and PancakeSwap routers. On V2 DEXes both the direct path and paths through one intermediate token are quoted; V3 DEXes are quoted on the direct path only, across that DEX's fee tiers. V3 fee tiers are configured per DEX instead of one list for every DEX (for example PancakeSwap V3's 2500 tier, Base Uniswap's 200/400); the values were read from each factory's `feeAmountTickSpacing` when the config was written, and DEXes without an entry use the default 100/500/3000/10000. The correct router variant is selected per DEX — `SwapRouter` takes a `deadline` in its struct and `SwapRouter02` does not, and the wrong choice reverts on-chain without failing at quote time.
- **TON:** swaps via STON.fi. The swap message is built by the STON.fi SDK rather than hand-assembled, because the `TON → jetton` direction uses a different mechanism per router version, and the router is not fixed — it arrives in the quote response. Before the message is built, the client checks that the quote is fresh and matches the user's request (pair, amount, price impact). When the fee is paid in ATS through the relay, the client also decodes the server-built wallet message and compares it with the request before signing.
- **Price impact.** V3 routes compute real price impact. When the measured impact is above 5% the swap needs explicit confirmation; on TON the service worker enforces this as well, while on EVM a route whose impact cannot be measured is not gated. The swap button stays disabled until a quote exists.
- Slippage is user-configurable (0.5%, 1% or a custom value up to 50%). The on-chain swap deadline is fixed at 10 minutes.
- Router, factory and quoter addresses are verified on-chain and re-verifiable with `npm run verify:routers`. They are not edited by hand.
- On ATS chains the swap's network fee is paid in ATS (§6.9).

### 6.8 Bridge

Cross-chain movement between the curated EVM chains through LI.FI, with source/destination chain and token selection and its own settings panel. TON is deliberately not bridgeable: LI.FI carries no TON, and a jetton-only bridge that cannot move GRAM was rejected. Tokenized stocks exist only on BNB Smart Chain and cannot be bridged out: they are filtered out of the source-token picker, the Bridge button on their detail page is disabled with an explanation, and quotes that use one as the source token are refused. On ATS chains the bridge's network fee is paid in ATS.

### 6.9 Fee abstraction — paying network fees in ATS

**A. ATS paymaster: network fees paid in ATS**

EVM chains: Ethereum, Optimism, Cronos, BNB Smart Chain, Gnosis, Polygon, Mantle, Base, Arbitrum One, Celo. ATS covers the user's own sends, swaps and bridges, and dapp transactions. On these chains ATS is mandatory and does not fall back to native gas. For dapp transactions, the dapp receives the on-chain transaction hash, not the UserOperation hash.

The fee is **always collected in ATS on BNB Smart Chain (56)**, because that is the only chain where the user's real ATS balance lives. On every other chain, collection is **cross-chain**: the operation is sponsored on the target chain while the fee is pulled on BSC through a collector contract. Before first use, a setup on BNB Smart Chain approves the paymaster (unlimited ATS allowance) and gives the collector a bounded ATS allowance (a gas budget). When that budget runs low, the wallet asks for one more approval to refresh it.

Two design points worth stating explicitly, because both were paid for in production incidents:

- **Whether collection is cross-chain depends on the chain alone.** It is not derivable from the backend's sponsorship `mode`, which describes *how* the target chain is sponsored, not *where* the fee is taken. The two are orthogonal; conflating them produced pre-flight checks that never ran, screens that showed one fee while another was charged, and budgeted gas that was paid but never refunded.
- **Paymaster and collector addresses are pinned in the client**, and the one-time unlimited approval always goes to the pinned paymaster. The paymaster returned by `/sponsor` must be in an allowlist made of the pinned addresses plus any the service's `/health` advertises for that chain (if `/health` is unreachable, the pinned table alone applies); a paymaster outside that set halts the send before signing. Taking the approval spender from the backend would have made the check a tautology — an unlimited approval would go to the wrong spender, the allowance would never register, and every attempt would revert while the paymaster paid gas and collected nothing.

Gas limits are estimated per operation rather than capped at a constant; a fixed ceiling was measured to use only ~18% of the budget on cross-chain routes, with no refund.

**TON.** When the fee relay is active and the account also holds an EVM key, the following can be paid in ATS: GRAM sends (including comments), jetton sends, STON.fi swaps, and TonConnect dapp transactions that are plain transfers or calls to whitelisted routers without `stateInit`. Other dapp contract calls are paid in GRAM. The fee is authorised by an EIP-712 `TonFeeAuth` signature whose domain (chain 56, collector contract) is pinned client-side. When the relay is off, the user pays in GRAM.

The fee is shown on one shared ATS fee card with the ATS logo and a USD equivalent.

**B. ERC-4337 / EIP-7702 ERC-20 paymaster (dormant)**

Code for an ERC-20 paymaster path (EIP-7702 delegated EOA, EntryPoint v0.8, via `permissionless` through the backend's bundler proxy) remains for Ethereum, BNB Smart Chain, Base, Optimism, Arbitrum One and Polygon. In 1.7.0 it is dormant: all six are ATS chains, and the fee rule (`atsFee.pickFeeBranch`) picks ATS first for the send flow and for dapp approvals, so the ERC-20 gas-token selector is not shown. The per-dapp "gasless" toggle still appears in dapp permissions but has no effect on these chains. The wallet no longer offers a button to revoke the EIP-7702 delegation.

The backend proxies the bundler: it hides the provider API key, enforces a chain and token allowlist, applies signature-verified token auth with nonce replay protection, and layers IP / hourly / daily rate limits.

**C. Swap/bridge commission**

A commission layer exists for swap and bridge operations, with a region rule — `local` on BSC, `src` on spoke chains — taken from the backend's `collection` field. The client's own chain rule is used only as a fallback when an older server omits that field. A client rule that drifted from the server's configuration would lose money in both directions: double-charging on a spoke chain, or producing an operation the server rejects on BSC. When a commission is configured, it is included in the single ATS total shown on the swap and bridge fee cards, not as a separate line.

### 6.10 Dapp connectivity

| Ecosystem | Protocol | Implemented |
|---|---|---|
| EVM | EIP-1193 (`window.ethereum`) + EIP-6963 announcement | Connect (`eth_requestAccounts` / `eth_accounts`), `personal_sign`, `eth_sendTransaction` approval, and `wallet_switchEthereumChain` with its own approval screen (unknown chain → 4902). `wallet_addEthereumChain` is not supported (4200). |
| TON | TonConnect | Connect + TON Proof, `sendTransaction`, `signData`. The approval lists the requested permissions, transactions that would do nothing are refused rather than signed, and messages that deploy a contract (`stateInit`) show a warning. |
| Solana (disabled in release builds) | Wallet Standard + legacy `window.solana` | Connect, disconnect, events, `signTransaction` (plus legacy `signAllTransactions`), `signAndSendTransaction`, `signMessage` and `signIn` (SIWS). Connect, transaction signing and message signing (including SIWS) each go through an approval screen. With `VITE_SOLANA_ENABLED=false` the page script is not injected and the background refuses all Solana actions. |

- Only one approval window is open at a time. A request that arrives while a window is opening is rejected with 4001 ("Another request is being processed"), and a newer request replaces the open one, which rejects the earlier request with 4001. Approved transactions are then executed one at a time.
- **Permission management:** connected dapps are listed with their granted permissions, and access can be revoked per origin.
- **Cross-VM connect.** If the active network is TON, an EVM dapp's connect request still opens the approval screen and offers a one-tap switch to an EVM chain: the dapp's last chain, else the last EVM chain the user was on, else Ethereum. Other EVM calls on a non-EVM network return EIP-1193 error 4901. TonConnect sessions do not depend on the active network.

### 6.11 Settings, localisation and theme

- **Languages:** English and Turkish, auto-detected, with extension metadata localised through `_locales`.
- **Theme:** light / dark.
- **Surface:** side panel (default) or popup, under Preferences; the change applies immediately. The first time the wallet opens in the side panel, a one-time notice explains the change and offers a button to switch to the popup. Every user sees it, including new installs.
- Sections: Preferences, Security, Wallets & accounts, Address book, Dapp permissions, Profile, About. Settings → Add wallet opens onboarding directly on the chosen import method.

### 6.12 Tokenized stocks

- A curated catalog of bStocks tokenized-stock certificates on BNB Smart Chain (`src/data/bStocks.js`), shown in the Stocks tab. bStocks is a Binance product; the certificates are issued by BTech Holdings Limited (ADGM/FSRA).
- Look-alike contracts exist, so every catalog record is checked against a single beacon and compliance contract; `npm run verify:bstocks` re-checks symbol, decimals, beacon, compliance contract, UI multiplier and ISIN on-chain.
- Balances apply the token's BEP-677 UI multiplier (`src/utils/bstocks.js`); sends convert back to raw units (§6.3).
- The token detail page shows the issuer and the note that these tokens are certificates over shares, not shares. Swap screens mark them with a badge. They cannot be bridged (§6.8).

---

## 7. Backend contract

The WATS backend services the client talks to are **not in this repository**. They exist because extension code is public by nature and cannot hold a secret: every third-party API key stays server-side. The backend also stores the username profile created during onboarding (username and EVM address).

The client also talks directly to some third parties that need no key: the LI.FI API (`li.quest`) for bridge quotes and token lists, public EVM RPC endpoints from the bundled chain list, and `api.dicebear.com`, which renders identicons from the user's and recipients' addresses.

Endpoints the client calls, by purpose:

| Purpose | Endpoints |
|---|---|
| Token metadata, search, price | `/getTokenDataById`, `/getTokensDataById`, `/getChainTokens`, `/getTokenByName`, `/getTokenByAddress`, `/getImportedTokens` |
| Price chart | `/getTokenPriceHistory` |
| Profile and username | `/profile`, `/checkUsername`, `/profile/changeUsername`, `/profile/getProfile` |
| History | `/wallet/history`, `/ton/history`; `/solana/history` only when Solana is enabled |
| Recipient screening | `/wallet/reputation` |
| Announcements | `/news` |
| Chain RPC proxies | `/ton/rpc`, `/ton/swap/simulate`; `/solana/rpc`, `/solana/tokens` (intended only for Solana-enabled builds — see §10 for an exception) |
| Fiat on-ramp (hidden: `ONRAMP_ENABLED = false` in `src/utils/onrampConfig.js`; code kept but unreachable) | `/moonpay/getSignUrl` |
| ATS paymaster (separate host, pinned in `src/utils/atsConfig.js`) | `/health`, `/paymaster/status`, `/paymaster/quote`, `/paymaster/sponsor`, `/paymaster/relay`, `/paymaster/ton/*` |
| ERC-20 bundler proxy (dormant on curated chains, §6.9 B) | `/bundler/auth`, `/rpc/:chainId` |

**The contract the client assumes.** Read paths may fail; the UI degrades — except that EVM spending on the curated chains needs the ATS paymaster (§1.1).

The ATS paymaster (including `/paymaster/ton/*`) is unauthenticated: the client calls it directly with no token, and each operation is authorised by the user's own signature over that operation (the signed user operation, the EIP-7702 authorization, or the TON message and fee signatures). Only the dormant ERC-20 bundler proxy uses a short-lived token, which the client gets from `/bundler/auth` by signing a login message with the user's EOA; `/profile/changeUsername` carries a per-request signature. Any rate limiting is enforced server-side and is not part of this repository.

The services never hold a user key and never sign on the user's behalf. They can move the user's ATS only within allowances the user signed during setup on BSC: an unlimited ATS allowance to the paymaster contract, and a bounded allowance (a server-suggested budget) to the fee collector, which a service key triggers. On the cross-chain path the fee is pulled on BSC before the user signs the target-chain operation. Beyond those allowances, nothing moves without the user's signature.

---

## 8. Configuration

`.env.development` and `.env.production` are committed and hold no secrets — only backend base URLs and one feature flag:

| Variable | Meaning |
|---|---|
| `VITE_API_URL` | Base URL for token, profile, history, reputation, news and TON proxy endpoints |
| `VITE_BUNDLER_BASE` | Base URL for the ERC-20 bundler proxy (§6.9 B). The ATS paymaster host is pinned in `src/utils/atsConfig.js`, not here. |
| `VITE_SOLANA_ENABLED` | Build-time flag. Only the exact string `true` enables Solana: its content script in the manifest, the background actions and the chain record. `false` in both committed files; forced to `true` in the test run (`vitest.config.js`) so the Solana code stays tested. |

To override a value locally, create `.env.development.local` or `.env.production.local`. A plain `.env.local` is loaded before the mode-specific files, so it cannot override keys they define.

---

## 9. Quality bar

- **367 test files** run with Vitest (`npm test`; `npm run test:az-bellek` limits workers on low-memory machines). The Solana flag is forced on in tests, so the disabled feature stays verified. Four test files are cross-repository contract tests that need the maintainers' private repository and fail here (see README).
- Money-critical logic is extracted into **network-free pure modules** — fee maths, route selection, commission regions, recipient matching, swap validation, ATS quoting — so it can be unit-tested without an RPC or a live operation. Embedded in components, these could only ever be verified by spending real money.
- **On-chain verification instead of trusted constants.** `npm run verify:routers` re-checks every swap router, factory and quoter against the chain: bytecode presence, `router.factory()` agreement, V2 pool reserves and `getAmountsOut`, V3 quoter signature. `npm run verify:bstocks` does the same for the tokenized-stock catalog. Fee values were measured against the constant-product formula, not copied from documentation.
- **Manual browser verification is a separate gate.** A green test suite is not a release signal: MV3 service-worker behaviour and provider injection are only provable in a real browser. Node-only tests pass on code paths that fail inside a service worker, where `window` does not exist.

---

## 10. Known limitations

| # | Limitation |
|---|---|
| 1 | **Solana is disabled in release builds.** Solana accounts, transfers and dapp signing are implemented and tested, but `VITE_SOLANA_ENABLED=false` keeps the provider out of the manifest, drops the chain from the network list and makes the background refuse every Solana action. |
| 2 | **`window.ethereum` is claimed only when the slot is empty.** With another EVM wallet installed, dapps that read `window.ethereum` directly will not reach WATS. Dapps using EIP-6963 discovery still list it. |
| 3 | **EVM spending depends on the ATS paymaster.** On the curated EVM chains there is no native-gas fallback: if the paymaster service is unavailable, or the ATS balance or one-time setup is missing, EVM transactions are blocked. |
| 4 | **TonConnect discovery.** WATS is not yet registered in the public TON wallets list (`ton-blockchain/wallets-list`). Current `@tonconnect/sdk` versions (3.3 and later, including 4.x) no longer discover unregistered injected wallets, so most TON dapps will not offer WATS until it is registered. `npm run ton:test` serves a local test page pinned to SDK 2.2.0, which still discovers injected wallets. |
| 5 | **Legacy TON addresses are not shown.** Earlier builds derived TON addresses over SLIP-10 (`m/44'/607'/{i}'`). The old address stays in the account record (`tonAddressLegacy`) but has no UI, and above index 0 it cannot be opened by phrase in other wallets. If an account from an earlier build first resolves its TON address on TON Testnet after the upgrade, the old mainnet address is not re-derived and mainnet TON signing fails with `TON_ADDRESS_MISMATCH` (§4.1). |
| 6 | **Solana endpoints can still be called with Solana disabled.** Accounts imported from a TON phrase carry a Solana address, and the home screen's default "All networks" view loads Solana balances for them, so release builds call `/solana/rpc` and `/solana/tokens` for those accounts. |
| 7 | **TON contract version changes the address.** The same keypair under V4 and V5R1 yields different addresses, and on W5 the network id lives inside the contract, so a mainnet/testnet mix-up produces a valid-looking wrong address. |
| 8 | **Scope limits.** Private-key accounts have no TON address; TON cannot be bridged; tokenized stocks exist only on BNB Smart Chain and cannot be bridged. |
| 9 | **No hardware-wallet support and no non-seed recovery path.** Losing the seed phrase and the password means losing the wallet. |

---

## 11. Glossary

| Term | Meaning |
|---|---|
| **Vault** | An encrypted container for one secret: a seed phrase and the accounts derived from it, a single imported private key, or an imported TON phrase. A user may hold several. |
| **Account index** | The shared `{i}`: the EVM path index and an input to the per-account TON phrase derivation. One index = one identity across EVM and TON (and Solana, when enabled). |
| **ATS** | The token in which network fees are collected — for sends, swaps, bridges and dapp transactions on the curated EVM chains, and for relayed TON operations. Always settled on BNB Smart Chain. |
| **Cross-chain collection** | Sponsoring an operation on the target chain while pulling the fee on BSC. |
| **bStocks** | Tokenized-stock certificates on BNB Smart Chain, a Binance product issued by BTech Holdings Limited (ADGM/FSRA): certificates over shares, not shares. |
| **Fail-open / fail-closed** | Advisory services degrade to "unknown" and let the user proceed; authority gates reject on doubt. |
| **GRAM** | The display name and symbol of TON's native coin in this wallet. |
| **Jetton** | A fungible token on TON, the equivalent of an ERC-20. |
| **W5 / V5R1** | The TON wallet contract version used for derived accounts. |

---

*Source comments in this repository are written in Turkish, and some refer to internal design documents that are not part of it; see [`README.md`](README.md#contributing).*
