// Hisseler sekmesinin VERI katmani: bakiye yukleme, tohum plani ve satir metinleri.
// Home.vue yalnizca BAGLAR; kararlar burada, RPC'siz testle olculur (okuyucu enjekte edilir).

import { formatUnits } from 'ethers'
import { stockKey } from './tokenizedStocks'
import { unitPriceUsd } from './stockPricing'
import { readStockBalances } from './stockBalances'
import { hydrateLcxStockRows, refreshLcxStockRows } from './lcx/stockRows'

// Gosterilecek bir deger YOKKEN ekranin tek yazisi: tire (U+2014). Home.vue ile ayni karakter.
export const UNKNOWN_TEXT = '—'

// Birim fiyat yuzeylerinin bicim stili (utils/money.js): cok kucuk fiyat sifira yuvarlanmaz.
const PRICE_STYLE = { style: 'price' }

// Fiyat istegi tek POST (sunucu siniri 250 kimlik): bStocks + xStocks kimlikleri, tekrarsiz. LCX satiri katalog kimligi
// (coingeckoId) tasimaz (null): istege GIRMEZ; fiyati satirin kendi priceUsd'sidir.
export const collectStockIds = (groups) => [...new Set(groups.flatMap((group) => group.rows.map((row) => row.coingeckoId)))]
  .filter((id) => typeof id === 'string' && id !== '')

// LCX (dinamik) satiri mi? Satir tokenizedStocks.toLcxStockRow'dan gelir ve `source: 'lcx'` tasir.
const isLcxRow = (row) => row?.source === 'lcx'

// Zincir basina bakiye okumasinin ust siniri (ms). ethers JsonRpcProvider'in istek zaman asimi
// varsayilan 300 sn'dir ve loadGroupBalances uc zinciri Promise.all ile BEKLER: takili tek bir RPC
// tum bakiyeleri (ve tohumlamayi) dakikalarca tutardi. Sinir asilinca o grubun satirlari 'error'
// (tire) olur, diger zincirler etkilenmez.
export const STOCK_BALANCE_TIMEOUT_MS = 12_000

/**
 * Her zincir grubunun bakiyesini TEK Multicall3 ile ve zincirler PARALEL okur.
 * Bir zincir hata verirse YA DA `timeoutMs` icinde cevap vermezse YALNIZ o zincirin satirlari
 * 'error' olur (diger zincirler etkilenmez); `rejects` YOKTUR. Okuma duserse bakiye 0 DEGIL
 * bilinmiyor'dur.
 * @returns {Promise<Record<string, {status:'ok'|'error', balance: bigint|null, multiplier: bigint|null}>>}
 *          anahtar: stockKey(chainId, address)
 */
export async function loadGroupBalances({
  owner, groups, rpcFor, read = readStockBalances, timeoutMs = STOCK_BALANCE_TIMEOUT_MS,
}) {
  const result = {}

  await Promise.all(groups.map(async (group) => {
    try {
      const rpcUrl = rpcFor(group.chainId)
      if (!rpcUrl) throw new Error(`RPC adresi yok (zincir ${group.chainId})`)

      // Promise.race + clearTimeout (ensureMultipliersFor ile ayni kalip): hizli okuma sayaci temizler,
      // artakalan zamanlayici birakmaz. Zaman asimi asagidaki catch koluna duser.
      let timer = null
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`zaman asimi (${timeoutMs} ms)`)), timeoutMs)
      })
      let map
      try {
        map = await Promise.race([read({ chainId: group.chainId, owner, entries: group.rows, rpcUrl }), timeout])
      } finally {
        clearTimeout(timer)
      }
      for (const row of group.rows) {
        const hit = map.get(row.address.toLowerCase())
        const known = typeof hit?.balance === 'bigint'
        result[stockKey(row.chainId, row.address)] = {
          status: known ? 'ok' : 'error',
          balance: known ? hit.balance : null,
          multiplier: hit?.multiplier ?? null,
        }
      }
    } catch (error) {
      console.error(`Hisse bakiyeleri okunamadi (zincir ${group.chainId}):`, error)
      for (const row of group.rows) {
        result[stockKey(row.chainId, row.address)] = { status: 'error', balance: null, multiplier: null }
      }
    }
  }))

  return result
}

// Bakiyesi SIFIRDAN BUYUK olan satirlar (okunamayan satir sahip sayilmaz).
export function ownedRows(groups, balances) {
  return groups.flatMap((group) => group.rows).filter((row) => {
    const state = balances[stockKey(row.chainId, row.address)]
    return state?.status === 'ok' && state.balance > 0n
  })
}

/**
 * Sahip olunan hisseleri imported_tokens kovasina eklemek icin plan: { [zincirAnahtari]: eklenecek[] }.
 * Kovada ZATEN olan adres tekrar eklenmez. `imageOf(row)`: katalogda logosu olmayan (xStocks)
 * satirin sunucu kaydindaki gorseli.
 */
