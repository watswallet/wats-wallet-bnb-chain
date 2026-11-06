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
  xStocks issuer API, LI.FI, public RPC endpoints)
- third-party dependencies without a demonstrated exploit path in this code
- findings that require a compromised device or a malicious browser extension
  already installed with equal privileges

## Supported versions

Only the latest released version, currently 1.9.4, receives security fixes. Please
confirm that a problem is present in that version before reporting it.
