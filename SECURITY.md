# Security Policy

WATS Wallet holds user funds. Please treat any finding that could lead to key
disclosure, unauthorized signing, or loss of funds as high severity.

## Reporting a vulnerability

**Do not open a public issue.**

Use GitHub's private vulnerability reporting: go to the **Security** tab of this
repository and click **Report a vulnerability**. This creates a private advisory
visible only to the maintainers.

Please include:

- affected version and browser
- steps to reproduce, or a proof of concept
- what an attacker gains

You can expect an initial response within 7 days. Please give us a reasonable
window to ship a fix before public disclosure.

## Scope

In scope:

- key generation, encryption, storage and unlock flows
- the dApp providers (`src/injected.js`, `src/tonInjected.js`) and the approval
  flows behind them — origin spoofing, permission escalation, cross-origin session
  confusion. `src/solanaInjected.js` is in the source but not in release builds; it
  is registered only when built with `VITE_SOLANA_ENABLED=true`.
- transaction construction and the confirmation screens (what the user is shown
  versus what is actually signed), including EIP-712 typed-data signing and its risk
  classification (`src/utils/eip712/`, `src/utils/dappTypedData.js`)
- the client's own checks on fee sponsorship responses before signing — the
  paymaster allowlist (built-in per-chain addresses plus any the paymaster service's
  `/health` reports; the unlimited ATS approval always goes to the built-in
  address), the quote cap, the TON fee authorization domain, and verification of the
  server-built TON relay payload against what the user approved
  (`src/utils/ton/tonQuoteVerify.js`), and the cross-chain fee authorization
  (`XcFeeAuth`: domain and fields pinned and matched to the operation before signing)
- the in-wallet ATS purchase: the client's checks of the sale quote and sponsor
  response against the pinned desk and sponsor addresses (`src/utils/atsSale.js`,
  `src/utils/atsSaleConfig.js`), and the separate purchase window, which must never
  pass through a dApp approval screen
- approval-window rate limiting (`src/utils/approvalThrottle.js`) and the read-only
  RPC passthrough for dApps (`src/utils/evmReadRpc.js`, `src/utils/evmRpcPolicy.js`)
- the Private Account and private mode (`src/utils/privacy/`, the private-mode
  parts of `src/background.js` and `src/utils/messageGate.js`): its derivation and
  storage (it must never be exposed as a dApp account or be resolvable for dApp
  signing), the private-mode message gate (every background action classified, web
  pages unable to call `PRIVATE_*` actions or toggle the mode), the checks of
  SilentSwap quotes and order records against the request before anything is signed
  (`src/utils/privacy/silentswap.js`, `providerGuard.js`), the pinned gateway and
  Relay Depository deposit targets with exact call-data matching, refund conditions,
  and any path by which private mode could leak the Private Account's address,
  records or IP to a site, a price or logo host, or the WATS backend beyond what
  [spec.md §6.15](spec.md#615-private-account) documents
- the bridge quote check (`src/utils/bridgeQuoteGuard.js`): receiver and signer
  matching between the quote and the signed transaction
- the xStocks trading path (`src/utils/cow/`): order construction and EIP-712
  signing, the pinned settlement and vault-relayer addresses, token approvals and
  permits, the order-quote store, and the rule that the `COW_*` background actions
  are unreachable from web pages
- TonConnect request validation and the pre-approval TON balance check
  (`src/utils/ton/tonConnectMessages.js`, `src/utils/ton/tonConnectManifest.js`,
  `src/utils/tonDappFunctions.js`)
- the account scan on import (`src/utils/accountScan.js`,
  `src/utils/evmUsageProbe.js`): it must send only derived public addresses and
  never a phrase or key
- content script / service worker message handling
- the side panel and the state it shares with other wallet windows

Out of scope:

- the hosted backend API and the ATS paymaster service themselves (not part of this
  repository), and the third-party services the client calls (CoW Protocol, the
  xStocks issuer API, LI.FI, SilentSwap and Relay, the Trust Wallet asset
  repository, public RPC endpoints). Weaknesses in how those services deliver,
  retain or expose transfers are theirs; how the client validates what they return
  is in scope
- third-party dependencies without a demonstrated exploit path in this code
- findings that require a compromised device or a malicious browser extension
  already installed with equal privileges

## Supported versions

Only the latest released version, currently 1.10.0, receives security fixes. Please
confirm that a problem is present in that version before reporting it.