export function planSeed({ owned, bucket, imageOf = () => null }) {
  const additions = {}
  for (const row of owned) {
    // LCX satiri imported_tokens'a TOHUMLANMAZ (sahip karari 5): katalog kimligi (logo, coingecko_id) yok ve ImportToken
    // yolu hisse kimligini yalniz statik katalogdan verir.
    if (isLcxRow(row)) continue
    const chainKey = String(row.chainId)
    const known = new Set((bucket?.[chainKey] || []).map((token) => String(token.address).toLowerCase()))
    if (known.has(row.address.toLowerCase())) continue

    const list = (additions[chainKey] ??= [])
    if (list.some((token) => token.address.toLowerCase() === row.address.toLowerCase())) continue
    list.push({
      name: row.name,
      symbol: row.symbol,
      decimals: row.decimals,
      address: row.address,
      image: row.image ?? imageOf(row) ?? null,
      coingecko_id: row.coingeckoId,
    })
  }
  return additions
}

/**
 * Satirin fiyat metni. `money(usd, opts)`: secili birimde yazan bicimlendirici (useMoney().money);
 * bu modul birimi bilmez, ENJEKTE edilir (RPC'siz/composable'siz testlenebilsin).
 * bStock: kayit/market_data yoksa tire, varsa fiyat (priceUSD yok/null/0 ise 0'in bicimi; bugunku
 * "0.00" davranisi). xStock: CoinGecko fiyati zincirdeki carpana bolunur; kayit, fiyat ya da carpan
 * bilinmiyorsa tire (asla ham fiyat, asla 0). Bicimlenemeyen deger (money null) BOS render edilmez: tire.
 * Birim fiyat yuzeyi oldugundan "price" stiliyle yazilir.
 */
export function stockPriceText({ row, record, multiplier, money }) {
  // LCX satiri: fiyat sunucunun satir fiyatidir (priceUsd, carpan yok, CoinGecko kaydi yok); gecersizse tire.
  if (isLcxRow(row)) {
    return Number.isFinite(row.priceUsd) && row.priceUsd > 0 ? (money(row.priceUsd, PRICE_STYLE) ?? UNKNOWN_TEXT) : UNKNOWN_TEXT
  }
  const market = record?.market_data
  if (row.issuer === 'xstocks') {
    const unit = unitPriceUsd(market?.priceUSD, multiplier)
    return unit === null ? UNKNOWN_TEXT : (money(unit, PRICE_STYLE) ?? UNKNOWN_TEXT)
  }
  return market ? (money(Number(market.priceUSD) || 0, PRICE_STYLE) ?? UNKNOWN_TEXT) : UNKNOWN_TEXT
}

/**
 * Satirin bakiye metni: yuklenmedi / sifir -> '' (hicbir sey cizilmez); okunamadi -> tire;
 * pozitif -> 4 haneli miktar ('<0.0001' toz icin).
 */
export function stockBalanceText({ state, decimals = 18 }) {
  if (!state) return ''
  if (state.status === 'error') return UNKNOWN_TEXT
  if (!(state.balance > 0n)) return ''
  const value = Number(formatUnits(state.balance, decimals))
  return value < 0.0001 ? '<0.0001' : value.toFixed(4)
}

// AG CIPLERI (Hisseler sekmesi, bayrak aciksa): yalniz LISTEYI suzer, cuzdanin aktif agini DEGISTIRMEZ.
// Secim: 'all' ya da bir zincir kimligi (sayi).
export const STOCK_CHIP_ALL = 'all'
// Ethereum, BSC, Arbitrum, sonra LCX'e ozgu aglar (tokenizedStocks CHAIN_ORDER ile ayni sira): ek aglarin cip sirasi da
// sabittir, aktif aga gore kaymaz.
const CHIP_CHAIN_ORDER = [1, 56, 42161, 8453, 10, 137, 100, 25]

// Cip sirasi SABITTIR (Tumu, Ethereum, BSC, Arbitrum, Base, ...); gruplar aktif-ag-ustte siralidir, cipler degil.
export function stockChipIds(groups) {
  const rank = (id) => { const i = CHIP_CHAIN_ORDER.indexOf(id); return i === -1 ? CHIP_CHAIN_ORDER.length : i }
  const ids = [...new Set(groups.map((group) => Number(group.chainId)))].sort((a, b) => rank(a) - rank(b))
  return [STOCK_CHIP_ALL, ...ids]
}

// Baslangic: cuzdanin aktif agi hissesi olan bir agsa o, degilse Tumu. Zincir kimligi sayi ya da 0x onaltilik olabilir.
export function initialStockChip(groups, activeChainId) {
  if (activeChainId === undefined || activeChainId === null) return STOCK_CHIP_ALL
  const id = Number(activeChainId)
  return groups.some((group) => Number(group.chainId) === id) ? id : STOCK_CHIP_ALL
}

// Tumu (ya da listede olmayan secim) = tum gruplar; tek ag = yalniz o grup.
export function filterStockGroups(groups, selected) {
  if (selected === STOCK_CHIP_ALL || !groups.some((group) => Number(group.chainId) === Number(selected))) return groups
  return groups.filter((group) => Number(group.chainId) === Number(selected))
}

