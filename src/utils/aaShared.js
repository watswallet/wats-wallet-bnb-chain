// EIP-7702 + ERC-4337 ortak kurulum. Hem Pimlico (swap/bridge/dapp) hem ATS (transfer)
// kollari BURAYI kullanir ki EntryPoint surumu tek yerden yonetilsin.
import { createPublicClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { to7702SimpleSmartAccount } from 'permissionless/accounts'
import { entryPoint08Address } from 'viem/account-abstraction'

// to7702SimpleSmartAccount (eip7702:true) EntryPoint v0.8 kullanir. Paymaster tarafi AYNI
// entryPoint'le kurulmazsa v0.7'ye duser -> yanlis paymaster/spender -> postOp
// transferFrom basarisiz (TransferFromFailed / AA50). Hepsi v0.8'de hizali olmali.
export const ENTRY_POINT = { address: entryPoint08Address, version: '0.8' }

// chainId -> viem chain objesi (minimal). permissionless chain.id ister.
export function viemChain(chainId, rpcUrl) {
  return {
    id: Number(chainId),
    name: `chain-${chainId}`,
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  }
}

// Mevcut EOA'yi (ayni adres) 7702 smart account olarak kurar.
export async function build7702Account({ privateKey, chainId, rpcUrl }) {
  const chain = viemChain(chainId, rpcUrl)
  const owner = privateKeyToAccount(privateKey)
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) })
  const account = await to7702SimpleSmartAccount({ client: publicClient, owner, entryPoint: ENTRY_POINT })
  return { chain, owner, publicClient, account }
}
