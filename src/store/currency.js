import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { configStore } from './config'
import { privacyStore } from './privacy'
import { defaultCurrencyFor, normalizeCurrencyCode, selectableCurrencies } from '../utils/currencyCatalog'
import {
    fetchRatesSnapshot,
    isSnapshotFresh,
    readStoredSnapshot,
    resolveDisplay,
    shouldAdoptSnapshot,
    writeSnapshot,
} from '../utils/fiatRates'

/**
 * Para birimi (fiat) deposu: secilen birim, kur gorunumu (snapshot), saat ve yenileme.
 *
 * MANTIK baska modullerde: birim kodu kurallari utils/currencyCatalog.js, kur cekme/yas
 * kurallari/depo okuma-yazma utils/fiatRates.js, tutar biciminin kendisi utils/money.js.
 * Bu depo yalniz bunlari bir araya baglar ve durumu tutar.
 *
 * SAAT: `clock` her dakika tiklenir. Kur yasi (24 saat kurali) HER cagrida `clock` ile
 * hesaplanir; popup gun boyu acik kalsa da eski kur sessizce ekranda KALMAZ, USD'ye duser
 * (display.fellBack). Saat ayni zamanda yenileme zamanlayicisidir.
 *
 * DISK: secim `chrome.storage.local` icindeki `currency` anahtarinda. Baska pencereden
 * gelen degisiklik utils/uiSync.js uzerinden `adopt` ile alinir (diske geri YAZILMAZ,
 * yoksa pencereler arasi ping-pong olurdu).
 */
export const CURRENCY_STORAGE_KEY = 'currency'

// Saat tiki ve yenileme kontrol araligi. Kur 10 dk'dan gencse tik ag istegi YAPMAZ
// (refreshRates taze onbellegi kullanir), yani asil ag sikligi RATES_TTL_MS'tir.
const CLOCK_TICK_MS = 60 * 1000
const INITIAL_CODE = 'usd'

// Tarayici dili: languages listesi, yoksa tek language. navigator yoksa (SSR/node) bos.
function browserLanguages() {
    const nav = globalThis.navigator
    if (!nav) return []
    return nav.languages?.length ? nav.languages : [nav.language]
}

// chrome.storage.local ya da null (chrome yok). null verilirse fiatRates yardimcilari
// kendi try/catch'inde yutar; depo hicbir durumda ekrani dusurmez.
const storageArea = () => globalThis.chrome?.storage?.local ?? null

