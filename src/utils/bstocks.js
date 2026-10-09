// bStocks saf yardimcilari: ag, saglayici, cuzdan YOK (swapRoutes.js ile ayni
// sozlesme), boylece RPC olmadan test edilir.

import { BSTOCKS, BSTOCKS_CHAIN_ID } from '../data/bStocks'

// BEP-677 (EIP-8056) "Scaled UI Amount" birimi: uiAmount = raw * mul / 1e18
export const UI_MULTIPLIER_ONE = 10n ** 18n

// Adres -> kayit. Kucuk harfle indeksleniyor cunku ayni adres kod tabaninda
// uc bicimde dolasiyor: checksum (imported_tokens), kucuk harf (sunucu kaydi),
// ve kullanicinin yapistirdigi ham metin.
const BY_ADDRESS = new Map(BSTOCKS.map((t) => [t.address.toLowerCase(), t]))

export function bStockByAddress(chainId, address) {
  if (Number(chainId) !== BSTOCKS_CHAIN_ID) return null
  if (typeof address !== 'string' || !address) return null
  return BY_ADDRESS.get(address.toLowerCase()) ?? null
}

export const isBStock = (chainId, address) => bStockByAddress(chainId, address) !== null

// Sunucudaki kaydin `chain` alani (CoinGecko platform kimligi); seed-bstocks.mjs
// bStock kayitlarina ayni sabiti yaziyor.
const BSTOCKS_PLATFORM = 'binance-smart-chain'
const BSTOCK_IDS = new Set(BSTOCKS.map((t) => t.coingecko_id))
const BSTOCK_SYMBOLS = new Set(BSTOCKS.map((t) => t.symbol.toUpperCase()))

// ICE AKTARMA KIMLIGI. ImportToken EVM'de tokeni sunucuya AD + SEMBOL ile soruyor
// (/getTokenByName adrese bakmiyor). Seed bStock'lari DB'ye yazdigi icin
// "Alphabet"/"GOOGLB" adli HERHANGI bir kontrat gercek hissenin logosunu ve
// coingecko_id'sini (fiyat, grafik, USD degeri) miras aliyordu; EVM'de rozet de
// hep "Dogrulandi" idi. Katalogdaki adresler bu sahtelerin TAM hedefi.
//
// Hisse kimliginin tek yetkilisi KATALOG:
//   - katalog adresi (yalniz BSC) -> kimlik katalogdan, sunucu eslesmese bile
//   - hisse coingecko_id'si ya da hisse sembolu tasiyan katalog DISI kontrat ->
//     kimlik VERILMEZ, `known: false` (sablon sari "dogrulanmamis" uyarisini basar)
//   - geri kalan her token -> sunucunun kimligi AYNEN (davranis degismez)
export function bStockImportIdentity({ chainId, address, symbol, backendToken }) {
  const gercek = bStockByAddress(chainId, address)
  if (gercek) {
    return { image: gercek.image, chain: BSTOCKS_PLATFORM, coingecko_id: gercek.coingecko_id, known: true }
  }

  const taklit = BSTOCK_IDS.has(backendToken?.coingecko_id)
    || (typeof symbol === 'string' && BSTOCK_SYMBOLS.has(symbol.trim().toUpperCase()))
  if (taklit) return { image: null, chain: null, coingecko_id: null, known: false }

  return {
    image: backendToken?.image || null,
    chain: backendToken?.chain || null,
    coingecko_id: backendToken?.coingecko_id || null,
    known: true,
  }
}

// BEP-677 spesifikasyonu birebir: "Raw balances stored in the contract remain
// unchanged; only the human-readable representation is affected." Yani balanceOf
// carpani UYGULAMAZ ve duz okuyan cuzdan bakiyeyi EKSIK gosterir.
//
// 2026-09-18'de 22 tokenin 5'inde carpan 1e18 DEGILDI (SPYB +%0,173,
// MSFTB +%0,131, NVDAB +%0,078, AAPLB +%0,060, GOOGLB +%0,048). Sapma temettu
// yeniden yatirimindan geliyor ve BUYUYOR; bir hisse bolunmesinde (4:1) hata
// %300 olur - kullanici varliginin dortte birini gorur.
//
// Carpan okunamazsa 1e18 kabul edilir: eksik veri yuzunden bakiyeyi
// gizlemektense zincirdeki ham degeri gostermek dogru davranis.
export function applyUiMultiplier(rawAmount, multiplier) {
  if (typeof rawAmount !== 'bigint') return rawAmount
  if (typeof multiplier !== 'bigint' || multiplier <= 0n) return rawAmount
  return (rawAmount * multiplier) / UI_MULTIPLIER_ONE
}

// BIRIM SINIRI. Gosterim UI birimindedir ama TRANSFER HAM birimdedir: BEP-677'nin
// kendi formulu (uiAmount = raw * mul / 1e18) bunu soyluyor. MAX dugmesi UI
// bakiyesini yaziyorsa, harcama yolu onu hama CEVIRMEK ZORUNDA - yoksa ham
// bakiyeden buyuk bir miktar gonderilmeye calisilir ve islem duser.
//
// Iki taraf da tabana yuvarladigi icin gidis-donus sonucu ASLA baslangictaki ham
// degeri asmaz; MAX'in guvenligi bu ozellige dayaniyor ve testle kilitli.
export function rawFromUiAmount(uiAmount, multiplier) {
  if (typeof uiAmount !== 'bigint') return uiAmount
  if (typeof multiplier !== 'bigint' || multiplier <= 0n) return uiAmount
  return (uiAmount * UI_MULTIPLIER_ONE) / multiplier
}
