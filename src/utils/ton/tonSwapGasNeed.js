// TON takasinda kullanicinin KENDI bakiyesinden cikacak TON - saf hesap, I/O yok.
//
// NEDEN AYRI DOSYA: bu kural zincir tarafinda tonSwap.js'in KAPI 6'sinda yaziyor
// (`tonNeeded = offerNative ? (relayMode ? offerUnits : gasNano + offerUnits)
//                           : (relayMode ? 0n : gasNano)`).
// Ekrandaki karsiligi bugune kadar Swap.vue'nun icinde, gonderim yolundan HABERSIZ
// duruyordu: gaz payi KOSULSUZ ekleniyordu. Sonuc (2026-09-15, canli olcum) GRAM->USDT
// takasinda "Yetersiz Bakiye (Gas)" kirmizi karti ve kilitli bir takas dugmesiydi -
// oysa role modunda o gaz rolecinin tankindan cikiyor, karsiligi BSC'de ATS olarak
// kesiliyor ve prepareTonSwap kullanicidan SIFIR TON istiyordu. Yani ekran, gonderim
// yolunun HIC uygulamadigi bir sarti dayatiyordu.
//
// Kural artik KAPI 6 ile YAN YANA konabilecek bir dosyada ve testi bir Vue dosyasinin
// metnine degil, davranisa bakiyor.

/**
 * Takas icin kullanicidan cikacak TON (insan birimi).
 *
 * IKI AYRIM KAYBEDILMEMELI:
 *   1. Gaz payi YALNIZ role odemeyecekse istenir (`relayPaysGas`).
 *   2. Takasa GIREN native TON role acikken de kullanicidan cikar - "role acik" ile
 *      "bedava" ayni sey degil (sozlesme ss00/ss04: `amountNano` hicbir zaman
 *      sponsorlanmaz).
 *
 * Donen 0 degeri "zincire cikma" demektir: jetton->* role yolunda kullanicinin TON
 * bakiyesi soruyu HIC etkilemez, okumak bosuna bir RPC turu (ve bir ariza noktasi)
 * olurdu - KAPI 6'nin `tonNeeded > 0n` kurali.
 *
 * Sayiya cevrilemeyen girdiler 0 SAYILMAZ, cunku 0 "ihtiyac yok" anlamina geliyor ve
 * bozuk bir teklif alanini "gaz bedava" diye okumak kirmizi karti haksiz yere
 * KALDIRIRDI. Cozulemeyen deger `null` doner; cagiran onu "bilmiyorum" olarak ele
 * alip fail-closed kalabilir.
 *
 * @param {{isNativeIn?: boolean, amount?: number|string, gasCost?: number|string, relayPaysGas?: boolean}} p
 * @returns {number|null} gereken TON, ya da cozulemiyorsa null
 */
export function tonSwapGasNeed({ isNativeIn = false, amount, gasCost, relayPaysGas = false } = {}) {
    const gaz = relayPaysGas ? 0 : sayi(gasCost)
    const pay = isNativeIn ? sayi(amount) : 0
    if (gaz === null || pay === null) return null
    return gaz + pay
}

function sayi(v) {
    if (v === undefined || v === null || v === '') return 0
    const n = Number(v)
    return Number.isFinite(n) && n >= 0 ? n : null
}

/**
 * "Bu ihtiyac kullanicinin TON bakiyesini asiyor mu" - saf KARAR, I/O yok.
 *
 * NEDEN AYRI FONKSIYON (2026-09-15 gerilemesi): karar eskiden Swap.vue icinde,
 * teklif turunun ORTASINDA duz bir ref'e YAZILIYORDU. O an `relayPaysGas` bir tur
 * eski okunuyordu ve yazilan cevap DONUYORDU: role birkac saniye sonra cozulunce
 * kirmizi kart reaktif olarak kayboluyor ama dugme kilitli kaliyordu - ekranda
 * hicbir aciklama olmadan. Karar saf bir fonksiyon olunca cagiran onu bir
 * `computed`e koyabilir; kart ile dugme AYNI ANDA ve AYNI cevapla doner.
 *
 * SIRA BAGLAYICIDIR:
 *   1. Ihtiyac COZULEMEDI (`null`) -> fail-closed. "Bilmiyorum" ile "yeterli" ayni
 *      sey degil; bozuk bir teklif alani dugmeyi ACMAMALI.
 *   2. Ihtiyac 0 -> engel YOK. KAPI 6'nin (`tonSwap.js`) `tonNeeded > 0n` kurali:
 *      jetton->jetton role takasinda kullanicinin TON'u soruya HIC girmez. Bu adim
 *      bakiye kontrollerinden ONCE gelir ve gelmek ZORUNDADIR - okunamamis bir
 *      bakiye, SORULMAYAN bir soruyu kilitlememeli. (Kart bu yuzden role kolunda
 *      bir RPC hiccup'inda da cizilmez.)
 *   3. Bakiye okunamadi ya da HENUZ okunmadi -> fail-closed. Ihtiyac VAR ve
 *      karsilandigini BILMIYORUZ.
 *
 * @param {{need: number|null|undefined, balance: number|string|null|undefined, unreadable?: boolean}} p
 * @returns {boolean} true ise gaz engeli var
 */
export function tonSwapGasBlocked({ need, balance, unreadable = false } = {}) {
    if (need === null || need === undefined) return true
    if (need <= 0) return false
    if (unreadable) return true
    if (balance === null || balance === undefined || balance === '') return true
    const b = Number(balance)
    if (!Number.isFinite(b)) return true
    return b < need
}
