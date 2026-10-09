// bStocks katalogunun DEX likiditesini cuzdanin KENDI BSC rotasiyla yeniden
// olcer. CI yok, elle calistirilir:
//   npm run measure:bstocks                  (katalogdaki tum kayitlar)
//   npm run measure:bstocks -- TSMB NFLXB    (yalniz verilen semboller)
//
// NEDEN GEREKLI: katalogun secim kurali "DEX'te UYGUN ve kaldiracsiz" (bkz.
// src/data/bStocks.js bas yorumu) ve likidite OYNAK: NFLXB ayni gun icinde
// %0,93'ten %1,08'e cikti, $20k'da %2,4 (2026-09-29). Yeni bir surum
// yayinlanmadan HEMEN ONCE bu betik kosulur. UYGUN olmayan kayit varsa cikis
// kodu 1'dir; o kayit ya katalogdan cikar ya da karar yazili olarak yenilenir.
//
// YONTEM (2026-09-18 ve 2026-09-29 olcumleriyle AYNI): cuzdanin takas motoru
// (src/utils/swap.js findBestDexRoute) ne soruyorsa o sorulur, fazlasi degil.
//   - V3: PancakeSwap QuoterV2, DOGRUDAN USDT -> hisse, kademeler
//     CHAIN_CONFIG[56]'dan ([100, 500, 2500, 10000]). Motor V3'te cok adimli
//     rota SORMUYOR; burada da sorulmaz, yoksa olcum kullanicinin hic
//     alamayacagi bir fiyati UYGUN sayardi.
//   - V2: PancakeSwap V2 getAmountsOut, buildPathCandidates'in urettigi yollar
//     (dogrudan + WBNB/USDC ustunden). Her adimda %2 rezerv kapisi
//     (poolTooShallow): motor bu kapidan gecemeyen rotayi ELER, olcum de eler.
// $1.000 ve $10.000 USDT girisinde en iyi rotanin BIRIM fiyati (USDT / token)
// alinir. Sapma = birim($10k) / birim($1k) - 1:
//   UYGUN        sapma < %2
//   SIG          %2 <= sapma < %10
//   KOTASYONSUZ  rota yok ya da sapma >= %10 (havuz cok sig)
//
// Birim fiyat HAM token basinadir (balanceOf birimi, uiMultiplier uygulanmaz).
// Sapma bir ORAN oldugu icin carpandan etkilenmez.
//
// Router/quoter/factory adresleri, kademeler, yol adaylari, quoter ABI'si ve
// %2 kapisi burada TEKRARLANMAZ: swapChains.js ve swapRoutes.js'ten okunur.
// Motorun rotasi degisirse olcum de kendiliginden onu izler.
//
// Tarama korlugu (2026-09-18'den beri kabul edilmis): PancakeSwap Infinity ve
// Uniswap v4 havuzlari gorus alaninda DEGIL. Cuzdan yalnizca PancakeSwap V2/V3
// router'ini kullandigi icin "likidite yok" degil "bizim router'imizdan
// erisilemiyor" okunmali.

import { JsonRpcProvider, Contract, ZeroAddress, parseUnits, formatUnits } from 'ethers'
import { BSTOCKS, BSTOCKS_CHAIN_ID } from '../src/data/bStocks.js'
import { CHAIN_CONFIG } from '../src/utils/swapChains.js'
import { buildPathCandidates, feeTiersFor, poolTooShallow, v3QuoteArgs, v3QuoteOut, v3QuoterAbiFor } from '../src/utils/swapRoutes.js'
import chains from '../src/data/supported_chains.json' with { type: 'json' }

const bsc = chains.find((c) => Number(c.chainId) === BSTOCKS_CHAIN_ID)
// verify-bstocks.mjs ile AYNI RPC secimi: once ortam degiskeni, sonra cuzdanin
// kendi listesi.
const RPC = process.env.BSC_RPC_URL || bsc?.rpc?.[0]?.url || 'https://bsc-dataseed.bnbchain.org'

// BSC USDT (BEP-20, 18 ondalik) - CHAIN_CONFIG[56].intermediates'teki kayit.
const USDT = '0x55d398326f99059fF775485246999027B3197955'
const USDT_DECIMALS = 18
const GIRISLER_USD = [1000, 10000]

const UYGUN_SINIR = 2
const SIG_SINIR = 10

const V2_ROUTER_ABI = ['function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)']
const V2_FACTORY_ABI = ['function getPair(address, address) view returns (address)']
const V2_PAIR_ABI = [
  'function getReserves() view returns (uint112, uint112, uint32)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
]

