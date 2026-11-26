// KAYMAK G8: sayac rakamli toplam bakiye (spec 7.7, K6, D9).
//
// Saf modul: depo ve eklenti API'si import etmez (K7). Donen rakamlar YALNIZ
// gorunurdur; depo, Max, limit ve dogrulama buradaki hicbir degeri okumaz.
//
// Plan (odometerPlan):
//   plain   : metinde ASCII disi rakam var ya da yazi yonu sagdan sola -> sayac yok, duz metin.
//   rebuild : rakam imzasi (uzunluk, gruplama, isaret) ya da boyut sinifi degisti -> animasyonsuz.
//   roll    : digerleri; her ASCII rakam 0-9 seridinde doner.
//
// Denetleyici (createOdometer) Vue'dan bagimsizdir; bilesen yalniz durumu cizer (D9: serit
// yalniz donus suresince kurulur, bitince duz metne donulur).
import { createCoalescer } from './tween'

/** Donus suresi (ms); style.css'teki `.kaymak-odometre-serit` gecisiyle ayni (.6s). */
export const ROLL_MS = 600
/** Sagdan sola hane basina gecikme (ms). */
export const ROLL_STEP_MS = 22
/** Gecikme tavani: ROLL_MS + tavan <= 800 ms (spec 7.7, Ek insaatci notu 3). */
export const ROLL_DELAY_MAX_MS = 200

const ASCII_RAKAM = /[0-9]/
const ASCII_DISI_RAKAM = /(?![0-9])\p{Nd}/u
const RTL_ONEKLERI = new Set(['ar', 'fa', 'he', 'ur', 'ps', 'yi', 'dv', 'ku', 'sd', 'ug'])

/** ASCII rakamlar `#` olur; ayiraclar, isaret, NBSP ve NNBSP aynen kalir. */
export function digitSignature(text) {
    return String(text ?? '').replace(/[0-9]/g, '#')
}

/** `\p{Nd}` olup `[0-9]` olmayan bir rakam var mi. */
export function hasNonAsciiDigit(text) {
    return ASCII_DISI_RAKAM.test(String(text ?? ''))
}

/** Dil kodu sagdan sola yazilan bir dilin oneki mi (`ar`, `ar-EG`, `fa_IR` ...). */
export function isRtlLocale(locale) {
    if (typeof locale !== 'string' || locale === '') return false
    return RTL_ONEKLERI.has(locale.split(/[-_]/)[0].toLowerCase())
}

/**
 * @param {{ text: string, size?: string }} prev
 * @param {{ text: string, size?: string }} next
 * @param {{ locale?: string }} [opts]
 * @returns {'roll'|'rebuild'|'plain'}
 */
export function odometerPlan(prev, next, { locale } = {}) {
    const a = String(prev?.text ?? '')
    const b = String(next?.text ?? '')
    if (hasNonAsciiDigit(a) || hasNonAsciiDigit(b) || isRtlLocale(locale)) return 'plain'
    if (digitSignature(a) !== digitSignature(b)) return 'rebuild'
    if ((prev?.size ?? '') !== (next?.size ?? '')) return 'rebuild'
    return 'roll'
}

/** Metnin hucreleri: ASCII rakam `{ digit }`, diger her karakter (NBSP, NNBSP dahil) `{ char }`. */
export function odometerCells(text) {
    return [...String(text ?? '')].map((ch) => (ASCII_RAKAM.test(ch) ? { digit: Number(ch) } : { char: ch }))
}

/** Rakam hucresi basina gecikme (ms): en sagdaki 0, sola dogru +22, en fazla 200. */
export function rollDelays(cells) {
    const n = (cells || []).filter((h) => h && 'digit' in h).length
    return Array.from({ length: n }, (_, i) => Math.min(ROLL_DELAY_MAX_MS, (n - 1 - i) * ROLL_STEP_MS))
}

// Cizilecek hucreler: rakam hucresi gecikmesini tasir.
function cizimHucreleri(text) {
    const hucreler = odometerCells(text)
    const gecikmeler = rollDelays(hucreler)
    let i = 0
    return hucreler.map((h) => ('digit' in h ? { digit: h.digit, delay: gecikmeler[i++] } : h))
}

const enBuyukGecikme = (hucreler) => hucreler.reduce((m, h) => ('digit' in h && h.delay > m ? h.delay : m), 0)

const durum = (h) => ({
    text: String(h?.text ?? ''),
    size: String(h?.size ?? ''),
    identity: String(h?.identity ?? ''),
    locale: String(h?.locale ?? ''),
})
const ayni = (a, b) => a.text === b.text && a.size === b.size && a.identity === b.identity && a.locale === b.locale

