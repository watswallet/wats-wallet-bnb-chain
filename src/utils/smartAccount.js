import { ethers } from 'ethers'
import { http } from 'viem'
import { createSmartAccountClient } from 'permissionless'
import { createPimlicoClient } from 'permissionless/clients/pimlico'
import { prepareUserOperationForErc20Paymaster } from 'permissionless/experimental/pimlico'
import { SIMPLE_ACCOUNT_IMPL, tokenLogoURI } from './gaslessConfig'
import { ENTRY_POINT, viemChain, build7702Account } from './aaShared'

// EIP-7702 delegation designator = 0xef0100 || impl_address (23 byte).
const DELEGATION_PREFIX = '0xef0100'

// Delege edilen implementasyon adresini cikarir (delege degilse null).
export function delegatedImplementation(code) {
  if (typeof code !== 'string') return null
  const lower = code.toLowerCase()
  if (!lower.startsWith(DELEGATION_PREFIX)) return null

  const impl = lower.slice(DELEGATION_PREFIX.length)
  if (impl.length !== 40) return null
  return `0x${impl}`
}

/**
 * EOA BIZIM bekledigimiz implementasyona mi delege edilmis?
 *
 * Yalnizca 0xef0100 on ekine bakmak yetmiyordu: baska bir cuzdanin 7702
 * delegator'una delege edilmis bir EOA da "delege" sayiliyor, dolayisiyla
 * authorization imzalanmiyordu. Bundler ise userOp'u BASKA bir ABI/dogrulama
 * semasina sahip kontrata karsi simule ediyor ve islem kaliCi olarak basarisiz
 * oluyordu. Hedef implementasyon da karsilastirilir; farkliysa delege
 * sayilmaz ve yeni bir authorization imzalanir (bizim impl'e yeniden delege eder).
 */
export function isDelegated(code, expectedImpl = SIMPLE_ACCOUNT_IMPL) {
  const impl = delegatedImplementation(code)
  if (!impl) return false
  if (!expectedImpl) return true
  return impl === String(expectedImpl).toLowerCase()
}

// supportedTokens: [{ token, symbol, decimals }] (Pimlico getSupportedTokens)
// heldTokens: [{ address, balance:Number }] (kullanicinin tuttuklari)
// -> kullanicinin yeterli bakiyeyle tuttugu desteklenen tokenlar (balance birlestirilmis)
export function filterGasTokens(supportedTokens, heldTokens) {
  const heldMap = new Map(heldTokens.map((t) => [String(t.address).toLowerCase(), t.balance]))
  return supportedTokens
    .map((t) => ({ ...t, balance: heldMap.get(String(t.token).toLowerCase()) || 0 }))
    .filter((t) => t.balance > 0)
}

// 7702 + ERC-20 paymaster userOp'unun TAHMINI toplam gas'i (temsili sabit). Gercek deger send
// aninda Pimlico tarafindan hesaplanir; bu yalnizca UI'da "bu token gas'i karsilar mi" on-tahmini
// icindir. Basit transfer ~300-400k; 500k makul-ust (hafif konservatif = borderline'da bloklar).
export const EST_USEROP_GAS = 500000n

// Bir tokenle gas'in TAHMINI maliyeti (insan birimi). Pimlico formulu (singleton paymaster):
//   maxCostInToken = ((userOpGas + postOpGas) * maxFeePerGas * exchangeRate) / 1e18
// (bkz. permissionless/experimental/pimlico prepareUserOperationForErc20Paymaster). Girdiler bigint.
export function estimateTokenGasFee({ exchangeRate, postOpGas, maxFeePerGas, decimals, userOpGas = EST_USEROP_GAS }) {
  if (!maxFeePerGas || !exchangeRate) return null
  const raw = ((userOpGas + (postOpGas || 0n)) * maxFeePerGas * exchangeRate) / 1000000000000000000n
  return Number(ethers.formatUnits(raw, Number(decimals)))
}