const cfg = CHAIN_CONFIG[BSTOCKS_CHAIN_ID]
const V3 = cfg.dexes.find((d) => d.VERSION === 3)
const V2 = cfg.dexes.find((d) => d.VERSION === 2)

// Yalniz ciktidaki rota etiketi icin (V2 USDT>WBNB>TSMB gibi).
const ADLAR = new Map([
  [USDT.toLowerCase(), 'USDT'],
  [cfg.wrappedNative.toLowerCase(), 'WBNB'],
  ['0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', 'USDC'],
])

// Revert "bu kademede/yolda likidite yok" demektir; betigi durdurmaz.
const dene = async (fn) => { try { return await fn() } catch { return null } }

async function enIyiV3(quoter, token, amountIn) {
  const teklifler = await Promise.all(feeTiersFor(V3).map(async (fee) => {
    const raw = await dene(() => quoter.quoteExactInputSingle.staticCall(
      ...v3QuoteArgs(V3, { tokenIn: USDT, tokenOut: token, fee, amountIn }),
    ))
    const out = raw === null ? 0n : v3QuoteOut(V3, raw)
    return out > 0n ? { out, rota: `V3 ${fee}` } : null
  }))
  return teklifler.filter(Boolean).reduce((a, b) => (!a || b.out > a.out ? b : a), null)
}

// Yolun her adimi icin GIRDI tarafinin rezervi. Cift yoksa, bossa ya da
// beklenen tokenleri tasimiyorsa null: swap.js quoteV2Path ile ayni eleme.
async function v2Rezervleri(provider, factory, path) {
  const rezervler = []
  for (let i = 0; i < path.length - 1; i++) {
    const cift = await dene(() => factory.getPair(path[i], path[i + 1]))
    if (!cift || cift === ZeroAddress) return null
    const pair = new Contract(cift, V2_PAIR_ABI, provider)
    const [reserves, token0, token1] = await Promise.all([
      dene(() => pair.getReserves()), dene(() => pair.token0()), dene(() => pair.token1()),
    ])
    if (!reserves || !token0 || !token1) return null
    if (reserves[0] === 0n || reserves[1] === 0n) return null
    const girdi = path[i].toLowerCase()
    if (girdi === token0.toLowerCase()) rezervler.push(reserves[0])
    else if (girdi === token1.toLowerCase()) rezervler.push(reserves[1])
    else return null
  }
  return rezervler
}

async function enIyiV2(router, adaylar, amountIn, sembol) {
  let kapiyaTakildi = false
  const teklifler = await Promise.all(adaylar.map(async ({ path, rezervler }) => {
    const amounts = await dene(() => router.getAmountsOut(amountIn, path))
    if (!amounts) return null
    // Kapi HER adimda, o adimin GERCEK girdisiyle (amounts[i]) olculur.
    if (rezervler.some((rezerv, i) => poolTooShallow(amounts[i], rezerv))) {
      kapiyaTakildi = true
      return null
    }
    const out = amounts[amounts.length - 1]
    const etiket = path.map((a) => ADLAR.get(a.toLowerCase()) ?? sembol).join('>')
    return out > 0n ? { out, rota: `V2 ${etiket}` } : null
  }))
  const enIyi = teklifler.filter(Boolean).reduce((a, b) => (!a || b.out > a.out ? b : a), null)
  return { enIyi, kapiyaTakildi }
}

// Bacak: { out, rota, birim, kapiyaTakildi } ya da rota yoksa { out: null, kapiyaTakildi }.
function karar(kucuk, buyuk) {
  if (!kucuk.out) return { karar: 'KOTASYONSUZ', neden: '$1k rota yok', sapma: null }
  if (!buyuk.out) return { karar: 'KOTASYONSUZ', neden: '$10k rota yok', sapma: null }
  const sapma = (buyuk.birim / kucuk.birim - 1) * 100
  if (sapma < UYGUN_SINIR) return { karar: 'UYGUN', neden: '', sapma }
  if (sapma < SIG_SINIR) return { karar: 'SIG', neden: '', sapma }
  return { karar: 'KOTASYONSUZ', neden: 'havuz cok sig', sapma }
}