/**
 * Sayac denetleyicisi. Cizilecek durumu `onState` ile verir:
 *   `{ text, cells: null, start: false }`           duz metin
 *   `{ text, cells: [...], start: true|false }`      donus (start: sutunlar onceki rakamlarda, gecissiz)
 * `text` her zaman gercek son degerdir (donuste gorunmez metin olarak durur).
 *
 * Aninda duz (bekleyen ve suren her sey iptal): kimlik ya da dil degisti, hareket izni yok,
 * kok cizilmemis (`canRoll` false) ya da plan `roll` degil. Aksi halde hedef `coalesceMs`
 * birlestirilir (son deger kazanir); pencere sonunda:
 *   - donus yoksa: sutunlar onceki rakamlarda `start: true` ile kurulur; `afterRender` (cizim +
 *     yerlesim okumasi) donunce yeni rakamlara gecilir; `rollMs + en buyuk gecikme` sonra duz.
 *   - donus suruyorsa ve plan `roll`: rakamlar yeniden hedeflenir (CSS gecisi kendiliginden o
 *     anki konumdan doner), bitis zamanlayicisi yeniden kurulur.
 * Kurulumda hicbir sey yazilmaz: ilk cizim duzdur (K6).
 */
export function createOdometer({
    initial,
    onState,
    motionAllowed,
    canRoll = () => true,
    afterRender = (fn) => fn(),
    coalesceMs = 120,
    rollMs = ROLL_MS,
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (h) => clearTimeout(h),
}) {
    // Son istenen durum ve ekranda olan (ya da donusle varilan) hedef.
    let istek = durum(initial)
    let goster = istek
    let donuyor = false
    let baslangicBekliyor = false
    let hucreler = null
    let bitis = null
    // Her duz yazim, bitis ve dispose turu artirir: gec gelen cizim/bitis geri cagrilari gecersiz olur.
    let tur = 0
    let bitti = false

    const birlestirici = createCoalescer({ ms: coalesceMs, setTimer, clearTimer })

    const hareketVar = () => motionAllowed() === true && canRoll() === true
    const planla = (a, b) => odometerPlan(a, b, { locale: b.locale })

    const bitisiTemizle = () => {
        if (bitis !== null) {
            clearTimer(bitis)
            bitis = null
        }
    }

    const duz = (hedef) => {
        birlestirici.cancel()
        bitisiTemizle()
        tur++
        donuyor = false
        baslangicBekliyor = false
        hucreler = null
        goster = hedef
        onState({ text: hedef.text, cells: null, start: false })
    }

    const bitisKur = () => {
        bitisiTemizle()
        const t = tur
        bitis = setTimer(() => {
            bitis = null
            if (bitti || t !== tur) return
            tur++
            donuyor = false
            hucreler = null
            onState({ text: goster.text, cells: null, start: false })
        }, rollMs + enBuyukGecikme(hucreler))
    }

    const uygula = (hedef) => {
        if (bitti) return
        if (!hareketVar() || planla(goster, hedef) !== 'roll') {
            duz(hedef)
            return
        }
        if (hedef.text === goster.text) {
            goster = hedef
            return
        }
        if (donuyor) {
            goster = hedef
            hucreler = cizimHucreleri(hedef.text)
            // Baslangic hali henuz cizilmediyse yeni hedefi `afterRender` yazar.
            if (baslangicBekliyor) return
            onState({ text: hedef.text, cells: hucreler, start: false })
            bitisKur()
            return
        }
        const t = ++tur
        const bas = cizimHucreleri(goster.text)
        donuyor = true
        baslangicBekliyor = true
        goster = hedef
        hucreler = cizimHucreleri(hedef.text)
        onState({ text: hedef.text, cells: bas, start: true })
        afterRender(() => {
            if (bitti || t !== tur) return
            baslangicBekliyor = false
            onState({ text: goster.text, cells: hucreler, start: false })
            bitisKur()
        })
    }

    return {
        update(h) {
            if (bitti) return
            const yeni = durum(h)
            if (ayni(yeni, istek)) return
            const kimlikDegisti = yeni.identity !== istek.identity || yeni.locale !== istek.locale
            istek = yeni
            if (kimlikDegisti || !hareketVar() || planla(goster, yeni) !== 'roll') {
                duz(yeni)
                return
            }
            birlestirici.push(yeni, uygula)
        },
        dispose() {
            bitti = true
            birlestirici.cancel()
            bitisiTemizle()
            tur++
        },
    }
}