// Bu zincirde gas icin kullanilabilecek tokenlar.
// NOT: permissionless 0.3.6'da "tum desteklenenleri listele" metodu (getSupportedTokens) YOK.
// Bu yuzden aday tokenlardan (kullanicinin tuttuklari + gonderilen token) gidip her birini
// pimlico_getTokenQuotes ile dogrularız: quote donen token = Pimlico'nun gas icin destekledigi.
// candidates: [{ address, symbol, decimals?, logoURI? }]. Private key GEREKMEZ (adres + proxy).
export async function getGasTokenOptions({ chainId, rpcUrl, bundlerBase, address, candidates, bundlerToken }) {
  try {
    const list = (candidates || []).filter((c) => c && c.address)
    if (!list.length) return []

    const chain = viemChain(chainId, rpcUrl)
    const bundlerTransportConfig = bundlerToken ? { fetchOptions: { headers: { Authorization: `Bearer ${bundlerToken}` } } } : undefined
    const pimlicoClient = createPimlicoClient({ chain, transport: http(`${bundlerBase}/rpc/${chainId}`, bundlerTransportConfig), entryPoint: ENTRY_POINT })

    // Her aday token icin quote sor; basarili (quote donen) = desteklenen. Desteklenmeyen
    // token tek istegi hata verse bile digerlerini etkilemesin diye token-token allSettled.
    const checked = await Promise.allSettled(list.map(async (c) => {
      const quotes = await pimlicoClient.getTokenQuotes({ tokens: [c.address] })
      // quote = { exchangeRate, postOpGas, ... } — token cinsinden gas tahmini icin saklanir.
      return Array.isArray(quotes) && quotes.length ? { c, quote: quotes[0] } : null
    }))
    const supported = checked.filter((r) => r.status === 'fulfilled' && r.value).map((r) => r.value)
    if (!supported.length) {
      // Hicbir aday desteklenmedi: ya gercekten desteklenmiyor ya da proxy/backend erisilemiyor.
      // Tani icin ilk hatayi logla (sessiz [] yerine).
      const firstErr = checked.find((r) => r.status === 'rejected')
      if (firstErr) console.warn('getGasTokenOptions: quote alinamadi (backend/proxy?) —', firstErr.reason?.message || firstErr.reason)
      return []
    }

    // Token cinsinden gas tahmini icin guncel userOp gas fiyatini bir kez cek (yoksa gasFee null kalir).
    let maxFeePerGas = 0n
    try { maxFeePerGas = (await pimlicoClient.getUserOperationGasPrice()).fast.maxFeePerGas } catch { /* gasFee null */ }

    // Desteklenenlerin bakiye + decimals'ini zincirden cek (aday metadata'sina guvenme).
    const provider = new ethers.JsonRpcProvider(rpcUrl)
    const erc20Abi = [
      'function balanceOf(address) view returns (uint256)',
      'function decimals() view returns (uint8)',
    ]
    const normalized = []
    const held = []
    await Promise.all(supported.map(async ({ c, quote }) => {
      try {
        const ct = new ethers.Contract(c.address, erc20Abi, provider)
        const [raw, dec] = await Promise.all([
          ct.balanceOf(address),
          c.decimals != null ? Promise.resolve(c.decimals) : ct.decimals(),
        ])
        const decimals = Number(dec)
        // gasFee: bu tokenle gas'in tahmini maliyeti (insan birimi). UI yetersizlik kontrolu kullanir.
        const gasFee = estimateTokenGasFee({
          exchangeRate: quote?.exchangeRate, postOpGas: quote?.postOpGas, maxFeePerGas, decimals,
        })
        normalized.push({ token: c.address, symbol: c.symbol || '?', decimals, logoURI: c.logoURI, gasFee })
        held.push({ address: c.address, balance: Number(ethers.formatUnits(raw, decimals)) })
      } catch { /* skip token */ }
    }))

    // Bakiyesi > 0 olanlari dondur + logo (aday logosu yoksa Trust Wallet CDN, o da yoksa monogram).
    return filterGasTokens(normalized, held).map((t) => {
      if (t.logoURI) return t
      let checksum = t.token
      try { checksum = ethers.getAddress(t.token) } catch { /* gecersiz adres */ }
      return { ...t, logoURI: tokenLogoURI(chainId, checksum) }
    })
  } catch (e) {
    console.warn('getGasTokenOptions error', e?.message)
    return []
  }
}

