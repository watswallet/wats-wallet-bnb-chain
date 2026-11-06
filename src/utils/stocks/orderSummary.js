// Emir durum paneli (StockOrderConfirm) sunum yardimcilari. SAF: yoklama/durum mantigina dokunmaz,
// kayitta olmayan sayi uretmez (eksik girdi -> null, cagiran satiri cizmez).

const isDigits = (v) => typeof v === 'string' && /^\d+$/.test(v)

/**
 * Atomik miktar -> yerel bicimli metin. Kesilir (yuvarlanmaz: gosterilen miktar gercegi asmaz).
 * >= 1 ise en fazla 4 ondalik; < 1 ise ilk anlamli rakamdan sonra 3 hane (0,000728). Sifir/gecersiz -> null.
 */
export function formatAtomsLocale(atoms, decimals, locale) {
    if (!isDigits(atoms) || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null
    const v = BigInt(atoms)
    if (v === 0n) return null
    const base = 10n ** BigInt(decimals)
    const whole = v / base
    const frac = (v % base).toString().padStart(decimals, '0')
    let kept
    if (whole > 0n) {
        kept = frac.slice(0, 4)
    } else {
        const first = frac.search(/[1-9]/)
        kept = frac.slice(0, first + 3)
    }
    kept = kept.replace(/0+$/, '')
    let nf
    try {
        nf = new Intl.NumberFormat(locale)
    } catch {
        nf = new Intl.NumberFormat('en')
    }
    const sep = nf.formatToParts(1.1).find((p) => p.type === 'decimal')?.value ?? '.'
    const wholeText = nf.format(whole)
    return kept ? `${wholeText}${sep}${kept}` : wholeText
}

// CoW Explorer ag yollari (cowprotocol/cowswap libs/common-utils/src/explorer.ts: MAINNET kokte, BNB '/bnb', ARBITRUM_ONE '/arb1').
const COW_EXPLORER_BASE = 'https://explorer.cow.fi'
const COW_EXPLORER_PREFIX = Object.freeze({ 1: '', 56: '/bnb', 42161: '/arb1' })
const UID_RE = /^0x[0-9a-f]{112}$/i

export function cowExplorerOrderUrl(chainId, uid) {
    if (typeof chainId !== 'number' || !Object.hasOwn(COW_EXPLORER_PREFIX, chainId)) return null
    if (typeof uid !== 'string' || !UID_RE.test(uid)) return null
    return `${COW_EXPLORER_BASE}${COW_EXPLORER_PREFIX[chainId]}/orders/${uid}`
}

/** Hisse basina ortalama odeme/getiri (odeme tokeni stable: USDC/USDT). Veri eksik/sifirsa null. */
export function averageUnitPrice({ paidAtoms, paidDecimals, stockAtoms, stockDecimals }) {
    if (!isDigits(paidAtoms) || !isDigits(stockAtoms)) return null
    if (!Number.isInteger(paidDecimals) || !Number.isInteger(stockDecimals)) return null
    const paid = Number(paidAtoms) / 10 ** paidDecimals
    const stock = Number(stockAtoms) / 10 ** stockDecimals
    if (!(paid > 0) || !(stock > 0)) return null
    const p = paid / stock
    return Number.isFinite(p) ? p : null
}

export const ORDER_STEP_KEYS = Object.freeze(['signed', 'sent', 'searching', 'settling', 'done'])

/** Faz + CoW apiStatus -> vurgulu adim (0..4); expired/cancelled adim uretmez. */
export function stepIndexOf(phase, apiStatus) {
    switch (phase) {
        case 'submitting':
            return 1
        case 'pending':
            return apiStatus === 'solved' || apiStatus === 'executing' ? 3 : 2
        case 'fulfilled':
            return 4
        default:
            return null
    }
}

export function formatElapsed(ms) {
    const s = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Hisse miktari x referans fiyat (USD). Referans fiyat ya da miktar gecersizse null (sayi uydurulmaz). */
export function stockValueUsd({ atoms, decimals, price }) {
    if (!isDigits(atoms) || !Number.isInteger(decimals)) return null
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return null
    const units = Number(atoms) / 10 ** decimals
    const v = units * price
    return Number.isFinite(v) && v > 0 ? v : null
}
