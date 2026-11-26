// KAYMAK G7: sayan degerler (spec 7.6, K6, K7, D8).
//
// Saf modul: depo ve eklenti API'si import etmez (K7). Sayilan ara deger YALNIZ
// gorunurdur; onText ile yapraga yazilir, baska hicbir yere verilmez. Depo, Max,
// limit ve dogrulama bu modulun urettigi degeri asla okumaz.
//
// useTransition KULLANILMAZ (D8): window yokken ilk tikte eski degerde takili kaliyor.
// Bunun yerine tek, paylasilan bir rAF dongusu (createTicker) butun sayaclari ilerletir.

/** easeOutQuart: 1 - (1-t)^4, girdi [0,1]'e kirpilir (NaN -> 0). */
export function easeOutQuart(t) {
    if (!(t > 0)) return 0
    if (t >= 1) return 1
    return 1 - (1 - t) ** 4
}

/**
 * Tek rAF dongusu. `add(fn)` kaydeder; her karede `fn(now)` cagrilir, `false`
 * donen (ya da hata atan) kayit cikarilir. Kayit kalmayinca yeni kare istenmez.
 */
export function createTicker({ raf, caf, now }) {
    const fns = new Set()
    let id = null

    const kare = () => {
        id = null
        const t = now()
        for (const fn of [...fns]) {
            if (!fns.has(fn)) continue
            let devam
            try {
                devam = fn(t)
            } catch {
                devam = false
            }
            if (devam === false) fns.delete(fn)
        }
        if (fns.size > 0 && id === null) id = raf(kare)
    }

    return {
        add(fn) {
            fns.add(fn)
            if (id === null) id = raf(kare)
        },
        remove(fn) {
            fns.delete(fn)
            if (fns.size === 0 && id !== null) {
                if (typeof caf === 'function') caf(id)
                id = null
            }
        },
    }
}

let paylasilan = null

/**
 * `globalThis.requestAnimationFrame` fonksiyonsa tembel tek ornek; degilse (SSR,
 * node testleri) `null`. Global'ler cagri aninda okunur (sahte zamanlayicilar
 * sonradan kurulsa da calisir).
 */
export function getSharedTicker() {
    if (typeof globalThis.requestAnimationFrame !== 'function') return null
    if (!paylasilan) {
        paylasilan = createTicker({
            raf: (cb) => globalThis.requestAnimationFrame(cb),
            caf: (i) => {
                if (typeof globalThis.cancelAnimationFrame === 'function') globalThis.cancelAnimationFrame(i)
            },
            now: () => (typeof globalThis.performance?.now === 'function' ? globalThis.performance.now() : Date.now()),
        })
    }
    return paylasilan
}

/**
 * Hedef birlestirici: ilk `push` `ms`'lik pencereyi acar, pencere sonunda SON
 * degerle `onFire` cagrilir (en fazla `ms` gecikme, son deger kazanir).
 */
export function createCoalescer({
    ms = 120,
    setTimer = (fn, sure) => setTimeout(fn, sure),
    clearTimer = (h) => clearTimeout(h),
} = {}) {
    let zamanlayici = null
    let son
    let ates = null

    return {
        push(value, onFire) {
            son = value
            ates = onFire
            if (zamanlayici !== null) return
            zamanlayici = setTimer(() => {
                zamanlayici = null
                const f = ates
                const v = son
                ates = null
                son = undefined
                if (typeof f === 'function') f(v)
            }, ms)
        },
        cancel() {
            if (zamanlayici !== null) {
                clearTimer(zamanlayici)
                zamanlayici = null
            }
            ates = null
            son = undefined
        },
    }
}

const sayiMi = (v) => typeof v === 'number' && Number.isFinite(v)

/**
 * Sayan metin denetleyicisi (spec 7.6).
 *
 * Aninda yazma (bekleyen ve suren her sey iptal, `onText(text)` hemen):
 *   kimlik degisti, yeni deger ya da gosterilen deger sonlu sayi degil,
 *   `ticker` null ya da `motionAllowed()` false.
 * Aksi halde hedef `coalesceMs` birlestirilir; pencere sonunda o an GOSTERILEN
 * sayidan (suren tween'in son karesi ya da son hedef) yeni hedefe easeOutQuart ile
 * `durationMs`'te sayilir. Ara karede `onText(format(v))`, son karede `onText(text)`
 * (birebir). Kurulumda hicbir sey yazilmaz: ilk deger animasyonsuzdur (K6).
 */
export function createCounter({
    initial,
    format,
    onText,
    ticker,
    motionAllowed,
    durationMs = 520,
    coalesceMs = 120,
    setTimer,
    clearTimer,
}) {
    const ilk = initial || {}
    // Son istenen durum (metin, sayi ya da null, kimlik).
    let istek = { text: ilk.text, value: sayiMi(ilk.value) ? ilk.value : null, identity: ilk.identity ?? '' }
    // Ekranda o an gosterilen sayi; sayi gosterilmiyorsa null.
    let gosterilen = istek.value
    let kare = null
    let bitti = false

    const birlestirici = createCoalescer({
        ms: coalesceMs,
        ...(setTimer ? { setTimer } : {}),
        ...(clearTimer ? { clearTimer } : {}),
    })

    const kareyiDurdur = () => {
        if (kare && ticker) ticker.remove(kare)
        kare = null
    }

    const hareketVar = () => !!ticker && motionAllowed() === true

    const aninda = (hedef) => {
        birlestirici.cancel()
        kareyiDurdur()
        gosterilen = hedef.value
        onText(hedef.text)
    }

    const baslat = (hedef) => {
        if (bitti) return
        if (!hareketVar() || !sayiMi(gosterilen)) {
            aninda(hedef)
            return
        }
        kareyiDurdur()
        const bas = gosterilen
        const son = hedef.value
        if (bas === son) {
            onText(hedef.text)
            return
        }
        let baslangic = null
        const fn = (simdi) => {
            if (kare !== fn) return false
            if (baslangic === null) {
                baslangic = simdi
                return true
            }
            const p = durationMs > 0 ? (simdi - baslangic) / durationMs : 1
            if (p >= 1) {
                kare = null
                gosterilen = son
                onText(hedef.text)
                return false
            }
            const v = bas + (son - bas) * easeOutQuart(p)
            gosterilen = v
            onText(format(v))
            return true
        }
        kare = fn
        ticker.add(fn)
    }

    return {
        update({ text, value, identity } = {}) {
            if (bitti) return
            const yeni = { text, value: sayiMi(value) ? value : null, identity: identity ?? '' }
            if (yeni.identity === istek.identity && yeni.text === istek.text && Object.is(yeni.value, istek.value)) return
            const kimlikDegisti = yeni.identity !== istek.identity
            istek = yeni
            if (kimlikDegisti || yeni.value === null || !sayiMi(gosterilen) || !hareketVar()) {
                aninda(yeni)
                return
            }
            birlestirici.push(yeni, baslat)
        },
        dispose() {
            bitti = true
            birlestirici.cancel()
            kareyiDurdur()
        },
    }
}