// EIP-7702 + Pimlico ERC-20 paymaster icin smart account client'i kurar.
// owner = mevcut EOA (privateKeyToAccount ile ayni hex anahtar). Adres degismez.
export async function getSmartContext({ privateKey, chainId, rpcUrl, bundlerBase, bundlerToken }) {
  const { chain, owner, publicClient, account } = await build7702Account({ privateKey, chainId, rpcUrl })

  const bundlerUrl = `${bundlerBase}/rpc/${chainId}` // KENDI proxy (apikey sunucuda)
  const bundlerTransportConfig = bundlerToken ? { fetchOptions: { headers: { Authorization: `Bearer ${bundlerToken}` } } } : undefined
  const bundlerHttp = () => http(bundlerUrl, bundlerTransportConfig)
  const pimlicoClient = createPimlicoClient({ chain, transport: bundlerHttp(), entryPoint: ENTRY_POINT })

  const smartAccountClient = createSmartAccountClient({
    client: publicClient,
    chain,
    account,
    paymaster: pimlicoClient,
    bundlerTransport: bundlerHttp(),
    userOperation: {
      estimateFeesPerGas: async () => (await pimlicoClient.getUserOperationGasPrice()).fast,
      // NOT: prepareUserOperation yerlesimi (userOperation icinde vs top-level) testnet'te
      // dogrulanacak (Task 22). ERC-20 paymaster approve'unu calldata'ya otomatik enjekte eder.
      prepareUserOperation: prepareUserOperationForErc20Paymaster(pimlicoClient),
    },
  })

  return { owner, publicClient, pimlicoClient, smartAccountClient }
}

// calls: [{ to, value:BigInt, data:hex }]; gasToken: ERC-20 adresi (paymaster ile odenecek token)
export async function executeSponsored({ privateKey, chainId, rpcUrl, bundlerBase, calls, gasToken, bundlerToken }) {
  const { owner, publicClient, smartAccountClient } = await getSmartContext({ privateKey, chainId, rpcUrl, bundlerBase, bundlerToken })

  // 7702 delegasyonu kurulu mu? Degilse ilk userOp'a auth gom (chain-scoped).
  const code = await publicClient.getCode({ address: owner.address }).catch(() => null)
  let authorization
  if (!isDelegated(code)) {
    authorization = await owner.signAuthorization({
      address: SIMPLE_ACCOUNT_IMPL,
      chainId: Number(chainId), // chainId != 0 (replay korumasi)
      // 'pending' etiketi SART: authorization'in nonce'u, relayer'in type-4
      // islemi uygulandigi andaki hesap nonce'una esit olmali. Varsayilan
      // 'latest' ile, EOA'nin bekleyen bir islemi varsa o nonce zaten
      // tuketilmis olur; authorization sessizce gecersiz kalir, delegasyon
      // kurulmaz ve userOp zincirde dogrulamadan gecmez.
      nonce: await publicClient.getTransactionCount({ address: owner.address, blockTag: 'pending' }),
    })
  }

  const hash = await smartAccountClient.sendUserOperation({
    calls,
    paymasterContext: { token: gasToken },
    ...(authorization ? { authorization } : {}),
  })

  const waitPromise = smartAccountClient.waitForUserOperationReceipt({ hash })
  return { hash, waitPromise }
}
