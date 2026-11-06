# WATS Wallet — Product Specification

> [`README.md`](README.md) is the quick tour. This document is the detailed specification:
> what the wallet does, for whom, under which constraints, and what is deliberately absent.

| | |
|---|---|
| **Version** | `1.10.0` (`package.json` → drives `manifest.version`) |
| **Platform** | Chrome / Chromium, Manifest V3, `minimum_chrome_version: 115` |
| **Custody** | Self-custodial. Keys are generated on-device and never leave it. |
| **This repository** | Extension client only. The services it talks to are not part of this repository (§7). |
| **License** | [MIT](LICENSE) · Security policy: [SECURITY.md](SECURITY.md) |

---

## 1. Overview

WATS Wallet is a self-custodial multi-chain crypto wallet shipped as a browser extension. A single BIP-39 seed phrase gives every account index an **EVM** account and a **TON** account, so "Account 2" is the same person on every supported chain. Version 1.10.0 adds an optional **Private Account** mode (§6.15): one extra EVM-only account per wallet, funded and emptied through a third-party service, with the rest of the wallet's surfaces switched off while it is active. Solana derivation, transfers and dapp signing are also in the code, but they are switched off in release builds by the `VITE_SOLANA_ENABLED` build flag (§8).

Beyond the usual send / receive / swap surface, the wallet targets three problems that most wallets leave to the user:

1. **You need the native coin to move your own money.** The wallet pays network fees in ATS, collected on BNB Smart Chain, on all ten curated EVM chains, and on TON when the fee relay is active. A user who holds no ETH, POL, BNB or GRAM can still transact as long as they hold ATS on BNB Smart Chain, and ATS itself can be bought inside the wallet with USDT, USDC or BNB without paying a network fee (§6.13).
2. **You cannot tell a real recipient from a poisoned one.** Every recipient entered in the wallet's own Send flow is checked for address-poisoning lookalikes (EVM and TON) and, for EVM addresses, against a reputation feed before the confirm button goes live. Transactions requested by dapps are not screened.
3. **Each chain wants its own wallet.** EVM dapps (EIP-1193 / EIP-6963) and TON dapps (TonConnect) reach the same account set through the protocol each ecosystem expects.

### 1.1 Design principles

| Principle | What it means in practice |
|---|---|
| **Advisory backends are optional** | Price, history, reputation and news all fail *open* to a degraded-but-working screen. **Exception, by design:** on the ten curated EVM chains the network fee is always paid in ATS through the ATS paymaster service. If that service cannot quote, or the user's ATS balance or allowance is insufficient, the transaction is blocked — it never silently falls back to a native-gas fee the user did not see. On TON, when the relay is off, the user pays in GRAM. The in-wallet ATS purchase (§6.13) is the one operation that carries no ATS fee: a dedicated sale sponsor pays its gas. |
| **Fail-closed on authority, fail-open on advice** | Permission gates (which origin, which chain, which account) reject on doubt. Advisory data never rejects. |
| **The client keeps its own copy of safety-critical constants** | Paymaster, collector, router, sale-desk and sale-sponsor addresses are pinned client-side, so a compromised or confused backend cannot redirect funds. |
| **Extension code cannot hold a secret** | Anything requiring an API key lives behind the backend. The bundle ships no third-party credentials. |
| **Private mode fails closed** | Private mode is on only when the active account is the Private Account, and that identity is matched against the vault record. Every background action must be classified as always allowed, conditional or blocked in private mode (a test enforces it); an action whose signer cannot be resolved is refused. If a build has privacy off but the profile has the Private Account active, startup rolls back to a regular account (§6.15). |
| **Every money-critical decision is a pure, tested function** | Fee maths, route selection, commission regions and recipient matching live in network-free modules with unit tests, not inside components. |

---

## 2. Scope

### 2.1 In scope

- Browser-extension wallet for desktop Chromium browsers.
- Self-custodial key management: creation, import, export, encryption, lock.
- Multi-VM asset management: EVM chains and TON. Solana support is present in the code but disabled in release builds (`VITE_SOLANA_ENABLED=false`).
- Tokenized-stock certificates: bStocks on BNB Smart Chain and xStocks on Ethereum, BNB Smart Chain and Arbitrum One.
- A fiat display currency and a twelve-language interface.
- Transfers, same-chain swaps, cross-chain bridging between EVM chains.
- Fee abstraction (paying network fees in ATS) on supported chains, and buying ATS inside the wallet.
- An optional Private Account mode (§6.15): one EVM-only account per wallet, moved to and from through SilentSwap on ten EVM networks.
- Dapp connectivity for EVM (EIP-1193 / EIP-6963) and TON (TonConnect). Solana (Wallet Standard) is implemented but disabled in release builds.

### 2.2 Out of scope (explicit non-goals)

- **The backend.** This repository is the client. The hosted API and the ATS paymaster service are separate services (§7).
- **Mobile and desktop-native apps.** Separate codebases; nothing verified here carries over to them.
- **Hardware-wallet signing.** No Ledger/Trezor transport.
- **Custodial or MPC key storage.** There is no recovery path that does not involve the user's own seed phrase.
- **Passkey/WebAuthn as a signing key.** Rejected by design: Solana and TON cannot verify a P-256 signature, and PRF support is incomplete — losing PRF would mean losing funds. A passkey may only ever unlock a locally stored vault.
- **Custom networks.** Only the curated chains in §5 are supported; `wallet_addEthereumChain` is refused.
- **Fiat off-ramp, staking, NFTs.** Not implemented.
- **Anonymity guarantees.** The Private Account is a separate address whose link to the regular accounts is broken by a third-party service, not by anything the wallet itself runs. The wallet does not claim, and the code does not establish, that transfers cannot be traced; what the service and others can observe is listed in §6.15.

---

## 3. Surfaces

| Surface | Entry point | Purpose |
|---|---|---|
| **Side panel** (default) | `src/sidepanel/` | Main wallet UI in Chrome's side panel. Same Vue app as the popup (shared bootstrap in `src/shared/bootstrap.js`), routed through `pageStore`. Panels open in several windows keep network and account in sync. |
| **Popup** | `src/popup/` | The same UI as a popup. Used when the user picks popup mode in Settings → Preferences, or when the browser has no Side Panel API. |
| **Onboarding tab** | `src/onboarding/`, `onboarding.html` | Full-tab creation and import flow. While no wallet exists, clicking the toolbar icon opens this tab (or brings an existing one forward) instead of the panel. In browsers without the Side Panel API the popup opens briefly, opens a new onboarding tab and closes itself. Settings → Add wallet opens it on the chosen import screen. |
| **Approval window** | popup route, standalone window | Dapp connection, message signing, typed-data signing and transaction approvals, one at a time. A new request closes the open approval window and rejects the request it was showing (4001 "Request replaced by a new one"); a request that arrives while a window is opening is rejected (4001). Two dapps therefore never share or race one approval window. A site may open at most 3 signing or transaction approval windows (`personal_sign`, `eth_signTypedData_v4`, `eth_sendTransaction`) per 10 seconds; after the user rejects one of its requests, that site is blocked for 2 seconds, doubling on repeated rejections up to 60 seconds (error −32005 "Rate limited"). Connection and network-switch requests are not throttled. Approvals never render inside the side panel. |
| **Private-mode notice window** | popup route, standalone window | A read-only notice opened when a dApp asks to connect or to switch network while private mode is on (§6.15). It cannot approve anything; the page receives an ordinary user rejection. |
| **Alert window** | popup route `#alert`, standalone window | A read-only notice shown when a TonConnect request names a different network or account than the wallet's (§6.10). It cannot approve anything and does not count as wallet activity for the auto-lock timer. |
| **ATS purchase window** | popup route `?ats-purchase=1#window` | Opened when the user chooses Buy ATS from a dapp approval screen. It opens the purchase directly on BNB Smart Chain and never passes through a dapp approval screen; the pending dapp request is rejected and has to be sent again after buying. |
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
| Private Account (EVM only, §6.15) | secp256k1 | BIP-32 | `m/44'/60'/0'/1/0` (the BIP-44 change branch, which adding an account never reaches) |

**TON phrase derivation.** `root = HMAC-SHA512(key = "wats/ton-from-seed/v1", data = BIP-39 seed (empty passphrase) ‖ index as 32-bit big-endian)`. For counter values 0, 1, 2, … (at most 4096 tries) the wallet computes `HMAC-SHA512(key = root, data = counter as 32-bit big-endian)`. It reads the first 264 bits of that output, most significant bit first, as 24 × 11-bit indices into the 2048-word TON word list (`mnemonicWordList` from `@ton/crypto`), and takes the first result that is a valid password-less TON phrase. The TON key comes from that phrase. Because it is an ordinary TON phrase, it can be exported and opened in other TON wallets at any account index. The domain string is frozen: changing it would give the same master phrase different TON addresses.