/**
 * Sirket satirinin TOPLAM bakiye metni (TK6/5.2): ayni zincirdeki tum seceneklerin okunabilen
 * bakiyeleri toplanir. Hicbiri yuklenmediyse / hepsi sifirsa '' ; pozitif toplam varsa 4 haneli
 * miktar ('<0.0001' toz); pozitif yok ama okunamayan secenek varsa tire (sifir DEGIL, bilinmiyor).
 */
export function companyBalanceText({ company, balances }) {
  let total = 0
  let sawError = false
  for (const row of company?.options ?? []) {
    const state = balances?.[stockKey(row.chainId, row.address)]
    if (!state) continue
    if (state.status === 'error') { sawError = true; continue }
    if (state.balance > 0n) total += Number(formatUnits(state.balance, row.decimals))
  }
  if (total > 0) return total < 0.0001 ? '<0.0001' : total.toFixed(4)
  return sawError ? UNKNOWN_TEXT : ''
}

/**
 * pickRepresentative icin deger okuyucu: (row) -> { held, usd }. held: bakiye okundu ve > 0.
 * usd: adet x birim fiyat (xStocks'ta carpana bolunmus); fiyat bilinmiyorsa null.
 */
export function companyValueOf({ balances, recordOf, multiplierOf }) {
  return (row) => {
    const state = balances?.[stockKey(row.chainId, row.address)]
    if (state?.status !== 'ok' || !(state.balance > 0n)) return { held: false, usd: null }
    let unit = null
    if (isLcxRow(row)) {
      unit = Number.isFinite(row.priceUsd) && row.priceUsd > 0 ? row.priceUsd : null
    } else {
      const market = recordOf(row)?.market_data
      const raw = Number(market?.priceUSD)
      if (market && Number.isFinite(raw)) {
        unit = row.issuer === 'xstocks' ? unitPriceUsd(market.priceUSD, multiplierOf(row)) : raw
      }
    }
    const qty = Number(formatUnits(state.balance, row.decimals))
    return { held: true, usd: unit === null ? null : qty * unit }
  }
}

// --- LCX SATIR KATMANI (Bolum 2, Gorev 9) ---------------------------------------------------------------------------

// Sekme acilisi ve 60 sn yenileme: depo bundan bayatsa LCX'ten yeniden cekilir (Global Constraints: sekme yenilemesi en cok 60 000 ms).
export const LCX_STOCK_REFRESH_MAX_AGE_MS = 60_000

let syncInflight = null

/**
 * Hisseler sekmesinin LCX satir katmanini hazirlar: ONCE depodan (ag yok, yas siniri yok), SONRA 60 sn'den bayatsa agdan.
 * Sira onemlidir: tazeleme gecici arizada eldeki satirlari korur, yani depo ONCE yuklenmemisse ariza listeyi bos birakirdi
 * (kimlik amacli dislama ve kapi eski listeyle de calisir). Katman modul durumudur (reaktif degil): `onRows`, her adimdan sonra
 * cagirana "satirlar degisti" der (Home.vue `lcxRowsRev`'i artirir).
 *
 * Bayrak kapaliyken (`enabled` false) HICBIR SEY yapmaz: depo okunmaz, ag yok. Ozel modda da yapmaz (`isPrivate`): Hisseler
 * sekmesi orada yoktur ve tazeleme ag ISTEGIDIR (privateRequestCoverage '/lcx/stocks'); ozel mod hydrate ile refresh ARASINDA
 * degisirse refresh atlanir. Asla firlatmaz.
 *
 * TEK UCUS: bitmemis bir cagri varken gelen cagri (sekme acilisi + 60 sn tazelemesi ust uste binerse) AYNI sonucu bekler.
 * Iki cagri ic ice girseydi bir hydrate, digerinin yeni cektigi satirlarin ustune ESKI depo kaydini yazabilirdi.
 * @param {{ enabled: boolean, isPrivate: () => Promise<boolean>|boolean, onRows?: () => void, maxAgeMs?: number,
 *           hydrate?: Function, refresh?: Function }} opts
 * @returns {Promise<void>}
 */
export function syncLcxStockRows(opts) {
  if (!opts?.enabled) return Promise.resolve()
  if (syncInflight) return syncInflight
  syncInflight = runLcxSync(opts).finally(() => { syncInflight = null })
  return syncInflight
}

async function runLcxSync({
  isPrivate, onRows = () => {}, maxAgeMs = LCX_STOCK_REFRESH_MAX_AGE_MS,
  hydrate = hydrateLcxStockRows, refresh = refreshLcxStockRows,
}) {
  try {
    if (await isPrivate()) return

    try {
      await hydrate()
      onRows()
    } catch {
      // Depo okunamadi: bellekteki satirlar (varsa) ve asagidaki tazeleme yeter.
    }

    if (await isPrivate()) return
    const result = await refresh({ maxAgeMs })
    if (result?.ok) onRows()
  } catch {
    // refreshLcxStockRows firlatmaz; yine de sekme yuklemesi bir LCX arizasi yuzunden durmaz.
  }
}
