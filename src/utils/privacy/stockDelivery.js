import { stockEntry, stockOutputIssuer, stocksByChain, isGeneralSwapExcluded } from '../tokenizedStocks'
import { isDeliveryOnlyStock } from './deliveryStocks'

// GIZLI MOD: TOKENLASTIRILMIS HISSE (bStocks + xStocks) TESLIMI YASAK (sahip karari 2026-10-23). Teslim secicisi (buildDeliveryTokenList)
// ve arka plan (privateQuote, runPrivateOrder, teslim yazicisi) AYNI tanimi kullanir; popup bu modulu cekebilir cunku yalniz
// saf hisse katalogunu (tokenizedStocks.js) import eder, silentswap.js / privateOrderExec.js'i degil (privatePopupImports.test.js).
//
// Tanim YALNIZ (chainId, adres) iledir: sembol ya da ad ASLA bakilmaz (sahte "CRCLB" baska adreste hisse degildir, gercek hisse adresi
// baska sembolle gelse de hisse sayilir). Kaynaklar: bStocks ve xStocks katalogu (stockEntry) ile xStocks'in var oldugu butun
// zincirlerdeki adresleri (isGeneralSwapExcluded: Optimism / Mantle dahil, `chains` listesine bakmaz) ve katalogda OLMAYAN ama sunucu
// listesinde gelen hisseler (isDeliveryOnlyStock, deliveryStocks.js: Arbitrum xStocks, Polygon Backed): bu ek liste YALNIZ buraya aittir,
// ticaret katalogunu (Hisseler sekmesi, Takas/Kopru dislamasi) degistirmez.
//
// EMEKLI HISSELER (K28, K42; ilk alim kapisi): katalogdan CIKMIS ama zincirde duran hisseler (xStocks ADBEx / PYPLx / STRCx, bStocks BMNRB /
// FLNCB) de hisse sayilir: `stockOutputIssuer` kapinin KENDI cikti tarafi aramasidir (katalog + emekli listeler). Eski tanim yalniz katalogu
// bildigi icin bu bes adres gizli teslimden saglayiciya kadar gidebilirdi.
// FAIL-CLOSED: katalog okunamaz (istisna) ya da bos gelirse "hisse" denir; bu fonksiyonu cagiran liste token gizler, arka plan reddeder.
export function isStockDeliveryToken(chainId, address) {
    try {
        if (stocksByChain({ includeXstocks: true }).length === 0) return true
        if (typeof address !== 'string' || !address) return false
        return stockEntry(chainId, address) !== null || stockOutputIssuer(chainId, address) !== null
            || isGeneralSwapExcluded(chainId, address) || isDeliveryOnlyStock(chainId, address)
    } catch {
        return true
    }
}
