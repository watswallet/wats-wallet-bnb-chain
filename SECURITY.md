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
  versus what is actually signed)
- the client's own checks on fee sponsorship responses before signing — the pinned
  paymaster address, the quote cap, the TON fee authorization domain, and TON swap
  quote verification
- content script / service worker message handling
- the side panel and the state it shares with other wallet windows

Out of scope:

- the hosted backend API and the ATS paymaster service themselves (not part of this
  repository)
- third-party dependencies without a demonstrated exploit path in this code
- findings that require a compromised device or a malicious browser extension
  already installed with equal privileges

## Supported versions

Only the latest released version receives security fixes.
