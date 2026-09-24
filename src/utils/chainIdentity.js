// Zincir KIMLIGI: slug ve native coingecko_id ile chainId cozumleme — saf katman.
//
// Neden ayri dosya: sozluge ileride alias eklemek isteyen biri KENDI testine carpsin,
// karar fonksiyonuna degil. Alias BILEREK yok: alias kabul etmek yanlis pozitif
// yuzeyini acar ve bugun CALISAN bir akisi oldurebilir. Bilinmeyen -> null ->
// muafiyet, yani sozlukteki her eksiklik GUVENLI yone duser.
//
// AG YOK: yalnizca pakete gomulu JSON okunur. Uzak istemci, tarayici depolamasi ve
// durum deposu BILEREK disarida — saflik testi bunu kaynak uzerinden kilitler.
// (Yasakli adlar burada YAZILAMAZ: test duz metin araması yapiyor.)

import supported_chains from '../data/supportedChains'
import { isSameChainId } from './vm'

const norm = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : '')

/**
 * CoinGecko asset platform slug'i -> chainId. Birebir eslesme; alias YOK.
 *
 * chainId kaydin KENDI TIPINDE dondurulur: EVM icin sayi, Solana icin metin.
 * Number() ile cevrilirse Solana NaN olur ve NaN hicbir karsilastirmayi gecmez.
 * @returns {number|string|null} null = "bilmiyorum"
 */
export function chainIdForSlug(slug) {
    const s = norm(slug)
    if (!s) return null
    const entry = supported_chains.find((c) => norm(c.chainSlug) === s)
    if (!entry) return null
    return typeof entry.chainId === 'string' ? entry.chainId : Number(entry.chainId)
}

/**
 * Bir native varligin SAHIBI oldugu zincirler. ETH ayni anda 1/10/8453/42161'in
 * native'i oldugu icin slug tek dogru cevabi veremez; kume gerekiyor.
 *
 * Kimlikler kendi tiplerinde dondurulur (bkz. chainIdForSlug).
 * @returns {Array<number|string>} bos dizi = "bu id hicbir desteklenen zincirin native'i degil"
 */
export function nativeOwnerChainIds(coingeckoId) {
    const id = norm(coingeckoId)
    if (!id) return []
    return supported_chains
        .filter((c) => norm(c.nativeCoingeckoId) === id)
        .map((c) => (typeof c.chainId === 'string' ? c.chainId : Number(c.chainId)))
}

/**
 * Bir chainId degeri BEYAN EDILMIS bir kimlik mi, yoksa COZULEMEMIS bir alan mi.
 *
 * Bu ayrimin TEK yeri burasi olmak zorunda: iki cagiran (assetChain.js'in `raw`
 * kolu ve Token.vue) AYNI soruyu soruyor ve FARKLI cevap verirlerse ayni kayit
 * bir ekranda gecerli, digerinde gecersiz sayilir.
 *
 * Kural:
 *   - bos (null/undefined/'')        -> HAYIR, kimlik yok
 *   - sayiya cevrilebilen            -> EVET (desteklenmeyen 999999 DAHIL: kayit
 *                                       bir kimlik BEYAN ediyor, cagiran onu
 *                                       "eslesmiyor" diye ele alabilsin)
 *   - metin, DESTEKLENEN bir zincire denk gelen ('solana-mainnet') -> EVET
 *   - diger metinler ('abc')         -> HAYIR. Bunlari kimlik saymak, bugun
 *                                       CALISAN (chainId alani bozuk/eksik) EVM
 *                                       akislarini kilitlerdi — bkz.
 *                                       swapTokenState.test.js T11/T23.
 */
export function isResolvableChainId(value) {
    if (value === null || value === undefined || value === '') return false
    if (Number.isFinite(Number(value))) return true
    return supported_chains.some((c) => isSameChainId(c.chainId, value))
}