TON addresses written by earlier builds under the old SLIP-10 path (`m/44'/607'/{i}'`) are re-derived under the new scheme the next time the account's TON address is resolved. The first replaced address is kept in the account record (`tonAddressLegacy`) and is not shown in the UI. Known issue: if that first resolution happens on TON Testnet, the old mainnet address is not re-derived and mainnet TON signing fails with `TON_ADDRESS_MISMATCH` (§10).

The account index `{i}` is shared. TON accounts use contract version **V5R1 (W5)**. The version is fixed in code: `tonWalletContract` (`src/utils/ton/tonAccount.js`) is the only W5 factory and always builds V5R1. It is not stored per account — the record's `tonScheme` field stamps the key-derivation scheme, not the contract version — so adding a later contract version would first require recording the version per account, or existing accounts would change address.

Two properties of TON that shape the UI:

- **The same keypair under a different contract version is a different address.** V5R1 and V4 of one key are two distinct accounts. Import therefore checks the phrase's W5, v4R2 and v3R2 addresses on-chain. The wallet signs only for W5, so if the funds sit only in an older version, the import is blocked with an explanation instead of opening an empty W5 address.
- **On W5 the network id is part of the wallet contract's initial state.** The same key has different mainnet and testnet addresses. `@ton/ton` defaults the id to mainnet (−239), so deriving a testnet address without passing the network id silently produces the mainnet address. `tonWalletContract` always passes it explicitly.

### 4.2 Vaults and accounts

- Multiple **vaults** (each one seed phrase), multiple **accounts** per vault.
- Accounts can be created, renamed and switched; a switch applies across all chains at once.
- **Private-key imports** (one secp256k1 key) live outside the HD tree and are EVM-only (no TON address). Their vault is labelled "Private Key" in Settings → Create account, but the account list shows them with the same EVM badge as HD accounts. They need their own backup. The import field accepts 64 hex characters (an EVM key). A 128-hex string is recognised as a raw TON secret key and is not importable, because there is no vault type for a bare TON key; the screen directs the user to import the recovery phrase instead. A 64-hex TON seed cannot be told apart from an EVM key and is treated as one.
- **TON-phrase imports** (a Tonkeeper-style 24-word phrase) become a normal account with both TON and EVM. TON comes from the imported phrase; EVM comes from a BIP-39 phrase derived deterministically from it, so the TON phrase alone restores both.
- **The Private Account** (§6.15) is not an entry of a vault's `accounts` list. It is a separate `privateAccount` field on an HD vault's record (address, key `private-<address>`, derivation path, a fingerprint, creation time), so account lists do not show it. No separate secret is stored: its signing key is derived again on demand from the vault's encrypted recovery phrase, as for any HD account, which means restoring the phrase restores it. It has no TON or Solana address. Private-key and TON-phrase vaults cannot derive one (`PRIVATE_NEEDS_HD_VAULT`). It is deliberately not resolvable by `findAccountByAddress`, so dApp signing can never select it.
- Reveal flows for the master mnemonic, the EVM private key and the **TON key** are each gated behind password re-entry plus an explicit acknowledgement screen. For accounts whose TON key is derived from the master seed, the TON key screen shows both the raw Ed25519 secret key (64-byte seed‖public-key form, hex) and the account's derived 24-word TON phrase; entering that phrase in another TON wallet (W5 version) opens the same address. For TON-phrase imports the screen shows only the raw key. When a derived phrase exists, the screen also tells the user that moving the account to another wallet takes the 24 words, not the key.
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
2. Or import — a BIP-39 seed phrase (this also runs the account scan below); a TON-native 24-word phrase (for example from Tonkeeper — the importer probes several contract versions, and a Tonkeeper multi-account root phrase is recognised and explained rather than rejected as invalid); or a single EVM private key (EVM-only account). Then set a password, which creates the encrypted vault.
3. Choose a username (uniqueness checked server-side). The username is stored by the backend together with the account's EVM address.

When onboarding finishes, the wallet opens in the side panel, or in the popup if the user chose popup mode.

**Account scan on import.** Importing a BIP-39 phrase (as the first wallet, or through Settings → Add wallet) scans the derived EVM accounts at `m/44'/60'/0'/0/i`, starting at index 1; index 0 is always added. The scan stops after 3 consecutive unused indexes and adds at most 20 accounts (indexes 0–19); the whole scan is capped at 60 seconds. The accounts added run up to the last used index, so empty accounts in between are included. A result screen lists what was found, and Skip keeps only Account 1. If a network error or the time limit interrupts the scan, what was found so far is kept and no result screen is shown. New wallets and private-key imports are not scanned.

An address counts as used when, on any of the 10 EVM networks, its transaction count is above zero, or its native balance is above zero, or it holds a balance of any token in a fixed per-network list of at most 6 well-known tokens (stablecoins such as USDT, USDC and DAI, plus ATS on BNB Smart Chain). The token balances for one address are read in a single Multicall3 call per network. The list is fixed so that airdropped or spam tokens cannot mark an account as used. If every network fails for an address, the scan ends there with what it has. Solana and TON addresses are not scanned.

The scan sends only derived public addresses, never the phrase or a key, as JSON-RPC requests (`eth_getTransactionCount`, `eth_getBalance`, `eth_call`) straight from the extension to the public RPC endpoints already bundled for the 10 EVM networks, with credentials omitted and no referrer. The endpoints come only from bundled data. Each call has a 4-second timeout; a second endpoint is tried only if the first fails. No new third-party host is involved, but the RPC operators see the addresses and the requester's IP address. The found accounts are written to storage in one write, after a second fresh read of the stored vaults and a duplicate-seed check. For a first wallet, the account count is passed to the password step, which builds all accounts in one vault, and the Back button is disabled while the vault is written.

### 6.2 Portfolio / home

- Per-token balances and total portfolio value, shown in the display currency (§6.14).
- Token detail page with a price-history chart, served through the backend so no API key reaches the client. Chart failure shows "no price history" and never blocks the page.
- Token import by contract address, and token search across the chain's list.
- **Token logos** are resolved in one place (`src/utils/tokenLogoSources.js`), in this order, and an image that fails to load falls through to the next source: (1) logo files bundled in `public/tokens` keyed by chain and contract, plus the network and ATS/USDC logos; (2) the remote image fields already on the token record (`image`, `logoURI`, `logo`, `iconUrl`); (3) the Trust Wallet asset repository at `raw.githubusercontent.com/trustwallet/assets/master/blockchains/<chain>/assets/<checksum address>/logo.png` (EVM chains and Solana mints; skipped for native coins); (4) a letter monogram. Step 3 means that host sees the requester's IP and the contract address being shown; no wallet address or balance is in the request, and the URLs in step 2 may point at other hosts. The `default-token`, `default-dapp` and `default-chain` placeholder images count as no logo. Search and token-picker lists hide tokens with no logo, except that the Swap and Bridge "from" and Send asset pickers keep one the account holds with a positive balance. Wallet asset lists hide a logoless token only when its balance is exactly zero; a non-zero, unknown or still-loading balance stays visible with a monogram, and history rows, approval screens and user-imported tokens are never hidden. A token counts as logoless only after at least one remote logo has loaded in the session, so working offline does not empty the lists. The six chain logos that used external hosts are now bundled files. Address identicons and initials avatars are generated locally (`@dicebear/core` and `@dicebear/collection`, pinned to 9.4.3); no request goes to `api.dicebear.com`.
- A **network scope** control: view one chain, or all of them at once.
- Home tabs, in order: **Assets**, **Stocks** (tokenized stocks, §6.12; hidden for accounts that support none of the chains the catalogs live on) and **Activity**.
- An **ATS pill** in the header (hidden for TON accounts) shows the ATS balance on BNB Smart Chain; its dropdown shows roughly how many sponsored transactions that covers, the USD value and a Buy ATS action (§6.13).
- **Default tokens.** New, created and imported accounts get a default token list from the backend (`/getImportedTokens`, a GET with no account data): ETH and USDT on Ethereum, ATS and BNB on BNB Smart Chain. It is applied only while the account's token list has neither an Ethereum nor a BNB Smart Chain entry, so a user who removed the defaults keeps that choice; existing rows are kept. A failed fetch writes nothing and is retried on a later load, at most once a minute per account.
- A **news strip** for announcements, served from the backend. Text is rendered as text, never as HTML — the content is outside the client's control, so a malformed record must not be able to do more than look wrong.

### 6.3 Send

