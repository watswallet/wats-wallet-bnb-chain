import { parseUnits } from 'ethers'
import { percentAmount } from '../sendPercent'
import { truncateDecimals, plainDecimalString } from '../decimalString'
import { CANONICAL_AMOUNT_RE } from './privateConstants'

// UCRET DOKUMU YARDIMCILARI (saf)
//
// Gizli mod Para yukle / Gonder ekraninin "Ucretler" karti, tutar kutusu ve teklif otomasyonu icin
// kucuk, agsiz, depo kullanmayan islevler. Popup'a girer: yalniz ethers ve saf yardimcilari import
// eder (silentswap.js ve privateOrderExec.js CEKILMEZ; privatePopupImports.test.js).
// Sabit bir "%1" yedegi YOKTUR: oran bilinmiyorsa null doner, ekran "-" gosterir (L13).

const DECIMALS = 18
const UNIT = 10n ** 18n

// Kanonik (tam sayi ya da en cok 18 ondalik) metni 18 ondalikli BigInt'e cevirir; degilse null.
function toUnits(text) {
    if (typeof text !== 'string' && typeof text !== 'number') return null
    const s = String(text)
    if (!CANONICAL_AMOUNT_RE.test(s)) return null
    try {
        return parseUnits(s, DECIMALS)
    } catch {
        return null
    }
}

// 18 ondalikli BigInt'i sondaki sifirlari kirpilmis ondalik dizgeye cevirir ('0.25', '1', '0').
function fromUnits(units) {
    const whole = units / UNIT
    const frac = (units % UNIT).toString().padStart(DECIMALS, '0').replace(/0+$/, '')
    return frac ? `${whole}.${frac}` : String(whole)
}

// Teklif ozetindeki SilentSwap ucreti: servis + entegrator ucreti. Biri eksik/bozuk/negatifse null.
export function totalSilentSwapFee(summary) {
    const service = toUnits(summary?.serviceFeeUsdc)
    const integrator = toUnits(summary?.integratorFeeUsdc)
    if (service === null || integrator === null) return null
    return fromUnits(service + integrator)
}

function validFeeBps(feeBps) {
    return typeof feeBps === 'number' && Number.isInteger(feeBps) && feeBps > 0 && feeBps <= 10000
}

// Ucret orani (yuzde, bir ondalik). Teklif varsa gercek oran (ucret / toplam); yoksa sunucunun
// bildirdigi feeBps; ikisi de yoksa null.
export function feePercent({ feeBps, summary } = {}) {
    const fee = totalSilentSwapFee(summary)
    const total = toUnits(summary?.totalUsdc)
    if (fee !== null && total !== null && total > 0n) {
        return Math.round((Number(fee) * 1000) / Number(summary.totalUsdc)) / 10
    }
    if (validFeeBps(feeBps)) return Math.round(feeBps / 10) / 10
    return null
}

// Teklif oncesi tahmini servis ucreti: tutar x feeBps / 10000 (BigInt, asagi yuvarlanir).
export function estimatedServiceFee(amountText, feeBps) {
    const amount = toUnits(amountText)
    if (amount === null || !validFeeBps(feeBps)) return null
    return fromUnits((amount * BigInt(feeBps)) / 10000n)
}

// Etkin en az tutar: sunucu degeri yalniz YUKSELTME yonunde izlenir.
export function effectiveMinUsdc(info, builtIn = 12) {
    const min = info?.minUsdc
    if (typeof min !== 'number' || !Number.isFinite(min) || !(min > 0)) return builtIn
    return Math.max(builtIn, min)
}

// Tutar kanonik ve en az minUsdc kadar mi (18 ondalik tam karsilastirma).
export function amountAtLeast(amountText, minUsdc) {
    const amount = toUnits(amountText)
    if (amount === null) return false
    try {
        return amount >= parseUnits(plainDecimalString(minUsdc), DECIMALS)
    } catch {
        return false
    }
}

export const PERCENT_CHIPS = [0.25, 0.5, 1]

// Yuzde cipi tutari. MAX dahil 6 ondaliga KIRPILIR (yuvarlanmaz, PD3): kayan nokta bakiyeyi asan
// bir tutar uretemez. Bakiye null/NaN/<=0 ise '0'.
// feeBps > 0 ise (SilentSwap ucreti tutarin USTUNE eklenir) tutar = bakiye x yuzde / (1 + feeBps/10000), tam sayi (BigInt, 6 ondalik)
// aritmetigiyle ASAGI yuvarlanir: MAX (%100) odeme + ucret toplaminin bakiyeyi asmayacagi en buyuk tutardir. feeBps verilmezse eski davranis.
export function percentChipAmount(balance, percent, feeBps = 0) {
    if (validFeeBps(feeBps)) {
        const micro = balanceMicro(balance)
        const pct = Number(percent)
        if (micro === null || micro <= 0n || !(pct > 0)) return '0'
        const net = (micro * 10000n) / BigInt(10000 + feeBps)
        const share = pct >= 1 ? net : (net * BigInt(Math.round(pct * 10000))) / 10000n
        return fromMicro(share)
    }
    const text = percentAmount({ balance, reserve: 0, percent, decimals: 6 })
    return truncateDecimals(text, 6)
}

// Bakiye (number) -> 6 ondalikli BigInt. Once 9 ondalikta en yakina (kayan nokta gurultusu 15.15 -> 15.149999... bakiyeyi eksik gostermesin),
// sonra 6 ondalige ASAGI: bakiye hicbir zaman oldugundan fazla okunmaz. Gecersizse null.
function balanceMicro(balance) {
    if (typeof balance !== 'number' || !Number.isFinite(balance) || balance < 0) return null
    return BigInt(Math.round(balance * 1e9)) / 1000n
}

function fromMicro(micro) {
    const whole = micro / 1000000n
    const frac = (micro % 1000000n).toString().padStart(6, '0').replace(/0+$/, '')
    return frac ? `${whole}.${frac}` : String(whole)
}

// Ucret oranlari bilinmiyorsa varsayilan (%1): SilentSwap ucreti tutarin ustune eklendigi icin bakiye karsilastirmasi temkinli kalir.
export const DEFAULT_BALANCE_FEE_BPS = 100
export function balanceFeeBps(info) {
    return validFeeBps(info?.feeBps) ? info.feeBps : DEFAULT_BALANCE_FEE_BPS
}

// Tutar bakiyeyi asiyor mu: yalniz bakiye sonlu bir sayi ve tutar kanonikken.
export function exceedsBalance(balance, amountText) {
    if (typeof balance !== 'number' || !Number.isFinite(balance)) return false
    if (typeof amountText !== 'string' || !CANONICAL_AMOUNT_RE.test(amountText)) return false
    return Number(amountText) > balance
}

// Odeme + ustune eklenen SilentSwap ucreti (tutar x (1 + feeBps/10000)) bakiyeyi asiyor mu: yalniz bakiye sonlu bir sayi ve tutar
// kanonikken. Tam sayi karsilastirma; bakiye 6 ondalikta okunur.
export function exceedsBalanceWithFee(balance, amountText, feeBps) {
    const micro = balanceMicro(balance)
    const amount = toUnits(amountText)
    if (micro === null || amount === null || !validFeeBps(feeBps)) return false
    return amount * BigInt(10000 + feeBps) > micro * 10n ** 12n * 10000n
}

// Tahmini teslim suresi (dakika, en az 1); bilinmiyorsa null.
export function etaMinutes(ms) {
    if (typeof ms !== 'number' || !Number.isFinite(ms) || !(ms > 0)) return null
    return Math.max(1, Math.round(ms / 60000))
}