async function olc(provider, t) {
  const quoter = new Contract(V3.QUOTER_ADDRESS, v3QuoterAbiFor(V3), provider)
  const router = new Contract(V2.ROUTER_ADDRESS, V2_ROUTER_ABI, provider)
  const factory = new Contract(V2.FACTORY_ADDRESS, V2_FACTORY_ABI, provider)

  // Rezervler iki giris icin ORTAK: bir kez okunur.
  const yollar = buildPathCandidates(USDT, t.address, cfg.intermediates)
  const adaylar = (await Promise.all(yollar.map(async (path) => {
    const rezervler = await v2Rezervleri(provider, factory, path)
    return rezervler ? { path, rezervler } : null
  }))).filter(Boolean)

  const bacaklar = []
  for (const usd of GIRISLER_USD) {
    const amountIn = parseUnits(String(usd), USDT_DECIMALS)
    const v3 = await enIyiV3(quoter, t.address, amountIn)
    const { enIyi: v2, kapiyaTakildi } = await enIyiV2(router, adaylar, amountIn, t.symbol)
    const enIyi = [v3, v2].filter(Boolean).reduce((a, b) => (!a || b.out > a.out ? b : a), null)
    bacaklar.push(enIyi
      ? { ...enIyi, birim: usd / Number(formatUnits(enIyi.out, t.decimals)), kapiyaTakildi }
      : { out: null, kapiyaTakildi })
  }
  return { bacaklar, ...karar(bacaklar[0], bacaklar[1]) }
}

const bacakMetni = (b) => (b.out ? `${b.rota.padEnd(18)} ${b.birim.toFixed(4).padStart(11)}` : '-'.padEnd(30))

async function main() {
  // USDT elle yazildi; motorun ara token listesinden cikarsa olcum artik
  // cuzdanin rotasini olcmuyor demektir.
  if (!cfg.intermediates.some((a) => a.toLowerCase() === USDT.toLowerCase())) {
    throw new Error('USDT, CHAIN_CONFIG[56] ara tokenlerinde yok - swapChains.js degismis')
  }
  const istenen = process.argv.slice(2).map((s) => s.toUpperCase())
  const bilinmeyen = istenen.filter((s) => !BSTOCKS.some((t) => t.symbol === s))
  if (bilinmeyen.length) throw new Error(`katalogda yok: ${bilinmeyen.join(', ')}`)
  const hedef = istenen.length ? BSTOCKS.filter((t) => istenen.includes(t.symbol)) : BSTOCKS

  const provider = new JsonRpcProvider(RPC, BSTOCKS_CHAIN_ID, { staticNetwork: true })
  const blok = await provider.getBlockNumber()
  console.log(`RPC: ${RPC}  blok ${blok}`)
  console.log(`${hedef.length} kayit olculuyor ($1.000 ve $10.000 USDT girisi, birim = USDT / token)\n`)
  console.log(`${'KARAR'.padEnd(12)} ${'SEMBOL'.padEnd(7)} ${'$1k rota'.padEnd(18)} ${'birim'.padStart(11)}   ${'$10k rota'.padEnd(18)} ${'birim'.padStart(11)}   sapma`)

  const sayac = { UYGUN: 0, SIG: 0, KOTASYONSUZ: 0 }
  const uygunDegil = []
  for (const t of hedef) {
    const s = await olc(provider, t)
    sayac[s.karar]++
    if (s.karar !== 'UYGUN') uygunDegil.push(t.symbol)
    const sapma = s.sapma === null ? '-' : `${s.sapma >= 0 ? '+' : ''}${s.sapma.toFixed(2)}%`
    // Kapi notu yalniz karari ACIKLADIGI yerde basilir: WBNB ustunden giden V2
    // yolu $10k'da hemen her hissede elenir ve her satirda gurultu olurdu.
    const kapi = s.karar === 'KOTASYONSUZ' && s.bacaklar.some((b) => b.kapiyaTakildi) ? '  (V2 %2 kapisi eledi)' : ''
    console.log(`${s.karar.padEnd(12)} ${t.symbol.padEnd(7)} ${bacakMetni(s.bacaklar[0])}   ${bacakMetni(s.bacaklar[1])}   ${sapma}${s.neden ? '  ' + s.neden : ''}${kapi}`)
  }

  console.log()
  console.log(`${hedef.length} kayit: ${sayac.UYGUN} UYGUN, ${sayac.SIG} SIG, ${sayac.KOTASYONSUZ} KOTASYONSUZ`)
  if (uygunDegil.length) {
    console.error(`UYGUN OLMAYAN: ${uygunDegil.join(', ')} - katalog kurali karsilanmiyor`)
    process.exit(1)
  }
}

main().catch((e) => { console.error('HATA:', e.message); process.exit(1) })