- Native coin and token transfers on EVM and TON (GRAM and jettons, with an optional text comment on TON). Solana transfers are in the code but disabled in release builds.
- A fee figure on every network: a live gas estimate on EVM, a fixed approximate reserve on TON (≈0.01 GRAM, or up to 0.05 GRAM attached for a jetton transfer with the excess refunded), or the ATS fee when the fee is paid in ATS. Its USD value is shown whenever a price is available. There is also a percentage/MAX helper and a reserve guard that stops the user from spending what they need for the fee.
- A confirmation screen showing recipient identity, amount, fee and USD value, followed by live transaction status.
- **Address book** of saved recipients, plus recently-used and previously-sent recipients.
- **Own-account transfers** resolve to the account's name instead of a raw address.
- The amount field is a text input that accepts digits and one decimal separator (comma or dot; it is stored with a dot) and drops other characters. The user can also enter the amount in the display currency; the figure is converted to a token amount before validation and sending. If the selected currency changes, or a saved draft was typed in another currency, the fiat mode closes and the field is cleared, so 100 TRY can never become 100 EUR or 100 tokens. Fiat entry is locked when no price or rate is known.
- For TON jettons, the amount check no longer decides whether the account has enough TON for the fee; that is decided on the confirmation screen. A holder of a jetton with no TON can therefore proceed when the fee is paid in ATS through the relay.
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
- **Price impact.** V2 routes compute impact from pool reserves, compounded per hop; V3 routes from a small probe quote against the same pool. When the measured impact is above 5%, the swap button stays disabled until the user ticks an explicit confirmation, which resets with every new quote. On EVM this gate is in the UI; on TON the service worker enforces it as well. If the impact cannot be measured (shown as "N/A"), the swap is not blocked, but a warning row asks the user to check the amount they will receive. The swap button stays disabled until a quote exists.
- Slippage is user-configurable (0.5%, 1% or a custom value up to 50%). The on-chain swap deadline is fixed at 10 minutes.
- Router, factory and quoter addresses are verified on-chain and re-verifiable with `npm run verify:routers`. They are not edited by hand.
- On ATS chains the swap's network fee is paid in ATS (§6.9).
- When the destination token is ATS on BNB Smart Chain, the Swap screen switches to the in-wallet purchase instead of a DEX route (§6.13).
- A MAX or 100% amount is clamped to the actual token balance when it overshoots only by floating-point dust (relative difference of 1e-12 or less); a real over-balance is still rejected.
- The general Swap engine refuses any xStock as input or output before making a network call (error `XSTOCK_USE_COW`); xStocks are traded only on their own screen (§6.12).

### 6.8 Bridge

Cross-chain movement between the curated EVM chains through LI.FI, with source/destination chain and token selection and its own settings panel. TON is deliberately not bridgeable: LI.FI carries no TON, and a jetton-only bridge that cannot move GRAM was rejected. bStocks exist only on BNB Smart Chain and cannot be bridged out: they are filtered out of the source-token picker, the Bridge button on their detail page is disabled with an explanation, and quotes that use one as the source token are refused. They can be chosen as the destination token on BNB Smart Chain when LI.FI has a route to them; the destination picker and the receive line mark them with a "STOCK" badge. xStocks are refused both as source and as destination, on Ethereum, BNB Smart Chain, Arbitrum One, Optimism and Mantle, independent of the xStocks flag. On ATS chains the bridge's network fee is paid in ATS.

**Quote check.** Each valid LI.FI quote is remembered in session storage (`bridge_quotes`, at most 20 entries, 10 minutes). A quote whose receiver (`action.toAddress`, or `fromAddress` when present) is not the signing account is refused (`BRIDGE_RECEIVER_MISMATCH`). Before signing, the bridge and its ATS fee quote look the quote up again by chain, target, call data and value, and stop with `BRIDGE_QUOTE_NOT_FOUND` or `BRIDGE_RECEIVER_MISMATCH` if the record is missing or the signer or approval address differs; the screen then asks for a new quote. The Swap and Bridge screens discard their cached quote when the active account or private mode changes. The check compares the receiver LI.FI reports; the call data is not decoded, so it would not catch a quote that reports the right receiver but encodes another one (§10).

### 6.9 Fee abstraction — paying network fees in ATS

**A. ATS paymaster: network fees paid in ATS**

EVM chains: Ethereum, Optimism, Cronos, BNB Smart Chain, Gnosis, Polygon, Mantle, Base, Arbitrum One, Celo. ATS covers the user's own sends, swaps and bridges, and dapp transactions. On these chains ATS is mandatory and does not fall back to native gas. For dapp transactions, the dapp receives the on-chain transaction hash, not the UserOperation hash.

The fee is **always collected in ATS on BNB Smart Chain (56)**, because that is the only chain where the user's real ATS balance lives. On every other chain, collection is **cross-chain**: the operation is sponsored on the target chain while the fee is pulled on BSC through a collector contract. Before first use, a setup on BNB Smart Chain approves the paymaster (unlimited ATS allowance) and gives the collector a bounded ATS allowance (a gas budget). When that budget runs low, the wallet asks for one more approval to refresh it.

**Per-operation fee authorization (`XcFeeAuth`).** On the cross-chain path the quote can also ask for an EIP-712 `XcFeeAuth` signature for the specific operation, and the service collects the fee against it. It binds the destination chain, the sender, the nonce, the hash of the call data, a gas-cost cap, the exact ATS amount (gas, margin and any commission) and a deadline. Before signing, the client checks the domain (`ATS Crosschain Gas`, version 1, chain 56, the pinned collector contract) and the exact field list, checks that sender, nonce, destination chain and call-data hash match the operation it is about to send, and checks that the ATS amount stays within the fee the user approved on the confirmation screen. If any check fails, nothing is signed or sent. The deadline is checked by the service. When the quote carries no `XcFeeAuth`, the fee is collected under the allowance alone.

Because the receipt id is derived from the signed message, after an uncertain failure the wallet asks the service whether that fee was already collected instead of signing again; while an earlier attempt's fee is still being verified, the user is asked to wait (up to 5 minutes) rather than being charged twice. Cross-chain fees are collected before the target-chain operation lands, so a fee already paid for an operation that did not land is carried over to a replacement operation with the same nonce when it covers the new total. The confirmation screen then says the operation is covered by the earlier payment.

Two design points worth stating explicitly, because both were paid for in production incidents:

- **Whether collection is cross-chain depends on the chain alone.** It is not derivable from the backend's sponsorship `mode`, which describes *how* the target chain is sponsored, not *where* the fee is taken. The two are orthogonal; conflating them produced pre-flight checks that never ran, screens that showed one fee while another was charged, and budgeted gas that was paid but never refunded.
- **Paymaster and collector addresses are pinned in the client**, and the one-time unlimited approval always goes to the pinned paymaster. The paymaster returned by `/sponsor` must be in an allowlist made of the pinned addresses plus any the service's `/health` advertises for that chain (if `/health` is unreachable, the pinned table alone applies); a paymaster outside that set halts the send before signing. Taking the approval spender from the backend would have made the check a tautology — an unlimited approval would go to the wrong spender, the allowance would never register, and every attempt would revert while the paymaster paid gas and collected nothing.

Gas limits are estimated per operation rather than capped at a constant; a fixed ceiling was measured to use only ~18% of the budget on cross-chain routes, with no refund. For native-coin sends to an address that is still empty on the target chain, the estimate adds the 25,000 gas that creating the account costs, which `eth_estimateGas` does not see because it is charged inside the inner call.

**TON.** When the fee relay is active and the account also holds an EVM key, the following can be paid in ATS: GRAM sends (including comments), jetton sends, STON.fi swaps, and TonConnect dapp transactions that are plain transfers or calls to whitelisted routers without `stateInit`. Other dapp contract calls are paid in GRAM. The fee is authorised by an EIP-712 `TonFeeAuth` signature whose domain (chain 56, collector contract) is pinned client-side. When the relay is off, the user pays in GRAM.

The fee is shown on one shared ATS fee card with the ATS logo and a USD equivalent. The card says "up to" only when part of the fee can actually be refunded (same-chain operations above the minimum charge). On a first-time setup the total includes the separately priced setup operation. Swap and Bridge block sending, with a message in the fee card and a Buy ATS button, when the ATS balance cannot cover the total.

**B. ERC-4337 / EIP-7702 ERC-20 paymaster (dormant)**

