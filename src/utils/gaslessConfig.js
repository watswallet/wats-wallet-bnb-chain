// EIP-7702 + Pimlico ERC-20 paymaster yapilandirmasi.
// permissionless to7702SimpleSmartAccount varsayilan delege impl'i (EntryPoint v0.8).
export const SIMPLE_ACCOUNT_IMPL = '0xe6Cae83BdE06E4c305530e199D7217f42808555B'

// EIP-7702'nin mainnet'te canli oldugu zincirler. Avalanche (43114) HARIC.
export const GASLESS_CHAINS = [1, 56, 8453, 10, 42161, 137]

export const isGaslessChain = (chainId) => GASLESS_CHAINS.includes(Number(chainId))

// chainId -> Trust Wallet assets blockchain klasoru (token logosu icin).
const TRUSTWALLET_CHAIN = {
  1: 'ethereum',
  56: 'smartchain',
  137: 'polygon',
  10: 'optimism',
  42161: 'arbitrum',
  8453: 'base',
}

// Token adresinden logo URL'i (Trust Wallet CDN). Adres CHECKSUM'li olmali.
// Bulunamazsa UI monograma duser (<TokenLogo> @error fallback).
export function tokenLogoURI(chainId, address) {
  const chain = TRUSTWALLET_CHAIN[Number(chainId)]
  if (!chain || !address) return ''
  return `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${chain}/assets/${address}/logo.png`
}
