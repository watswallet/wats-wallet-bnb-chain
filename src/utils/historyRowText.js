// Aktivite satirinin METIN parcalarindan SECIM gerektirenler — SAF katman.
//
// NEDEN .vue ICINDE DEGIL: History.vue icin mount-test harness'i yok (bkz.
// historyWiring.test.js ustundeki gerekce), yani orada kalan her dal testsiz
// kalir. Asagidaki uc karar da sessizce yanlis cevap uretebilecek turden:
// hangi takas bacagi gosterilir, bilinmeyen ucret nasil isaretlenir, ucretin
// birimi hangi zincirden okunur. Ikisi zaten bir kez YANLIS yazilmisti
// (sabit 'ETH' birimi, kalici '—' ucret).
//
// i18n BURAYA GIRMEZ: bu modul cevrilecek metin uretmez, yalnizca veriden
// gelen degerleri secer ve bicimlendirir. Cevrilecek metinlerin secimi
// History.vue'de kalir.

import { isSolanaHistoryRow } from './historyRowDisplay'
import { isTon } from './chainKind'
import { nativeSymbolOf } from './nativeAmount'

/**
 * Takas satirinda VERILEN bacak, orn. "-0.05 BNB".
 *
 * Takasta "karsi taraf" bir yonlendirici sozlesmedir ve kullaniciya hicbir sey
 * anlatmaz; satirin ikinci satirini bu deger doldurur. Boylece satir takasin
 * IKI yanini birden soyler: baslik alinani, alt satir vereni.
 *
 * Takas OLMAYAN satirlarda bos dize doner (cagiran baska bir sey gosterir).
 */
export function swapGivenLeg(tx, formatNumber) {
    if (!tx || isSolanaHistoryRow(tx) || tx.category !== 'token swap') return ''

    const legs = Array.isArray(tx.erc20_transfers) ? tx.erc20_transfers : []
    const sent = legs.find((l) => l?.direction === 'send')
    if (!sent) return ''

    // jettonSymbol bacaktaki sembolu EZER: TON jetton satirlarinda bacak 'GRAM'
    // yaziyor (bkz. tonHistoryView.js), gercek sembol satir duzeyinde duruyor.
    const symbol = tx.jettonSymbol || sent.token_symbol || ''
    return `-${formatNumber(sent.value_formatted)} ${symbol}`.trim()
}

/**
 * Solana islem ucreti etiketi, orn. "0.000005 SOL".
 *
 * Ucret artik satirda TASINIYOR (bkz. solana/historyRow.js) — daha once hic
 * tasinmadigi icin detay modali kalici olarak "bilinmiyor" gosteriyordu.
 *
 * SIFIR da bilinmiyor sayilir: zincirde ucretsiz islem YOKTUR, yani 0 gelmisse
 * veri guvenilmezdir ve "0.000000 SOL" yazmak kullaniciyi yanlis bilgilendirir.
 */
export function solanaFeeLabel(tx, unknownLabel) {
    const fee = tx?.fee
    if (typeof fee !== 'number' || !Number.isFinite(fee) || fee <= 0) return unknownLabel
    return `${fee.toFixed(6)} SOL`
}

/**
 * Detay modalindaki islem ucretinin birimi.
 *
 * Burada sabit 'ETH' yaziliydi (TON icin tek istisnayla): BNB Chain'de ucret
 * "0,000123 ETH" gorunuyordu. Birim zincir kaydindan okunur.
 *
 * TON satiri KENDI chainId'sini tasir; aktif ag ne olursa olsun satirin kendi
 * zinciri kazanir — TON gecmisi baska bir agdayken de acilabilir.
 */
export function feeUnitFor(tx, chain) {
    if (isTon(tx?.chainId)) return 'GRAM'
    return nativeSymbolOf(chain)
}
