/**
 * Native coin (ETH/BNB/MATIC...) kod tabaninda birden fazla sekilde temsil ediliyor:
 * - null / undefined / '' (Send akisi)
 * - '0x000...0' (ZeroAddress)
 * - '0x0' (/getTokenDataById API'sinin dondugu deger)
 * - '0xEeee...EEeE' (piyasa standardi placeholder)
 *
 * Bunlardan biri ERC-20 sanilirsa `new ethers.Contract(adres).decimals()` cagrisi
 * reject eder ve gonderim sessizce olur. Tek bir yerden kontrol edilmesi icin burada.
 */
// ZeroAddress DUZ METIN yazilir, `ethers.ZeroAddress` DEGIL.
//
// Bu modul yalnizca metin karsilastirmasi yapiyor ama `ethers` importu onu tum
// kod tabanindaki `vi.mock('ethers')` mock'larina BAGLIYORDU: mock'u kismi olan
// her test (16 dosya) bu modulu dolayli import ettigi anda YUKLENEMEDEN
// dusuyordu. Sabitin kendisi ethers'in surumleri arasinda degismez ve
// nativeAsset.test.js onu `ethers.ZeroAddress` ile karsilastirarak sapmayi
// yakaliyor.
const NATIVE_PLACEHOLDERS = new Set([
    '0x0000000000000000000000000000000000000000',
    '0x0',
    '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
])

export function isNativeAsset(address) {
    if (address === null || address === undefined) return true
    if (typeof address !== 'string') return false
    const trimmed = address.trim()
    if (!trimmed) return true
    return NATIVE_PLACEHOLDERS.has(trimmed.toLowerCase())
}
