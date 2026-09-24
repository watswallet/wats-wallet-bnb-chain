// "Daha ne kadar ATS yuklemen gerekiyor" — saf hesap, I/O yok, i18n yok.
//
// NEDEN AYRI DOSYA: atsFee.js'in tamami INSAN BIRIMI ile calisir (dosya basi notu);
// buradaki `atsRequiredFromBudget` ise /status'un WEI dizelerini cozer. Ikisini ayni
// dosyaya koymak, o dosyanin "her sey insan birimi" sozunu sessizce bozardi.
//
// CANLI OLCUM 2026-09-01 (bu modulun VAR OLMA sebebi): bakiye eksikken ekranda
// yalnizca "BSC aginda ATS gerekli" yaziyordu — KAC ATS gerektigi HICBIR YERDE
// yoktu. Kullanici ne kadar yukleyecegini bilmeden borsaya gidiyor, tahminen
// yukluyor ve ayni kartla geri donuyordu.
import { atsWeiToHuman } from './ton/tonFeeAmounts'

const toBig = (v) => {
    if (v === undefined || v === null || v === '') return null
    // asBigInt'in kendi dogrulamasini TEKRARLAMIYORUZ, ama o FIRLATIR. Burada
    // firlatmak onay ekranini dusururdu: bozuk bir sunucu alani yuzunden
    // kullanici hicbir kart goremez. Cozulemiyorsa null -> cagiran ozel karti
    // cizmez, mevcut uyariya duser.
    if (typeof v === 'bigint') return v
    const s = String(v).trim()
    if (!/^-?\d+$/.test(s)) return null
    try { return BigInt(s) } catch { return null }
}

/**
 * `/paymaster/status`'un `budget` blogundan "en az ne kadar ATS gerekli" (insan birimi).
 *
 * YALNIZ `minChargeAts`. `budget.commissionAts` BILEREK OKUNMAZ.
 *
 * Bu fonksiyon SADECE TON kolunda cagriliyor (ConfirmTransaction.vue ve Swap.vue:
 * `isTonNetwork ? atsRequiredFromBudget(...) : ...`); EVM kolunun kendi kaynaklari
 * var (useAtsFee.requiredAts / useAtsOpFee.totalAtsCost). Komisyon terimi buraya iki
 * ayri hatayla girmisti:
 *
 *   1. Dayanak bir OLCUM degil bir CIKARIMDI: 2026-09-01'de 20 ATS'si olan hesap
 *      `src-balance-missing` aldi ve minCharge 19.05 oldugu icin "demek ki esik
 *      minCharge + komisyon" diye yorumlandi. O olcum chainId=56, yani EVM kolunda
 *      yapildi -- bu fonksiyonun HIC calismadigi kolda. Reddin baska aciklamalari da
 *      var (minCharge bir TABANDIR, gercek op daha pahali olabilir - bkz. atsFee.js
 *      needsBudgetTopUp; ya da engelleyen bakiye degil `srcAllowance`tir).
 *
 *   2. `budget.commissionAts` sozlesmede "Batch'i KURMAK icin gereken komisyon
 *      TAHMINI" olarak tanimli (sdk/gasless.ts). O batch bir EVM op'unun
 *      callData'sidir; TON akisi onu HIC kurmaz -- ucret tonFeeRelayer uzerinden
 *      imzalanan `feeAuth.atsMaxFee` ile alinir. Dolayisiyla TON kullanicisinin
 *      elinde tutmasi gereken tutarin parcasi degildir.
 *
 * Sonuc: ekran TON'da 28.58 yaziyordu, gereken 19.05'ti. Aradaki 9.53 ATS kullaniciya
 * fazladan yukletiliyordu.
 *
 * @param {{minChargeAts?: string}|null|undefined} budget
 * @param {number} [decimals]  ATS'nin ondalik basamagi (18)
 * @returns {string|null} insan-okunur ATS dizesi, ya da cozulemiyorsa null
 */
export function atsRequiredFromBudget(budget, decimals = 18) {
    const min = toBig(budget && budget.minChargeAts)
    if (min === null || min < 0n) return null

    return atsWeiToHuman(min, decimals)
}

const num = (v) => {
    if (v === null || v === undefined || v === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
}

/**
 * Bloklamayi kaldirmak icin kullanicinin YUKLEMESI gereken ATS (insan birimi).
 *
 * `null` doner ve bunun TEK anlami "ozel karti cizme"dir: ya veri eksik (gereken
 * ya da bakiye okunamadi) ya da eksik YOK (bakiye gerekeni karsiliyor). Her iki
 * durumda da "0 ATS daha gerekli" ya da uydurulmus bir sayi gostermek yerine
 * cagiran mevcut uyari kartina duser.
 *
 * `balance: null` "okunamadi" demektir, "sifir" DEGIL — sifir sayilsaydi bakiye
 * okumasi dustugunde kullaniciya gerekenin TAMAMINI yuklemesi soylenirdi.
 *
 * @returns {number|null} eksik ATS (> 0), ya da null
 */
export function atsShortfallAmount({ required, balance } = {}) {
    const r = num(required)
    const b = num(balance)
    if (r === null || b === null) return null
    const diff = r - b
    return diff > 0 ? diff : null
}