export const currencyStore = defineStore('currencyStore', () => {
    const config = configStore()

    // 'usd' yalniz BASLANGIC: gercek secim/varsayilan init() ile gelir. Varsayilan
    // (tarayici dili) burada hesaplanmaz -- testlerde makinenin dili sizmasin.
    const code = ref(INITIAL_CODE)
    const snapshot = ref(null)
    const clock = ref(Date.now())

    const display = computed(() => resolveDisplay(code.value, snapshot.value, clock.value))
    const list = computed(() => selectableCurrencies(snapshot.value?.currencies, snapshot.value?.rates))

    let initPromise = null
    let timer = null
    let inflight = null

    const defaultCode = () => defaultCurrencyFor(browserLanguages())

    // Gecerli (haric tutulmayan, 3 harfli) kod ise o, degilse tarayici dilinden varsayilan.
    // Soz diziminde gecerli ama tabloda olmayan kod ("xyz") KORUNUR: uyeligi resolveDisplay
    // denetler ve USD etiketli gosterir.
    const codeOrDefault = (value) => normalizeCurrencyCode(value) || defaultCode()

    /**
     * Kur tablosunu yeniler. Taze (10 dk) ve `force` yoksa ag yok; zaten bir istek
     * ucundaysa ona katilir (tek istek). ATMAZ: hata uyari olur, eldeki gorunum korunur.
     * Gelen tablo yalniz kur zamani BILINIYORSA ve eldekinden eski DEGILSE benimsenir
     * (shouldAdoptSnapshot): yedegi geride kalmis ya da zamansiz bir yanit, eldeki daha
     * yeni iyi kuru (24 saat kurali) ezmez; bu durumda disk de yazilmaz.
     */
    function refreshRates({ force = false } = {}) {
        // GIZLI MOD: fiyat gosterilmez, kur tablosu istenmez (kesici de reddederdi; burada sessizce atlanir).
        if (privacyStore().active) return Promise.resolve()
        if (inflight) return inflight
        if (!force && isSnapshotFresh(snapshot.value, Date.now())) return Promise.resolve()

        inflight = (async () => {
            try {
                const next = await fetchRatesSnapshot({ api: config.api })
                if (!shouldAdoptSnapshot(snapshot.value, next)) {
                    console.warn('Kur tablosu eldekinden eski ya da zamansiz geldi, eldeki kur korundu')
                    return
                }
                snapshot.value = next
                // Diske DUZ nesne gider (reaktif sarmalayici degil).
                await writeSnapshot(storageArea(), next)
            } catch (e) {
                console.warn('Kur tablosu yenilenemedi:', e)
            } finally {
                inflight = null
            }
        })()
        return inflight
    }

    function startTimer() {
        if (timer) return
        timer = setInterval(() => {
            clock.value = Date.now()
            void refreshRates()
        }, CLOCK_TICK_MS)
    }

    /**
     * Acilista bir kez: kayitli secimi ve kur gorunumunu BIRLIKTE okur ve tek adimda atar, saati kurar, ilk yenilemeyi
     * BASLATIR (sonucunu beklemez: ekran kayitli kurla hemen cizilir). Idempotent.
     * @returns {Promise<void>}
     */
    function init() {
        if (initPromise) return initPromise
        initPromise = (async () => {
            const storage = storageArea()

            // Kayitli secim ve kayitli kur BIRLIKTE okunur ve TEK adimda atanir. Ayri ayri
            // atansaydi ilk cizim '$', sonra kur yokken 'USD 12.34' (kod geldi, tablo yok),
            // en sonda secili birim gorunurdu. Kur ONCE atanir: kod hala baslangic 'usd' iken
            // bu gorunumu degistirmez; ardindan kod gelince gorunum dogrudan secili birime atlar.
            const [stored, storedSnapshot] = await Promise.all([
                (async () => {
                    try {
                        return (await storage.get(CURRENCY_STORAGE_KEY))?.[CURRENCY_STORAGE_KEY]
                    } catch {
                        return undefined // okunamayan depo = secim yok
                    }
                })(),
                readStoredSnapshot(storage),
            ])
            // Ag gelmeden once kayitli kur; bu arada daha yeni bir kur geldiyse ezmez.
            if (storedSnapshot && !snapshot.value) snapshot.value = storedSnapshot
            code.value = codeOrDefault(stored)

            clock.value = Date.now()
            startTimer()
            void refreshRates()
        })()
        return initPromise
    }

    /**
     * Kullanici secimi. Gecersiz/haric kod -> false, hicbir sey yazilmaz. Gecerliyse durum
     * hemen degisir, diske yazilir (diger pencereler uiSync ile alir) ve kur yenilenir.
     * @param {unknown} value
     * @returns {Promise<boolean>}
     */
    async function select(value) {
        const next = normalizeCurrencyCode(value)
        if (!next) return false
        code.value = next
        try {
            await storageArea().set({ [CURRENCY_STORAGE_KEY]: next })
        } catch (e) {
            // Secim bu oturum icin gecerli kalir; kalici olmadigini haber ver.
            console.warn('Para birimi secimi kaydedilemedi:', e)
        }
        void refreshRates()
        return true
    }

    /**
     * Baska pencerede yapilan secimi benimser: YALNIZ durum, diske yazmaz (uiSync icin).
     * Gecersiz deger init() ile ayni kurala uyar (varsayilan birim).
     * @param {unknown} value
     */
    function adopt(value) {
        code.value = codeOrDefault(value)
    }

    return { code, snapshot, clock, display, list, init, select, adopt, refreshRates }
})
