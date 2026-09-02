// TON tutarlari NANOTON (1e9), EVM tutarlari WEI (1e18). Ikisini karistirmak
// ucreti milyar kat yanlis hesaplar - bu yuzden donusum TEK yerde.
export const NANO_PER_TON = 1_000_000_000n

/**
 * string|number|bigint -> bigint. Ondalikli veya sayi olmayan girdide firlatir:
 * sessizce Math.trunc gibi davranmak, kirilmis bir tutari sessizce yuvarlar ve
 * kullaniciya yanlis ucret gosterir.
 * @throws {Error} TON_AMOUNT_NOT_INTEGER | TON_AMOUNT_INVALID_TYPE
 */
export function asBigInt(v) {
    if (typeof v === 'bigint') return v
    if (typeof v === 'number') {
        if (!Number.isInteger(v)) throw new Error('TON_AMOUNT_NOT_INTEGER')
        return BigInt(v)
    }
    if (typeof v === 'string') {
        const s = v.trim()
        if (!/^-?\d+$/.test(s)) throw new Error('TON_AMOUNT_NOT_INTEGER')
        return BigInt(s)
    }
    throw new Error('TON_AMOUNT_INVALID_TYPE')
}

// Paylasilan ondalik-bicimleme mantigi: tam kisim / kesir, kesiri sabit basamaga
// doldur, sondaki sifirlari at. nanoToTon ve atsWeiToHuman AYNI kurala uyar ki
// biri diger degisince ikisi birden yanlis gitmesin.
function formatUnits(raw, decimals) {
    const neg = raw < 0n
    const abs = neg ? -raw : raw
    const base = 10n ** BigInt(decimals)
    const whole = abs / base
    const frac = abs % base
    const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '')
    const out = fracStr ? `${whole}.${fracStr}` : `${whole}`
    return neg ? `-${out}` : out
}

/**
 * Nanoton -> TON gosterim dizesi. En fazla 9 ondalik, sondaki sifirlar atilir.
 */
export function nanoToTon(nano) {
    return formatUnits(asBigInt(nano), 9)
}

/**
 * ATS-wei -> okunabilir ATS dizesi. Varsayilan 18 ondalik (ATS'nin kendi
 * decimals'i); gosterim icindir, zincire geri gonderilmez.
 */
export function atsWeiToHuman(wei, decimals = 18) {
    return formatUnits(asBigInt(wei), decimals)
}
