import { plainDecimalString, truncateDecimals } from './decimalString'

// YUZDESEL TUTAR SECIMI
//
// MAX zaten vardi (Send.vue:setMax) ve ucret payini dusuyordu. Yuzde onun genel
// hali: ayni "harcanabilir" tanimindan pay alinir, dolayisiyla hicbir cip
// odenemez bir tutar uretemez.

export const SEND_PERCENTS = [0.25, 0.5, 0.75, 1]

// Gercekten gonderilebilecek miktar. `reserve` ucret payidir: native EVM'de gas
// tahmini, TON'da TON_FEE_RESERVE, jetton ve ERC-20'de 0 (ucret o varliktan
// odenmez). Bakiye ucreti bile karsilamiyorsa negatif bir harcanabilir anlamsiz.
export function spendableBalance(balance, reserve) {
    const b = Number(balance)
    const r = Number(reserve)
    if (!Number.isFinite(b)) return 0

    const spendable = b - (Number.isFinite(r) ? r : 0)
    return spendable > 0 ? spendable : 0
}

export function percentAmount({ balance, reserve, percent, decimals }) {
    const spendable = spendableBalance(balance, reserve)
    if (spendable === 0 || !(Number(percent) > 0)) return '0'

    // MAX harcanabilirin TA KENDISI. Gurultu temizligi ve kirpma BILEREK
    // atlaniyor: ikisi de degeri oynatir ve bu dal bugunku setMax davranisiyla
    // birebir ayni kalmali.
    if (Number(percent) >= 1) return plainDecimalString(spendable)

    // 1.2 * 0.25 kayan noktada 0.30000000000000004 uretir; kutuda bu gorunemez.
    let value = Number((spendable * Number(percent)).toPrecision(12))

    // KAPI: toPrecision YUKARI yuvarlayabilir. Harcanabiliri asan hicbir deger
    // disari cikmaz - asan her sonuc harcanabilire cekilir.
    if (value > spendable) value = spendable

    const d = Number.isFinite(Number(decimals)) ? Number(decimals) : 8
    return truncateDecimals(value, d)
}
