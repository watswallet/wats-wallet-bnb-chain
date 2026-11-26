// Hisseler listesinin SAF sulgeci (Ilk Alim Kapisi, K34, K35; spec 6.8). SAF: vue, depo, ag, uygunluk kancasi YOK;
// uygunluk `isAvailable(issuer)` ve tutma `isHeld(row)` olarak ENJEKTE edilir. Katalog fonksiyonlarini
// (tokenizedStocks.js / stockCompanies.js) DEGISTIRMEZ ve onlar bu modulu import etmez: sulgec yalniz GOSTERIM
// kenarindadir; filtre katalog fonksiyonlarina konsaydi TUTULAN ama uygun olmayan ihraccinin hissesi okunamaz olurdu
// (fiyat, bakiye, Varliklar tohumu tam katalogdan beslenir).
//
// Bu dosyanin TEK yazari Task 43'tur; Task 44-46 (StockDetail, StockTrade, Takas / Kopru) yalniz tuketir.
import { isGeneralSwapOutputExcluded, stockOutputIssuer, stocksByChain } from '../tokenizedStocks'

/** Uygun ihraccinin ya da elde tutulan satirlar (sira korunur). Tutulan uygun olmayan satir KORUNUR (K35). */
export function offerableRows(rows, { isAvailable, isHeld }) {
    return rows.filter((row) => isAvailable(row.issuer) || isHeld(row))
}

/** Listede en az bir satirin ihraccisi uygunsa Al sunulabilir (tutma Al icin sayilmaz). */
export function canOfferBuy(rows, isAvailable) {
    return rows.some((row) => isAvailable(row.issuer))
}

/**
 * Cikti (edinme) adresi, ihraccisi musait olmayan bir hisse mi? Emekli xStocks adresi (K28) da hisse sayilir
 * (stockOutputIssuer). Hisse DEGILSE false ve `isAvailable` HIC cagrilmaz.
 */
export function unavailableOutput(chainId, address, isAvailable) {
    const issuer = stockOutputIssuer(chainId, address)
    return issuer !== null && !isAvailable(issuer)
}

/**
 * ELDE O IHRACCININ satiri var mi? Dondurma notu icin: `position.held` tum ihracci toplamidir (TK7), bu yuzden
 * ihracci ayrimi satir duzeyinde sorulur.
 */
export function holdsIssuer(rows, issuer, isHeld) {
    return rows.some((row) => row.issuer === issuer && isHeld(row))
}

/**
 * Giris uzlastirmasi (Task 45): `current` satirinin ihraccisi uygunsa `current`; degilse AYNI sirket (underlying) +
 * AYNI agdaki uygun kardes satir; yoksa null. `rows` = ayni agdaki secenekler (sameChainOptions). Baska sirketin ya da
 * baska agin satiri ASLA secilmez; dayanagi olmayan satirlar birbirine eslesmez (mergeGroupRows ile ayni kural).
 */
export function buyRowFor(rows, current, isAvailable) {
    if (!current) return null
    if (isAvailable(current.issuer)) return current
    if (!current.underlying) return null
    return rows.find((row) => row !== current
        && row.underlying === current.underlying
        && Number(row.chainId) === Number(current.chainId)
        && row.issuer !== current.issuer
        && isAvailable(row.issuer)) ?? null
}

/**
 * Genel Takas CIKTISI olabilen (isGeneralSwapOutputExcluded olmayan) katalog satiri olan zincirler, artan sirali.
 * bridgeStockChainIds kalibi: elle liste YOK, katalog buyurse ya da dislama degisirse kapsam kendiliginden degisir.
 * Bugun yalniz BSC (56): xStocks satirlari (Ethereum / Arbitrum / BSC) genel Takas'ta dislidir. Ozellik bayragindan
 * BAGIMSIZ (katalog bayrak ne olursa olsun tamamen taranir). Her cagri yeni dizi doner. Tuketici: swapTo (Task 46).
 */
export function generalSwapStockChainIds() {
    const ids = new Set()
    for (const group of stocksByChain({ includeXstocks: true })) {
        for (const row of group.rows) {
            if (!isGeneralSwapOutputExcluded(row.chainId, row.address)) ids.add(row.chainId)
        }
    }
    return [...ids].sort((a, b) => a - b)
}