Code for an ERC-20 paymaster path (EIP-7702 delegated EOA, EntryPoint v0.8, via `permissionless` through the backend's bundler proxy) remains for Ethereum, BNB Smart Chain, Base, Optimism, Arbitrum One and Polygon. In 1.10.0 it is dormant: all six are ATS chains, and the fee rule (`atsFee.pickFeeBranch`) picks ATS first for the send flow and for dapp approvals, so the ERC-20 gas-token selector is not shown. The per-dapp "gasless" toggle still appears in dapp permissions but has no effect on these chains. The wallet no longer offers a button to revoke the EIP-7702 delegation.

The backend proxies the bundler: it hides the provider API key, enforces a chain and token allowlist, applies signature-verified token auth with nonce replay protection, and layers IP / hourly / daily rate limits.

**C. Swap/bridge commission**

A commission layer exists for swap and bridge operations, with a region rule — `local` on BSC, `src` on spoke chains — taken from the backend's `collection` field. The client's own chain rule is used only as a fallback when an older server omits that field. A client rule that drifted from the server's configuration would lose money in both directions: double-charging on a spoke chain, or producing an operation the server rejects on BSC. When a commission is configured, it is included in the single ATS total shown on the swap and bridge fee cards, not as a separate line.

### 6.10 Dapp connectivity

| Ecosystem | Protocol | Implemented |
|---|---|---|
| EVM | EIP-1193 (`window.ethereum`) + EIP-6963 announcement | Connect (`eth_requestAccounts` / `eth_accounts`), `eth_chainId`, `personal_sign`, `eth_signTypedData_v4`, `eth_sendTransaction` approval, `wallet_switchEthereumChain` with its own approval screen (unknown chain → 4902), and EIP-2255 `wallet_getPermissions` / `wallet_revokePermissions` (no approval window). An allowlist of read-only methods is forwarded to public RPCs (below). Everything else returns 4200, including `wallet_addEthereumChain`, `wallet_requestPermissions`, `eth_sign`, `eth_signTypedData_v3` and `eth_signTypedData`. |
| TON | TonConnect | Connect + TON Proof, `sendTransaction`, `signData`. Requests are validated against the TonConnect specification before any window opens: `valid_until` is a uint32 in seconds, amounts are decimal nanoton strings, addresses must be in user-friendly form, payloads and `stateInit` must be single-root BOCs (`stateInit` libraries, extra currencies and structured `items` are refused), and request ids must increase within a session. If `network` or `from` does not match the connected session, the dapp gets error 1 and the user sees the alert window; the wallet does not offer to switch. A `valid_until` key that is present but null or not a uint32 is rejected (error 1, no approval window); only an absent key means no expiry. The dapp's manifest URL must have a dotted domain host (localhost and IP literals are allowed); manifest failures use the specification's messages, "App manifest content error" (code 3) and "App manifest not found" (code 2), with details in a separate `reason` field. TON Proof and `signData` are signed only for dotted domain names. The wallet's TonConnect device information lists the legacy `SendTransaction` string feature first, then `SendTransaction` (with `maxMessages`) and `SignData` (text, binary, cell) as objects; the injected bridge's wallet info keeps only the object forms, matching the wallets-list schema. The approval lists the requested permissions, transactions that would do nothing are refused rather than signed, and messages that deploy a contract (`stateInit`) show a warning. |
| Solana (disabled in release builds) | Wallet Standard + legacy `window.solana` | Connect, disconnect, events, `signTransaction` (plus legacy `signAllTransactions`), `signAndSendTransaction`, `signMessage` and `signIn` (SIWS). Connect, transaction signing and message signing (including SIWS) each go through an approval screen. With `VITE_SOLANA_ENABLED=false` the page script is not injected and the background refuses all Solana actions. |

- Only one approval window is open at a time. A request that arrives while a window is opening is rejected with 4001 ("Another request is being processed"), and a newer request replaces the open one, which rejects the earlier request with 4001. Approved transactions are then executed one at a time. Signing and transaction approval windows are rate-limited per site (§3).
- **Typed-data signing (`eth_signTypedData_v4`).** The payload is parsed strictly (at most 256 KiB, depth 32 and 5,000 nodes; every value is checked against its Solidity type), and the digest is computed from the same normalized value the screen shows. On approval the service worker recomputes it from its own stored copy, and a request older than 5 minutes can no longer be signed. Known permit shapes are classified and flagged at warning or danger level: ERC-2612 `Permit`, DAI-style permit, Permit2 (single, batch and transfer forms) and Seaport orders, with flags such as unlimited amount, no expiry, or an order that gives the signer nothing.
- **Read-only RPC.** An allowlist of read methods (`eth_call`, `eth_estimateGas`, `eth_getBalance`, `eth_getLogs`, block, receipt and fee reads, and similar) is forwarded by the service worker to the active chain's bundled public RPC endpoints, never to a URL supplied by a page. Limits: 20 requests/s overall, 5/s per site (burst 20), 8 concurrent per site, 256 KiB of parameters, 2 MiB of response; over the limit the dapp gets −32005.
- **Delivery.** The page scripts resend each request every 100 ms until the content script acknowledges it, so requests sent while the page is still loading are not lost; duplicates are dropped. If the content script never answers, the dapp gets an error rather than a request that never settles.
- **Account sync.** When the user switches accounts, a connected site with an open tab that was granted exactly the previous active account follows the switch, until the user edits that site's account list by hand; the site receives `accountsChanged`. Sites with no open tab are not changed.
- **Balance check before a TON approval.** For a `sendTransaction` request on TON mainnet, the service worker computes a conservative lower bound of what the user will pay (all message amounts if any message carries a `stateInit`, otherwise only the messages without a payload). If that exceeds the account's on-chain balance, the request is rejected with BAD_REQUEST ("Insufficient TON balance for the requested amount") and no window opens. The balance is read through the wallet's own backend proxy (`/ton/rpc`), so the user's TON address is sent there; the read has a 3-second timeout and a 5-second cache. If the balance cannot be read, the check passes (fail-open) and the approval screen applies its own lock. That screen shows a red balance card in three variants: fee sponsored by the relay, fee paid by the user, and balance unreadable (the approve button stays locked).
- **Permission management:** connected dapps are listed with their granted permissions, and access can be revoked per origin.
- **Private mode.** While the Private Account is active no dApp sees the wallet as connected (§6.15).
- **Cross-VM connect.** If the active network is TON, an EVM dapp's connect request still opens the approval screen and offers a one-tap switch to an EVM chain: the dapp's last chain, else the last EVM chain the user was on, else Ethereum. Other EVM calls on a non-EVM network return EIP-1193 error 4901. TonConnect sessions do not depend on the active network.

### 6.11 Settings, localisation and theme

- **Languages:** twelve, listed with flags in Preferences: Spanish, Portuguese (Brazil), Russian, Simplified Chinese, Vietnamese, Indonesian, Korean, Japanese, German, French, Turkish and English. The language is auto-detected from the browser (`pt` maps to `pt-BR`, `zh` to `zh-CN`, anything unsupported to English), can be changed in Preferences, and sets the document's `lang`. Extension metadata (the store listing strings) is localised for all twelve through `_locales`. Number and date formats follow the app language, except ATS amounts, which always use the `en-US` format. Russian has its own plural rule.
- **Display currency:** chosen in Preferences (§6.14).
- **Reset app:** the confirmation word is the one in the current language, not a Latin "RESET". The comparison folds Unicode compatibility forms, removes invisible format characters, collapses whitespace, strips accents and upper-cases independent of locale, so the Turkish dotted I and decomposed input from macOS still match. An empty word or empty input never confirms.
- **Theme:** light / dark.
- **Surface:** side panel (default) or popup, under Preferences; the change applies immediately. The first time the wallet opens in the side panel, a one-time notice explains the change and offers a button to switch to the popup. Every user sees it, including new installs.
- Sections: Preferences, Security, Wallets & accounts, Address book, Dapp permissions, Profile, About. Settings → Add wallet opens onboarding directly on the chosen import method.

### 6.12 Tokenized stocks

The Stocks tab holds two curated catalogs. A stock screen offers Buy and Sell for either kind, with an issuer switch where a company has both.

**bStocks (BNB Smart Chain).**

- A curated catalog of bStocks tokenized-stock certificates on BNB Smart Chain (`src/data/bStocks.js`, 22 entries). bStocks is a Binance product; the certificates are issued by BTech Holdings Limited (ADGM/FSRA).
- Look-alike contracts exist, so every catalog record is checked against a single beacon and compliance contract; `npm run verify:bstocks` re-checks symbol, decimals, beacon, compliance contract, UI multiplier and ISIN on-chain.
- Balances apply the token's BEP-677 UI multiplier (`src/utils/bstocks.js`); sends convert back to raw units (§6.3).
- Buy and Sell use the wallet's existing PancakeSwap route through the existing swap messages. Amounts stay in UI units, and the ATS-paid path refuses to send without a valid quoted ATS amount.
- The token detail page shows the issuer and the note that these tokens are certificates over shares, not shares. Swap screens mark them with a badge. They cannot be bridged out of BNB Smart Chain (§6.8).

**xStocks (Ethereum, BNB Smart Chain, Arbitrum One).**

- Catalog: `src/data/xStocks.js`, 21 entries, hard-coded. They are tracker certificates issued by Backed Assets (JE) Limited, not share ownership, and are unrelated to bStocks. A token is added only after on-chain checks (code present, `symbol()`, 18 decimals, the implementation slot, a positive multiplier); `npm run verify:xstocks` re-checks them. Coverage is per stock: for example TSLAx and NVDAx are listed only on Ethereum and BNB Smart Chain, and Arbitrum carries only MSTRx. Fake look-alike tokens exist on Base, so tokens are never matched by symbol or name. The issuer's terms give no logo rights, so logos come from the backend's price response, and a letter is drawn when there is none.
- Balances are already multiplied (the tokens rebase); the CoinGecko price is in raw multiplied units and is divided by the on-chain multiplier.
- **Trading.** Buy and Sell are CoW Protocol orders, paid in USDC or USDT per chain. The order is built and signed in the extension as EIP-712 (domain `Gnosis Protocol` v2 on the GPv2Settlement contract `0x9008D19f58AAbD9eD0D60971565AA8510560ab41`); the receiver is always the owner and the app code is `WatsWallet`. Defaults: validity 1,800 s, slippage 50 bps, price protection 200 bps. A network fee above 10% of the order value triggers a warning only; there is no minimum-amount lock. A quote lives in session storage, is single-use, bound to the account, and valid for a 5-minute approval window.
- **Partner fee.** Each order carries a 10 bps (0.1%) partner fee in its app data, with a company-controlled Safe as recipient (the same address on all three chains). If the recipient fails validation, the order is not built.
- **Approvals.** The spender is fixed in code to the GPv2 VaultRelayer (`0xC92E8bdf79f0507f65a392b0ab4667716BFE0110`) and is never taken from the UI. The approval is unlimited; Ethereum USDT is first reset to zero, then approved. Where the token supports EIP-2612 (USDC on Ethereum and Arbitrum), a permit is used instead of an on-chain approval. An on-chain approval is sent through the ATS paymaster path (§6.9).
- **Market gating.** If the reference price is missing, Buy and Sell are both locked. If the market is closed or its state is unknown, only Buy is locked and Sell stays open. The market state comes from the issuer's public API (`api.xstocks.fi`, `GET`, no user data), not from CoW, because CoW can return inflated quotes while the market is closed. The reference price comes from the WATS backend. There is no staleness check on the reference price.
- **Isolation.** All `COW_*` service-worker actions are blocked for web pages, and any action starting with `COW_` is refused when `VITE_XSTOCKS_ENABLED` is not `true`. The Swap and Bridge exclusions (§6.7, §6.8) are independent of that flag.
- **Orders.** Order records live in `chrome.storage.local` under `cow_orders` (amounts as decimal strings; finished records are kept 7 days), and the order status is polled from `api.cow.fi`. Explorer links go to `explorer.cow.fi`.
- **ATS-paid network fee (not active).** Code exists for paying the xStocks network fee in ATS on BNB Smart Chain, with a refund claim to the backend; `VITE_XSTOCKS_ATS_FEE_ENABLED=false` in release builds, so no such fee is shown or charged.

**Shared.**

- **No borrowed identity.** Only a catalog address on a catalog chain gets a stock's name, logo, price source and verified badge. An imported contract that uses a stock's symbol or price id gets none of these and is shown with the "unverified" warning.
- **Fail-closed sends.** If the chain of a catalog stock cannot be resolved, the send stops with an error instead of skipping the multiplier conversion. A transient RPC error during the balance pre-check no longer leaves the confirm button disabled.
- **Price source.** The backend may price stocks from the Atlas oracle; the client only displays what the backend reports. "Price: Atlas Oracle" is shown when a price is marked as coming from Atlas and is at most 10 minutes old. While the Stocks tab is open, prices (not balances) refresh every 60 seconds.

### 6.13 Buying ATS

- **Where.** Choosing ATS on BNB Smart Chain as the Swap destination turns the Swap screen into a purchase. It can also be reached from the header ATS pill and from the Buy ATS button on every screen that reports too little ATS (Send confirmation, Swap, Bridge, dapp approval). The shortcut switches to BNB Smart Chain and pre-selects the first payment token with a balance (USDT, then USDC, then BNB). From a dapp approval screen it opens the separate purchase window (§3).
- **Payment.** Only BNB, USDT or USDC. Each option shows its balance and, when a price is available, its USD value. Any other source token shows a hint instead of a DEX route.
- **Quote.** The wallet asks the service for a signed quote (`/sale/quote`). Before using it, the client checks that it names the desk and sponsor addresses pinned in the client, the wallet's own address as buyer, and the requested token and amount; the desk contract checks the quote signature on-chain. A quote is valid for 30 seconds; the screen refreshes it every 20 seconds and fetches a new one at submit time if less than 10 seconds remain. The screen shows the price, the commission included in it, and that there is no network fee. The service sets the minimum and maximum purchase amounts.
- **Execution.** The user signs one EIP-7702 / ERC-4337 operation, sponsored through `/sale/sponsor` and `/paymaster/relay`. The client builds the call list itself: approve the desk for exactly the payment amount (tokens only), `buy` on the desk (with the BNB amount as value for BNB), and, if missing, the ATS paymaster approval and a bounded collector allowance so the bought ATS can pay fees right away. A sponsor response that names a different paymaster, carries an ATS fee or does not match the quote is rejected before signing.
- **Outcomes.** Errors are shown in plain words (sale closed, amount too small or too large, not enough stock, price could not be verified, rate limited, relay failed with no funds taken). If the result cannot be confirmed, the user is told to check the balance in a few minutes.
- **From the Private Account.** With `VITE_PRIVATE_ATS_SALE=true` (the release setting) the Private Account can buy ATS on BNB Smart Chain with its own BSC funds, through the same quote and execution path. In that case the sale service receives the Private Account address together with the requester's IP, which the intro sheet states. If a quote or execution does not match the account that is active, it is refused with `PRIVATE_ATS_SALE_BLOCKED`.
- **Switch.** `ATS_SALE_ENABLED` in `src/utils/atsSaleConfig.js` (`true` in 1.10.0). The route also stays closed unless the pinned desk and sponsor addresses are valid and distinct. When it is off, Buy ATS opens an exchange page instead.

### 6.14 Display currency

- **Choice.** Settings → Preferences has a searchable currency picker. The popular list is USD, EUR, TRY, GBP, RUB, BRL, CNY, JPY, KRW, VND, IDR and INR; `VEF` and `XDR` are excluded. The full list of supported currencies comes from the server response, not from a client allowlist.
- **Default.** Derived from the browser's primary language tag. If it carries a region (for example `en-GB`), a bundled region table gives that region's currency (euro-area regions give EUR). Without a region, only languages tied to one country (`tr`, `ja`, `ko`, `vi`, `id`) give that country's currency; any other language, such as plain `en`, `de`, `es`, `pt` or `zh`, gives USD.
- **Conversion.** Prices are held in USD and converted only for display. The selection applies to Home, Send, Swap, Bridge, the token chart and the stock order summary, and to the ATS fee estimates and total cost shown on those screens. Large figures in currencies such as IDR, VND and KRW shrink the Home headline in steps. At startup the wallet waits at most 500 ms for the stored selection to be read from disk, so the first frame uses the right currency; the rate refresh over the network is never waited for.
- **Rates.** `POST {api}/getRates` (empty body, 8-second timeout) to the WATS backend. The client caches for 10 minutes and does not show a rate older than 24 hours. The response must report success and base `usd`; a table containing only USD is rejected so it cannot overwrite a good cached one, and a response with an older or unknown `updatedAt` does not replace a newer one. If the selected currency has no usable rate, amounts fall back to USD.
- **Price history.** Token price-history requests pass the currency to the existing endpoint; a response without a currency field is treated as USD. The chart reloads only when the token, range, divisor, currency or language changes.
- **Storage.** `currency` (selected code) and `fiat_rates` (cached snapshot: rates, currencies, `updatedAt`, `stale`, `fetchedAt`) in `chrome.storage.local`. The existing `language` key is now actually read at startup. Other open wallet windows follow a currency change without writing it back to disk.

### 6.15 Private Account

An optional mode, shipped on in 1.10.0 (`VITE_PRIVACY_ENABLED=true`; the related flags are in §8). It gives the wallet one extra account whose on-chain link to the user's regular accounts is broken by a third-party transfer service, SilentSwap, and it switches off the wallet surfaces that would otherwise tie that account to the user. Every claim below is a statement about what this client does; the service itself is outside this repository.

**Account and mode.**

- One Private Account per wallet, EVM only, created the first time the user enters private mode. The first entry shows an information sheet that must be accepted before the account is created; it lists what the mode does not hide (below). Creation needs the wallet to be unlocked and writes nothing if it fails. The derivation and storage are in §4.1 and §4.2.
- There is no separate "enabled" setting. Private mode is on exactly when the active account is the Private Account, and that identity is matched against the vault record by address, key and derivation path. Storage holds `privacy_mode` (`lastPublicAccountKey`, `introSeen`) and `privacy_frozen_network`, next to the usual `active_account` and network keys.
- Entering switches to BNB Smart Chain if the current network does not fit the account, and records the network that dApps were seeing. Leaving returns to the previously active regular account (or the first one) and restores the earlier network when it is still valid. Transitions are serialized, and a half-finished one is repaired when the service worker starts. On entering or leaving, every pending approval window is cancelled with 4001 "User closed the window.".

**Moving money.** All transfers go through SilentSwap (`https://api.silentswap.com`) using `@silentswap/sdk` and `@silentswap/chains`, both pinned to 2.3.0. Requests are made only from the service worker, with timeouts.

- **Add funds** moves assets from a regular account to the Private Account. **Send** moves assets from the Private Account to a recipient address. With `VITE_PRIVATE_SWAP_BRIDGE=true` the private **Swap** and **Bridge** screens are self-only: the recipient is always the Private Account itself, either another deliverable asset on the same network (Swap) or another open network (Bridge). Classic Swap and Bridge (including their ATS fee quotes) are refused for the Private Account (`PRIVATE_SWAP_BRIDGE_CLOSED`), and the Swap screen in private mode is only the ATS purchase (§6.13).
- **Networks.** Ten, with BNB Smart Chain first: BNB Smart Chain, Ethereum, Base, Arbitrum One, Optimism, Polygon, Gnosis, Celo, Mantle and Cronos. Funds delivered to the Private Account can leave only through Send, so the Add-funds list may only contain networks that have a Send source; the production build fails otherwise.
- **Sources.** A fixed table. BNB Smart Chain USDC goes straight to the SilentSwap gateway. Other chains go through Relay Depository deposits whose call data is decoded and matched exactly: Ethereum USDC, USDT, DAI and ETH; Optimism USDC, USDT and ETH; Cronos, Gnosis, Mantle and Celo USDC; Polygon USDC and USDT; Base USDC and ETH; Arbitrum USDC, USDT and ETH. Anything outside the table (for example BNB Smart Chain USDT or BNB) is refused. Approvals are for the exact amount; the SDK's unlimited-allowance helpers are not used.
- **Deliverable assets (funds delivered to the Private Account).** Native coins (BNB, POL, xDAI, CELO, MNT, CRO) cannot be delivered, because the network fee is paid in ATS and there is no native-gas exception; ETH can be delivered on Ethereum-family networks. Tokenized stocks cannot be delivered.
- **Limits.** One recipient per order. The minimum payout is 12 USDC, raised if the service's public status reports a higher minimum; a maximum is applied when the status reports one. If the status cannot be read, the built-in minimum applies with no upper cap. At most 15 quotes are requested per 60 seconds.
- **Fees.** The order total includes SilentSwap's service fee and the integrator fee, added on top of the amount the recipient receives. The client caps the sum of the two fees at 1% of the requested amount and refuses a quote above the cap or whose amounts do not add up. On routes through Relay the cap covers only those two fees; any exchange or bridge spread in the conversion to the gateway's USDC is not checked. The fee percentage shown is read from the service's status; a dash is shown when it is unknown.
- **Quote checks.** Before anything is shown or signed, the quote is checked against the request (recipient, amount, chain, asset, deposit target and call data, fee sum and cap, ticket format, gateway), and the order record is read back and checked (status awaiting deposit, signer equal to the source address, a single recipient equal to the requested one). Call data containing `approve`, `transfer`, `permit` or `setApprovalForAll`-style selectors is refused. A mismatch gives `PRIVATE_QUOTE_MISMATCH` and nothing is signed. A quote must have 20 seconds left at signing. These checks narrow what the client trusts; they cannot verify delivery, which happens off-chain.
- **Quotes and orders.** Quotes, with their deposit data, are held in session storage (`private_quotes`, 30 minutes); the screens get only a summary and a ticket. Order records are kept in `chrome.storage.local` under `private_orders` and are never sent to the WATS backend, so that backend does not learn the link between the two accounts. They exist on this device only. A deposit whose outcome is uncertain and that has no transaction hash ends as `PRIVATE_DEPOSIT_UNTRACKED` and leaves no record.
- **Refunds.** A refund (`PRIVATE_REFUND`) can be claimed only for an EVM source, not yet settled, status open or failed, no recipient in flight, order expiry passed, and an order signer equal to the source address. It is paid to that signer through the gateway's `refund(ticket)`, and its network fee can also be paid in ATS. A badge shows open and refundable orders.
- **Provider status.** `GET /dest-assets` on the SilentSwap host is public and carries no address (enabled, maintenance, limits, fee in basis points); it is sent without credentials with an 8-second timeout and cached for 60 seconds (15 seconds after a failure). Order calls use 28-second (quote) and 20-second timeouts.
- **Integrator id.** `VITE_SILENTSWAP_INTEGRATOR_ID` is a public identifier (`int_` plus 24 lowercase alphanumerics) shipped in the bundle. A production build with privacy on fails if it is missing or malformed. The manifest in a production build carries no `key`; one is written only in development builds.

**Network fees in private mode.** The deposit operation, including its approval (an existing non-zero allowance is reset to zero first), and Private Account transfers pay their network fee in ATS on every network, through the paymaster path of §6.9. The ATS fee quote and the sponsored operation carry the Private Account address and the requester's IP to the WATS backend and bundler (api.extension.watswallet.com), which the intro sheet states. A shortage of ATS is reported as `PRIVATE_INSUFFICIENT_GAS` or `PRIVATE_INSUFFICIENT_ATS`.

**Isolation inside the wallet.**

- *dApps.* While private mode is on, every site looks unconnected: `eth_accounts` and `wallet_getPermissions` return an empty list, `wallet_revokePermissions` does nothing, and `eth_sendTransaction`, `personal_sign` and `eth_signTypedData_v4` get the error an ungranted site gets (4100). `eth_requestAccounts` and `wallet_switchEthereumChain` open the private-mode notice window and the page receives the ordinary user-rejected error (4001) with its ordinary wording, never a `PRIVATE_*` code. TonConnect and Solana requests are blocked the same way (a TonConnect disconnect is still allowed). The Private Account address is removed from every stored or announced dApp account list; entering private mode sends `accountsChanged` with an empty list to connected EVM sites; `chainChanged` is not broadcast while private mode is on, and sites keep seeing the network from before entry. The read-only RPC passthrough (§6.10) is deliberately not blocked, so a public RPC provider sees the requester's IP for calls the page chooses; those calls carry no Private Account data.
- *Protection in normal mode.* A dApp `eth_sendTransaction`, `personal_sign` or `eth_signTypedData_v4` request, or a wallet Send, whose payload contains the Private Account's 20-byte address in any form (raw hex, hex-encoded text, `uint160` decimal; case-insensitive) is refused as an ordinary user rejection (`RECIPIENT_IS_PRIVATE` for sends). Approval results that name the Private Account, or that arrive while private mode is on, become rejections. In private mode a regular account can be the target of a transfer only as the Private Account (`PRIVATE_TRANSFER_TARGET`).
- *Messages.* Any runtime message whose action starts with `PRIVATE_` or contains `_PRIVATE_` is treated as internal and refused from web pages, as are the actions that toggle or probe private mode (`PRIVACY_MODE_SET`, `PRIVATE_QUOTE`, `PRIVATE_ORDER`, `PRIVATE_ORDERS`, `PRIVATE_REFUND`, `ATS_PRIVATE_FEE_QUOTE`, `PRIVATE_PROVIDER_INFO`). When the build has privacy off they answer `PRIVACY_DISABLED`.
- *Records.* Transaction cards are filtered by account: private mode shows only the Private Account's records, and records without an account key show only in normal mode. The sent-recipient list is split the same way (entries from the Private Account carry `private: true`; old unlabelled entries count as normal). A Private Account sender triggers no remote history enrichment, and addresses belonging to the user's own vaults, including the Private Account, are not sent for the reputation lookup of §6.4. The news item `bstocks-support` is hidden in private mode.

**What the wallet stops doing in private mode.** Solana and TON send, sign and connect; EVM dApp access and the connected-sites list; xStocks (every `COW_*` action, the Stocks tab, trade and detail screens); classic Swap and Bridge; the screens that reveal or manage recovery phrases and keys, and adding accounts; the "All networks" scope (it falls back to the active network). Price, rate and price-history requests (`/getTokensDataById`, `/getTokenDataById`, `/getTokenPriceHistory`, `/getTokenByAddress`, `/getRates` and `api.coingecko.com`) are rejected locally with `PRIVATE_PRICE_OFF`, so no USD values or charts are shown. Token logos load only from bundled files and avatars are neutral local art. Transaction history is requested from the WATS activity server only for the networks it supports (six of the ten: BNB Smart Chain, Ethereum, Base, Arbitrum One, Optimism and Polygon). The daily usage ping never sends and no install id is created; it is off in release builds anyway (§8).

**What third parties can observe.**

| Party | Sees |
|---|---|
| SilentSwap | For each order: the source (signing) address, the recipient address, the destination chain and asset, the amount, the integrator id, and the requester's IP |
| Relay and the networks | The deposit transaction on the source chain, which is public on-chain like any transaction |
| WATS backend and bundler | The Private Account address and the requester's IP with each ATS fee quote and sponsored operation, including funding from a regular account; the regular account's address with the same IP in the same flow; the Private Account address and IP when buying ATS. Order records are not sent |
| Public RPC providers | The requester's IP for read calls a page chooses while private mode is on |
| Token-logo hosts | None of the above in private mode, because remote logos are not requested |

**What private mode does not hide.** The information sheet lists it: depositing and withdrawing the same amount within a short time can reveal the link; the requester's IP is visible to providers and the mode is not a VPN; the WATS fee service can see the regular and the Private Account address from the same IP when funds are added; giving the Private Account address to a place tied to the user's identity, such as an exchange, ends the separation; the user relies on SilentSwap while a transfer settles; and private transaction records are kept only on this device.

---

## 7. Backend contract

The WATS backend services the client talks to are **not in this repository**. They exist because extension code is public by nature and cannot hold a secret: every third-party API key stays server-side. The backend also stores the username profile created during onboarding (username and EVM address).

The client also talks directly to some third parties that need no key: the LI.FI API (`li.quest`) for bridge quotes and token lists, public EVM RPC endpoints from the bundled chain list (also used by the account scan on import, §6.1, which sends derived public addresses), and `raw.githubusercontent.com`, which serves Trust Wallet token logos that are not bundled (§6.2; it sees the requester's IP and the contract address shown). For Private Account transfers (§6.15) it calls `api.silentswap.com` (order quotes, order status, deposit transaction submission and a public status read), which receives the source and recipient addresses, the destination, the amount and the requester's IP. Identicons are generated locally and no longer fetched. For xStocks (§6.12) it also calls `api.cow.fi` (quotes, orders and order status; it receives token addresses, amounts, the wallet address and the signed order) and `api.xstocks.fi` (market status only, no user data, credentials omitted). Block-explorer links for orders go to `explorer.cow.fi`. The bStocks issuer logo is bundled, not fetched. The wallet sends no usage statistics (§8).

Endpoints the client calls, by purpose:

| Purpose | Endpoints |
|---|---|
| Token metadata, search, price | `/getTokenDataById`, `/getTokensDataById`, `/getChainTokens`, `/getTokenByName`, `/getTokenByAddress`, `/getImportedTokens` |
| Price chart | `/getTokenPriceHistory` (with a currency) |
| Fiat rates | `/getRates` |
| Profile and username | `/profile`, `/checkUsername`, `/profile/changeUsername`, `/profile/getProfile` |
| History | `/wallet/history`, `/ton/history`; `/solana/history` only when Solana is enabled |
| Recipient screening | `/wallet/reputation` |
| Announcements | `/news` |
| Chain RPC proxies | `/ton/rpc` (including the balance read before a dapp TON approval, §6.10), `/ton/swap/simulate`; `/solana/rpc`, `/solana/tokens` (intended only for Solana-enabled builds — see §10 for an exception) |
| Fiat on-ramp (hidden: `ONRAMP_ENABLED = false` in `src/utils/onrampConfig.js`; code kept but unreachable) | `/moonpay/getSignUrl` |
| ATS paymaster (separate host, pinned in `src/utils/atsConfig.js`) | `/health`, `/paymaster/status`, `/paymaster/quote`, `/paymaster/sponsor`, `/paymaster/relay`, `/paymaster/ton/*` |
| In-wallet ATS purchase (same host, §6.13) | `/sale/quote`, `/sale/sponsor`, then `/paymaster/relay` |
| Private Account fees (same paymaster host, §6.15) | the paymaster quote and sponsor calls above, carrying the Private Account address |
| ERC-20 bundler proxy (dormant on curated chains, §6.9 B) | `/bundler/auth`, `/rpc/:chainId` |

**The contract the client assumes.** Read paths may fail; the UI degrades — except that EVM spending on the curated chains needs the ATS paymaster (§1.1).

The ATS paymaster (including `/paymaster/ton/*`) is unauthenticated: the client calls it directly with no token, and each operation is authorised by the user's own signature over that operation (the signed user operation, the EIP-7702 authorization, the `XcFeeAuth` fee authorization on cross-chain operations, or the TON message and fee signatures). Only the dormant ERC-20 bundler proxy uses a short-lived token, which the client gets from `/bundler/auth` by signing a login message with the user's EOA; `/profile/changeUsername` carries a per-request signature. Any rate limiting is enforced server-side and is not part of this repository.

The services never hold a user key and never sign on the user's behalf. They can move the user's ATS only within allowances the user signed during setup on BSC: an unlimited ATS allowance to the paymaster contract, and a bounded allowance (a server-suggested budget) to the fee collector, which a service key triggers. On the cross-chain path the fee is pulled on BSC before the target-chain operation runs; when the service asks for it, that pull is also bound to the user's `XcFeeAuth` signature for the specific operation (§6.9). The ATS purchase spends only the payment amount the user approved for the sale desk, through an allowance equal to that amount. Beyond those allowances, nothing moves without the user's signature.

Tokenized-stock prices may come from the Atlas oracle, read by the backend; the client sees only the `price_source` and `price_updated_at` fields on the existing token endpoints.

---

## 8. Configuration

`.env.development` and `.env.production` are committed and hold no secrets — only backend base URLs and feature flags. All flags are strict: only the exact string `true` enables a feature.

| Variable | Meaning |
|---|---|
| `VITE_API_URL` | Base URL for token, profile, history, reputation, news and TON proxy endpoints |
| `VITE_BUNDLER_BASE` | Base URL for the ERC-20 bundler proxy (§6.9 B). The ATS paymaster host is pinned in `src/utils/atsConfig.js`, not here. |
| `VITE_SOLANA_ENABLED` | Build-time flag. Only the exact string `true` enables Solana: its content script in the manifest, the background actions and the chain record. `false` in both committed files; forced to `true` in the test run (`vitest.config.js`) so the Solana code stays tested. |
| `VITE_XSTOCKS_ENABLED` | Build-time flag for xStocks trading (§6.12). `true` in the production file. When it is not `true`, the Stocks tab shows only bStocks and every `COW_*` background action is refused. |
| `VITE_XSTOCKS_ATS_FEE_ENABLED` | Pays the xStocks network fee in ATS, with a refund claim. `false` in release builds; the code is present but inactive. It has no effect unless the xStocks flag is on. |
| `VITE_PRIVACY_ENABLED` | Build-time flag for the Private Account and private mode (§6.15). `true` in the production file. When it is not `true`, the private-mode background actions answer `PRIVACY_DISABLED`, and a profile that has the Private Account active is rolled back to a regular account at startup. |
| `VITE_PRIVATE_ATS_SALE` | Lets the Private Account buy ATS (§6.13). `true` in the production file. |
| `VITE_PRIVATE_SWAP_BRIDGE` | Private Swap and Bridge screens (self-transfers into the Private Account through SilentSwap, §6.15). `true` in the production file. |
| `VITE_PRIVATE_SEND_CHAINS`, `VITE_PRIVATE_FUND_CHAINS` | Comma-separated chain ids on which private Send and Add funds are offered. Both are `1,56,8453,42161,10,137,100,42220,5000,25` in the production file. A production build with privacy on fails if the fund list is invalid, lacks 56, or contains a chain with no Send source. |
| `VITE_SILENTSWAP_INTEGRATOR_ID` | The public SilentSwap integrator id (`int_` plus 24 lowercase alphanumerics). Not a secret. A production build with privacy on fails if it is empty or malformed. |
| `VITE_ANALYTICS_ENABLED` | An anonymous daily ping (an install id, the version and the locale) with a one-time notice card. `false` in release builds, so no ping is sent; the code is present but inactive. |

Two further switches are constants in the source, not environment variables: `ATS_SALE_ENABLED` (`src/utils/atsSaleConfig.js`, `true` in release builds) turns on the in-wallet ATS purchase (§6.13), and `ONRAMP_ENABLED` (`src/utils/onrampConfig.js`, `false`) keeps the hidden MoonPay screen unreachable.

To override a value locally, create `.env.development.local` or `.env.production.local`. A plain `.env.local` is loaded before the mode-specific files, so it cannot override keys they define.

---

## 9. Quality bar

- **727 test files** (17,021 tests) run with Vitest (`npm test`; `npm run test:az-bellek` limits workers on low-memory machines). The Solana flag is forced on in tests, so the disabled feature stays verified. At the v1.10.0 tag, a `test:az-bellek` run ended with 5 failing tests in 9 failing files; all nine are cross-repository contract tests that read the maintainers' private repository and fail here (see README).
- Money-critical logic is extracted into **network-free pure modules** — fee maths, route selection, commission regions, recipient matching, swap validation, ATS quoting — so it can be unit-tested without an RPC or a live operation. Embedded in components, these could only ever be verified by spending real money.
- **On-chain verification instead of trusted constants.** `npm run verify:routers` re-checks every swap router, factory and quoter against the chain: bytecode presence, `router.factory()` agreement, V2 pool reserves and `getAmountsOut`, V3 quoter signature. `npm run verify:bstocks` does the same for the tokenized-stock catalog, and `npm run measure:bstocks` measures each stock's DEX liquidity through the wallet's own swap route. Fee values were measured against the constant-product formula, not copied from documentation.
- **Manual browser verification is a separate gate.** A green test suite is not a release signal: MV3 service-worker behaviour and provider injection are only provable in a real browser. Node-only tests pass on code paths that fail inside a service worker, where `window` does not exist.

---

## 10. Known limitations

| # | Limitation |
|---|---|
| 1 | **Solana is disabled in release builds.** Solana accounts, transfers and dapp signing are implemented and tested, but `VITE_SOLANA_ENABLED=false` keeps the provider out of the manifest, drops the chain from the network list and makes the background refuse every Solana action. |
| 2 | **`window.ethereum` is claimed only when the slot is empty.** With another EVM wallet installed, dapps that read `window.ethereum` directly will not reach WATS. Dapps using EIP-6963 discovery still list it. |
| 3 | **EVM spending depends on the ATS paymaster.** On the curated EVM chains there is no native-gas fallback: if the paymaster service is unavailable, or the ATS balance or one-time setup is missing, EVM transactions are blocked. A user with no ATS can buy it in the wallet with USDT, USDC or BNB on BNB Smart Chain (§6.13), which itself needs no ATS. |
| 4 | **TonConnect discovery.** WATS is not yet registered in the public TON wallets list (`ton-connect/wallets-list`). Current `@tonconnect/sdk` versions (3.3 and later, including 4.x) no longer discover unregistered injected wallets, so most TON dapps will not offer WATS until it is registered. `npm run ton:test` serves a local test page pinned to SDK 2.2.0, which still discovers injected wallets. |
| 5 | **Legacy TON addresses are not shown.** Earlier builds derived TON addresses over SLIP-10 (`m/44'/607'/{i}'`). The old address stays in the account record (`tonAddressLegacy`) but has no UI, and above index 0 it cannot be opened by phrase in other wallets. If an account from an earlier build first resolves its TON address on TON Testnet after the upgrade, the old mainnet address is not re-derived and mainnet TON signing fails with `TON_ADDRESS_MISMATCH` (§4.1). |
| 6 | **Solana endpoints can still be called with Solana disabled.** Accounts imported from a TON phrase carry a Solana address, and the home screen's default "All networks" view loads Solana balances for them, so release builds call `/solana/rpc` and `/solana/tokens` for those accounts (not while the Private Account is active). |
| 7 | **TON contract version changes the address.** The same keypair under V4 and V5R1 yields different addresses, and on W5 the network id lives inside the contract, so a mainnet/testnet mix-up produces a valid-looking wrong address. |
| 8 | **Scope limits.** Private-key accounts have no TON address; a raw TON secret key cannot be imported; TON cannot be bridged; bStocks exist only on BNB Smart Chain and neither bStocks nor xStocks can be bridged out. |
| 9 | **No hardware-wallet support and no non-seed recovery path.** Losing the seed phrase and the password means losing the wallet. |
| 10 | **Cross-chain fees are not refunded if the operation fails on the target chain.** The ATS fee is collected on BNB Smart Chain before the target-chain operation runs. If that operation is included but its inner call fails (for example, it runs out of gas), the fee is not returned. Gas estimates are widened to make this less likely (§6.9). |
| 11 | **Freshly generated phrases have no screen timer.** The 60-second auto-clear applies to screens that reveal an existing secret; the phrase shown during onboarding and Settings → Create account stays on screen until the user moves on (§4.2). |
| 12 | **xStocks depend on external services and a fixed catalog.** Orders go through `api.cow.fi` and market status comes from `api.xstocks.fi`; the reference price comes from the WATS backend and has no staleness check. Buy is locked when the market is closed or unknown and Sell is not. The catalog is a hard-coded list of 21 entries; a stock appears only after it is added in a release, and not every stock is available on every chain. |
| 13 | **Account scan is partial by design.** It covers the EVM only (10 networks), at most 20 accounts per phrase, and stops after 3 unused indexes in a row, so accounts beyond such a gap are not found. It relies on public RPC endpoints; on a network failure or after 60 seconds it silently adds what it found. |
| 14 | **Display currency needs fresh backend rates.** Without a rate table younger than 24 hours, or when the selected currency is missing from it, everything is shown in USD. |
| 15 | **The TON balance check before a dapp approval can pass blindly.** It runs on TON mainnet only, and when the balance cannot be read within 3 seconds the request goes on to the approval screen. |
| 16 | **Inactive code.** The ATS-paid network fee for xStocks and the daily usage ping are in the source but switched off in release builds. |
| 17 | **The Private Account depends on a third party and does not make transfers untraceable.** Delivery happens off-chain at SilentSwap, which the client cannot verify, and SilentSwap sees the source address, the recipient address, the amount and the requester's IP. The WATS backend and bundler see the Private Account address and IP when ATS fees are sponsored, and the sale service sees them when ATS is bought. Matching amounts and timing, the requester's IP, and sharing the address with an identity-tied service can all link the accounts (§6.15). |
| 18 | **The Private Account is narrow by design.** One per wallet, EVM only, and only for wallets made from a recovery phrase (private-key and TON-phrase vaults cannot create one). It moves money only through SilentSwap, from a fixed table of source assets, one recipient per order, at least 12 USDC (more if the service says so), with network fees in ATS. Native coins and tokenized stocks cannot be delivered to it. A provider outage, maintenance or a changed limit stops transfers; a refund is possible only under the conditions in §6.15. |
| 19 | **Private mode removes features.** While it is on there is no dApp, Solana, TON or xStocks access, no classic Swap or Bridge, no fiat values, charts or remote token logos, no recovery-phrase or key screens and no all-networks view. The read-only RPC passthrough for pages still runs and shows the requester's IP to the public RPC provider. |
| 20 | **Private order records live on one device.** `private_orders` is not synced, not sent to the backend and not restored by the recovery phrase; the Private Account itself is restored by the phrase, but its order history and refund badge are not. |
| 21 | **The bridge quote check does not decode call data.** It compares the receiver LI.FI reports with the signing account; a quote that reports the right receiver but encodes another in its call data is not caught (§6.8). |
| 22 | **Logoless tokens are hidden from selector and search lists.** A token that none of the logo sources (§6.2) can supply does not appear there, although a held token with a balance stays visible in the wallet's asset list with a monogram. |

---

## 11. Glossary

| Term | Meaning |
|---|---|
| **Vault** | An encrypted container for one secret: a seed phrase and the accounts derived from it, a single imported private key, or an imported TON phrase. A user may hold several. |
| **Account index** | The shared `{i}`: the EVM path index and an input to the per-account TON phrase derivation. One index = one identity across EVM and TON (and Solana, when enabled). |
| **ATS** | The token in which network fees are collected — for sends, swaps, bridges and dapp transactions on the curated EVM chains, and for relayed TON operations. Always settled on BNB Smart Chain. |
| **Cross-chain collection** | Sponsoring an operation on the target chain while pulling the fee on BSC. |
| **`XcFeeAuth`** | The EIP-712 message a user signs to authorise the ATS fee for one specific cross-chain operation. |
| **Sale desk** | The contract on BNB Smart Chain that sells ATS for USDT, USDC or BNB against a signed quote (§6.13). Its address is pinned in the client. |
| **bStocks** | Tokenized-stock certificates on BNB Smart Chain, a Binance product issued by BTech Holdings Limited (ADGM/FSRA): certificates over shares, not shares. |
| **xStocks** | Tracker certificates issued by Backed Assets (JE) Limited, traded in the wallet as CoW Protocol orders on Ethereum, BNB Smart Chain and Arbitrum One (§6.12). Not related to bStocks. |
| **Private Account** | The optional extra EVM account of §6.15, derived at `m/44'/60'/0'/1/0`, used in private mode and funded or emptied only through SilentSwap. |
| **SilentSwap** | The third-party transfer service the Private Account uses (`api.silentswap.com`). |
| **Fail-open / fail-closed** | Advisory services degrade to "unknown" and let the user proceed; authority gates reject on doubt. |
| **GRAM** | The display name and symbol of TON's native coin in this wallet. |
| **Jetton** | A fungible token on TON, the equivalent of an ERC-20. |
| **W5 / V5R1** | The TON wallet contract version used for derived accounts. |

---

*Source comments in this repository are written in Turkish, and some refer to internal design documents that are not part of it; see [`README.md`](README.md#contributing).*
