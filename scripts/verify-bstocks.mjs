// bStocks kaydini ZINCIRE karsi sinar. CI yok, elle calistirilir:
//   npm run verify:bstocks
//
// Neden gerekli: 75 bStock ayni BeaconProxy'yi paylasiyor ve implementasyonda
// setName(string) / setSymbol(string) VAR. Tek bir beacon yukseltmesi 75 tokenin
// davranisini ayni anda degistirebilir. Bu betik sapmayi yakalar.

import { JsonRpcProvider, Contract, getAddress } from 'ethers'
import { BSTOCKS, BSTOCKS_BEACON, BSTOCKS_BEACON_SLOT, BSTOCKS_COMPLIANCE } from '../src/data/bStocks.js'
import chains from '../src/data/supported_chains.json' with { type: 'json' }

const bsc = chains.find((c) => Number(c.chainId) === 56)
// supported_chains.json'daki gercek alan adi "rpc" (icinde {url} nesneleri), "rpcUrls" DEGIL -
// verify-routers.mjs'deki okuma deseniyle ayni kaynaktan alinir.
const RPC = process.env.BSC_RPC_URL || bsc?.rpc?.[0]?.url || 'https://bsc-dataseed.bnbchain.org'

const ABI = [
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function uiMultiplier() view returns (uint256)',
  'function compliance() view returns (address)',
  'function identifier() view returns (string)',
]

const call = async (fn, fallback) => { try { return await fn() } catch { return fallback } }

async function main() {
  const provider = new JsonRpcProvider(RPC, 56)
  const hatalar = []

  console.log(`RPC: ${RPC}`)
  console.log(`${BSTOCKS.length} kayit dogrulaniyor...\n`)

  for (const t of BSTOCKS) {
    const c = new Contract(t.address, ABI, provider)
    const [symbol, decimals, multiplier, compliance, isin] = await Promise.all([
      call(() => c.symbol(), null),
      call(() => c.decimals(), null),
      call(() => c.uiMultiplier(), null),
      call(() => c.compliance(), null),
      call(() => c.identifier(), null),
    ])

    const slot = await provider.getStorage(t.address, BSTOCKS_BEACON_SLOT)
    const beacon = '0x' + slot.slice(26)

    const sorunlar = []
    if (t.address !== getAddress(t.address)) sorunlar.push('adres checksum bicimde degil')
    if (symbol !== t.symbol) sorunlar.push(`symbol zincirde "${symbol}", kayitta "${t.symbol}"`)
    if (Number(decimals) !== t.decimals) sorunlar.push(`decimals zincirde ${decimals}, kayitta ${t.decimals}`)
    if (beacon.toLowerCase() !== BSTOCKS_BEACON) sorunlar.push(`beacon ${beacon} - SAHTE TOKEN OLABILIR`)
    if (String(compliance).toLowerCase() !== BSTOCKS_COMPLIANCE) sorunlar.push(`compliance ${compliance}`)
    if (multiplier === null) sorunlar.push('uiMultiplier() cevap vermiyor - BEP-677 uygulanmiyor')
    if (isin !== t.isin) sorunlar.push(`ISIN zincirde "${isin}", kayitta "${t.isin}"`)

    const sapma = multiplier === null ? '-' : (((Number(multiplier) / 1e18) - 1) * 100).toFixed(6) + '%'
    if (sorunlar.length) {
      hatalar.push({ symbol: t.symbol, sorunlar })
      console.log(`HATA  ${t.symbol.padEnd(7)} ${sorunlar.join('; ')}`)
    } else {
      console.log(`TAMAM ${t.symbol.padEnd(7)} carpan sapmasi ${sapma}`)
    }
  }

  console.log()
  if (hatalar.length) {
    console.error(`${hatalar.length}/${BSTOCKS.length} kayitta SAPMA VAR`)
    process.exit(1)
  }
  console.log(`${BSTOCKS.length}/${BSTOCKS.length} kayit zincirle uyumlu`)
}

main().catch((e) => { console.error('HATA:', e.message); process.exit(1) })
