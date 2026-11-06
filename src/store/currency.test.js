import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { watch } from 'vue'
import { installChromeStub } from '../test-utils/ssrRender.js'
import { fetchRatesSnapshot } from '../utils/fiatRates'
import { configStore } from './config'
import { currencyStore, CURRENCY_STORAGE_KEY } from './currency'

// Ag sinirinda sahte: depo kurallari (taze/eski, tek istek, hata) fetch'in kendisinden
// bagimsiz sinanir. Geri kalan fiatRates (isSnapshotFresh, resolveDisplay, depo
// yardimcilari) GERCEK calisir.
vi.mock('../utils/fiatRates', async (importOriginal) => ({
    ...(await importOriginal()),
    fetchRatesSnapshot: vi.fn(),
}))

const NOW = Date.UTC(2026, 10, 3, 12, 0, 0)
const MIN = 60 * 1000
const HOUR = 60 * MIN

const CURRENCIES = [
    { code: 'USD', name: 'US Dollar', symbol: '$' },
    { code: 'TRY', name: 'Turkish Lira', symbol: '₺' },
    { code: 'EUR', name: 'Euro', symbol: '€' },
    { code: 'VEF', name: 'Venezuelan Bolivar', symbol: 'Bs' },
    { code: 'XDR', name: 'Special Drawing Rights', symbol: 'XDR' },
    { code: 'XYZ', name: 'Kuru olmayan', symbol: 'Z' },
]

// updatedAt/fetchedAt verilmezse "simdi" (sahte saat): taze ve yasi sifir bir kur.
function snap(over = {}) {
    const now = Date.now()
    return {
        rates: { try: 40, eur: 0.9, vef: 5, xdr: 0.7 },
        currencies: CURRENCIES,
        updatedAt: now,
        stale: false,
        fetchedAt: now,
        ...over,
    }
}

const flush = () => vi.advanceTimersByTimeAsync(0)

function deferred() {
    let resolve, reject
    const promise = new Promise((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
}

let stub
let warn

// Depoya yazilan ISIM-DEGER cagrilarindan yalniz `currency` anahtarini yazanlar.
const currencyWrites = () => chrome.storage.local.set.mock.calls.filter(([obj]) => CURRENCY_STORAGE_KEY in obj)

function setup(initial = {}, languages = ['en-US']) {
    stub = installChromeStub(initial)
    vi.spyOn(chrome.storage.local, 'set')
    vi.stubGlobal('navigator', { languages, language: languages[0] })
    return currencyStore()
}

beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    setActivePinia(createPinia())
    fetchRatesSnapshot.mockReset()
    fetchRatesSnapshot.mockImplementation(async () => snap())
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    delete globalThis.chrome
})

describe('init: secim', () => {
    it('kayit yok + navigator tr-TR -> try (varsayilan diske YAZILMAZ)', async () => {
        const store = setup({}, ['tr-TR', 'en'])
        await store.init()
        expect(store.code).toBe('try')
        expect(currencyWrites()).toHaveLength(0)
    })

    it('languages bos ise navigator.language kullanilir', async () => {
        const store = setup({}, [])
        vi.stubGlobal('navigator', { languages: [], language: 'de-DE' })
        await store.init()
        expect(store.code).toBe('eur')
    })

    it('init oncesi code "usd" (makinenin dili sizmaz)', () => {
        const store = setup({}, ['tr-TR'])
        expect(store.code).toBe('usd')
    })

    it.each([
        ['eur', 'eur'],
        ['EUR', 'eur'],
        ['TRY', 'try'], // Review Focus 2: buyuk harf kodu KORUNUR
        [' jpy ', 'jpy'],
    ])('kayitli %j -> %s', async (kayit, beklenen) => {
        const store = setup({ [CURRENCY_STORAGE_KEY]: kayit }, ['de-DE'])
        await store.init()
        expect(store.code).toBe(beklenen)
    })

    // Review Focus 2: bozuk ya da haric kayit "secim yok" sayilir -> varsayilan; depoya yazilmaz.
    it.each(['vef', 'xdr', 'usdt', '', 5, null, {}])('kayitli %j -> varsayilan (tr-TR: try), storage\'a yazilmaz', async (kayit) => {
        const store = setup({ [CURRENCY_STORAGE_KEY]: kayit }, ['tr-TR'])
        await store.init()
        expect(store.code).toBe('try')
        expect(currencyWrites()).toHaveLength(0)
    })

    it('depo okunamazsa varsayilana duser ve init ATMAZ', async () => {
        const store = setup({}, ['tr-TR'])
        chrome.storage.local.get = async () => { throw new Error('depo bozuk') }
        await expect(store.init()).resolves.toBeUndefined()
        expect(store.code).toBe('try')
    })

    // Gorev 1/3 ile tutarli: istemcide statik izinli liste yok, uyeligi resolveDisplay denetler.
    it('kayitli "XYZ" (soz diziminde gecerli, tabloda yok) varsayilana DUSMEZ: code "xyz", display USD + fellBack', async () => {
        const store = setup({
            [CURRENCY_STORAGE_KEY]: 'XYZ',
            fiat_rates: snap(), // taze: ag yok, kayitli gorunum yuklu
        }, ['tr-TR'])
        await store.init()
        expect(store.code).toBe('xyz')
        expect(store.display).toEqual({ code: 'usd', rate: 1, fellBack: true, requested: 'xyz' })
    })
})

describe('init: kur gorunumu ve zamanlayici', () => {
    it('kayitli kur gorunumu agi BEKLEMEDEN display\'e yansir', async () => {
        const bekleyen = deferred()
        fetchRatesSnapshot.mockReturnValue(bekleyen.promise)
        const eski = snap({ updatedAt: NOW - 11 * MIN, fetchedAt: NOW - 11 * MIN })
        const store = setup({ [CURRENCY_STORAGE_KEY]: 'try', fiat_rates: eski })

        await store.init() // ag istegi BASLAR ama beklenmez

        expect(fetchRatesSnapshot).toHaveBeenCalledTimes(1) // 11 dk: eski, yenileme gerekli
        expect(store.display).toEqual({ code: 'try', rate: 40, fellBack: false })
    })

    it('kayitli kur gorunumu 10 dk\'dan tazeyse ag istegi yapilmaz', async () => {
        const store = setup({ [CURRENCY_STORAGE_KEY]: 'eur', fiat_rates: snap({ fetchedAt: NOW - 5 * MIN }) })
        await store.init()
        await flush()
        expect(fetchRatesSnapshot).not.toHaveBeenCalled()
        expect(store.display.rate).toBe(0.9)
    })

    it('bozuk kayitli kur gorunumu yok sayilir (ag gider)', async () => {
        const store = setup({ [CURRENCY_STORAGE_KEY]: 'eur', fiat_rates: { rates: 'bozuk' } })
        await store.init()
        await flush()
        expect(fetchRatesSnapshot).toHaveBeenCalledTimes(1)
        expect(store.display).toEqual({ code: 'eur', rate: 0.9, fellBack: false })
    })

    it('ilk istek configStore().api ile gider ve sonuc diske yazilir', async () => {
        const store = setup({ [CURRENCY_STORAGE_KEY]: 'try' })
        await store.init()
        await flush()
        expect(fetchRatesSnapshot).toHaveBeenCalledWith({ api: configStore().api })
        expect(stub.localStore.fiat_rates.rates.try).toBe(40)
        expect(store.snapshot.rates.try).toBe(40)
    })

    // Review Focus 1: kur hic gelmediyse ekran kur simgesiyle yazmaz, USD etiketli yazar.
    it('ilk acilista kur gelmezse secili birim USD etiketli duser, init ATMAZ', async () => {
        fetchRatesSnapshot.mockRejectedValue(new Error('ag yok'))
        const store = setup({ [CURRENCY_STORAGE_KEY]: 'try' })
        await expect(store.init()).resolves.toBeUndefined()
        await flush()
        expect(store.display).toEqual({ code: 'usd', rate: 1, fellBack: true, requested: 'try' })
        expect(warn).toHaveBeenCalled()
    })

    it('init iki kez -> ayni sonuc, tek zamanlayici, tek ilk istek', async () => {
        const store = setup({ [CURRENCY_STORAGE_KEY]: 'try' })
        await Promise.all([store.init(), store.init()])
        await store.init()
        await flush()

        expect(fetchRatesSnapshot).toHaveBeenCalledTimes(1)
        expect(vi.getTimerCount()).toBe(1)
    })

    it('saat her dakika tikler', async () => {
        const store = setup({ [CURRENCY_STORAGE_KEY]: 'try' })
        await store.init()
        const ilk = store.clock
        await vi.advanceTimersByTimeAsync(60 * 1000)
        expect(store.clock).toBe(ilk + 60 * 1000)
    })
})

describe('init: acilista ara gorunum YOK (BD2)', () => {
    // Depo okumasini anahtara gore geciktirir: ayni anda iki okuma da ucta olabilsin.
    function gecikmeliDepo(bekleyenler) {
        const gercek = chrome.storage.local.get
        vi.spyOn(chrome.storage.local, 'get').mockImplementation(async (keys) => {
            const anahtar = Array.isArray(keys) ? keys[0] : keys
            await bekleyenler[anahtar]?.promise
            return gercek(keys)
        })
    }

    it('kod ve kur ayni anda ucta: kod, kur gelmeden ATANMAZ (ara "usd/fellBack" gorunumu yok)', async () => {
        const kurBekle = deferred()
        const store = setup({ [CURRENCY_STORAGE_KEY]: 'try', fiat_rates: snap() })
        gecikmeliDepo({ fiat_rates: kurBekle })

        const bitti = store.init()
        await flush() // kod okumasi bitti, kur okumasi SURUYOR

        expect(store.code).toBe('usd')
        expect(store.snapshot).toBeNull()

        kurBekle.resolve()
        await bitti
        expect(store.code).toBe('try')
        expect(store.display).toEqual({ code: 'try', rate: 40, fellBack: false })
    })

    it('display degeri gectigi her durum izlenir: kayitli try icin hicbir an fellBack:true olmaz', async () => {
        const store = setup({ [CURRENCY_STORAGE_KEY]: 'try', fiat_rates: snap() })
        const gorulen = []
        watch(() => store.display, (d) => gorulen.push({ ...d }), { flush: 'sync' })

        await store.init()

        expect(gorulen.length).toBeGreaterThan(0)
        expect(gorulen.some((d) => d.fellBack)).toBe(false)
        expect(gorulen.some((d) => d.code === 'try' && d.rate === 40)).toBe(true)
        // Son gorunum de dogrudan secili birim; arada "try + kur yok" yok.
        expect(gorulen[gorulen.length - 1]).toEqual({ code: 'try', rate: 40, fellBack: false })
    })

    it('init yalniz disk okumasini bekler: ag istegi suruyorken coktan cozulur', async () => {
        const ag = deferred()
        fetchRatesSnapshot.mockReturnValue(ag.promise)
        const store = setup({ [CURRENCY_STORAGE_KEY]: 'try', fiat_rates: snap({ updatedAt: NOW - 11 * MIN, fetchedAt: NOW - 11 * MIN }) })

        let cozuldu = false
        void store.init().then(() => { cozuldu = true })
        await flush()

        expect(fetchRatesSnapshot).toHaveBeenCalledTimes(1) // ag basladi
        expect(cozuldu).toBe(true) // ama init agi beklemedi
        expect(store.display).toEqual({ code: 'try', rate: 40, fellBack: false })
        ag.resolve(snap())
    })

    it('kayit yoksa varsayilan kod da kurla ayni adimda atanir', async () => {
        const kurBekle = deferred()
        const store = setup({ fiat_rates: snap() }, ['tr-TR'])
        gecikmeliDepo({ fiat_rates: kurBekle })

        const bitti = store.init()
        await flush()
        expect(store.code).toBe('usd')

        kurBekle.resolve()
        await bitti
        expect(store.display).toEqual({ code: 'try', rate: 40, fellBack: false })
    })
})

describe('select / adopt', () => {
    it('select("eur") storage.set({currency:"eur"}) yazar ve true doner (kur taze: ag yok)', async () => {
        const store = setup({}, ['tr-TR'])
        await store.init()
        await flush()
        fetchRatesSnapshot.mockClear()

        await expect(store.select('eur')).resolves.toBe(true)

        expect(store.code).toBe('eur')
        expect(chrome.storage.local.set).toHaveBeenCalledWith({ currency: 'eur' })
        expect(stub.localStore.currency).toBe('eur')
        // Kur taze (az once cekildi): select'in yenileme denetimi ag istegine donusmez.
        expect(fetchRatesSnapshot).not.toHaveBeenCalled()
    })

    it('select buyuk harfli kodu kucultup yazar', async () => {
        const store = setup({}, ['tr-TR'])
        await store.init()
        await store.select('EUR')
        expect(stub.localStore.currency).toBe('eur')
    })

    it('select("vef") / xdr / usdt / "" / 5 -> false, yazmaz, secimi degistirmez', async () => {
        const store = setup({ [CURRENCY_STORAGE_KEY]: 'eur' })
        await store.init()
        chrome.storage.local.set.mockClear()

        for (const gecersiz of ['vef', 'xdr', 'usdt', '', 5, null, undefined]) {
            await expect(store.select(gecersiz)).resolves.toBe(false)
        }
        expect(chrome.storage.local.set).not.toHaveBeenCalled()
        expect(store.code).toBe('eur')
    })

    it('select disk hatasinda secim oturum icin gecerli kalir ve uyari yazilir', async () => {
        const store = setup({})
        await store.init()
        chrome.storage.local.set.mockRejectedValue(new Error('kota'))
        warn.mockClear()

        await expect(store.select('eur')).resolves.toBe(true)
        expect(store.code).toBe('eur')
        expect(warn).toHaveBeenCalled()
    })

    it('adopt("eur") durumu degistirir, storage.set CAGRILMAZ', async () => {
        const store = setup({ [CURRENCY_STORAGE_KEY]: 'try' })
        await store.init()
        chrome.storage.local.set.mockClear()

        store.adopt('eur')

        expect(store.code).toBe('eur')
        expect(chrome.storage.local.set).not.toHaveBeenCalled()
    })

    it('adopt gecersiz degerde init ile ayni kurala uyar (varsayilan birim)', async () => {
        const store = setup({ [CURRENCY_STORAGE_KEY]: 'eur' }, ['tr-TR'])
        await store.init()
        store.adopt('vef')
        expect(store.code).toBe('try')
        store.adopt('GBP')
        expect(store.code).toBe('gbp')
        store.adopt(5)
        expect(store.code).toBe('try')
    })
})

describe('refreshRates', () => {
    it('10 dk icinde ikinci cagri ag\'a gitmez, force:true gider', async () => {
        const store = setup({ [CURRENCY_STORAGE_KEY]: 'try' })
        await store.init()
        await flush()
        expect(fetchRatesSnapshot).toHaveBeenCalledTimes(1)

        await vi.advanceTimersByTimeAsync(5 * MIN) // saat tikleri de taze kurda ag'a gitmez
        await store.refreshRates()
        expect(fetchRatesSnapshot).toHaveBeenCalledTimes(1)

        await store.refreshRates({ force: true })
        expect(fetchRatesSnapshot).toHaveBeenCalledTimes(2)
    })

    it('10 dk dolunca saat tiki kuru kendiliginden yeniler', async () => {
        const store = setup({ [CURRENCY_STORAGE_KEY]: 'try' })
        await store.init()
        await flush()
        await vi.advanceTimersByTimeAsync(10 * MIN)
        expect(fetchRatesSnapshot).toHaveBeenCalledTimes(2)
    })

    it('esZamanli iki cagri TEK istektir (force dahil)', async () => {
        const bekleyen = deferred()
        fetchRatesSnapshot.mockReturnValue(bekleyen.promise)
        const store = setup({ [CURRENCY_STORAGE_KEY]: 'try' })

        const a = store.refreshRates({ force: true })
        const b = store.refreshRates({ force: true })
        expect(fetchRatesSnapshot).toHaveBeenCalledTimes(1)

        bekleyen.resolve(snap())
        await Promise.all([a, b])
        expect(store.snapshot.rates.try).toBe(40)

        // Istek bitti: yeni zorla yenileme yeniden gidebilir.
        fetchRatesSnapshot.mockResolvedValue(snap())
        await store.refreshRates({ force: true })
        expect(fetchRatesSnapshot).toHaveBeenCalledTimes(2)
    })

    it('hata ATMAZ, uyari yazar, eldeki gorunum korunur; 24 saat sonra display USD\'ye duser', async () => {
        const store = setup({ [CURRENCY_STORAGE_KEY]: 'eur' })
        await store.init()
        await flush()
        expect(store.display).toEqual({ code: 'eur', rate: 0.9, fellBack: false })

        fetchRatesSnapshot.mockRejectedValue(new Error('ag yok'))
        warn.mockClear()
        await expect(store.refreshRates({ force: true })).resolves.toBeUndefined()
        expect(warn).toHaveBeenCalled()
        expect(store.snapshot.rates.eur).toBe(0.9)

        // 1 saat sonra: yenileme hala basarisiz ama kur 24 saatten genc -> kullanilir.
        await vi.advanceTimersByTimeAsync(1 * HOUR)
        expect(store.display).toEqual({ code: 'eur', rate: 0.9, fellBack: false })

        // Toplam 25 saat: kur eskidi -> USD, USD etiketli (Review Focus 1).
        await vi.advanceTimersByTimeAsync(24 * HOUR)
        expect(store.display.fellBack).toBe(true)
        expect(store.display).toEqual({ code: 'usd', rate: 1, fellBack: true, requested: 'eur' })
    })

    it('eldekinden ESKI kur zamanli tablo eldeki iyi kuru ezmez ve diske yazilmaz', async () => {
        const store = setup({ [CURRENCY_STORAGE_KEY]: 'try' })
        await store.init()
        await flush()
        expect(store.display).toEqual({ code: 'try', rate: 40, fellBack: false })
        stub.localStore.fiat_rates = { ...stub.localStore.fiat_rates, marker: 'ilk' }

        warn.mockClear()
        chrome.storage.local.set.mockClear()
        fetchRatesSnapshot.mockResolvedValue(snap({ rates: { try: 99 }, updatedAt: Date.now() - 3 * HOUR }))
        await expect(store.refreshRates({ force: true })).resolves.toBeUndefined()

        expect(store.snapshot.rates.try).toBe(40)
        expect(store.display).toEqual({ code: 'try', rate: 40, fellBack: false })
        expect(stub.localStore.fiat_rates.marker).toBe('ilk')
        expect(chrome.storage.local.set).not.toHaveBeenCalled()
        expect(warn).toHaveBeenCalled()
    })

    it('kur zamani bilinmeyen (updatedAt null) tablo eldeki iyi kuru ezmez', async () => {
        const store = setup({ [CURRENCY_STORAGE_KEY]: 'try' })
        await store.init()
        await flush()

        fetchRatesSnapshot.mockResolvedValue(snap({ rates: { try: 99 }, updatedAt: null, stale: true }))
        await store.refreshRates({ force: true })

        expect(store.snapshot.rates.try).toBe(40)
        expect(store.display).toEqual({ code: 'try', rate: 40, fellBack: false })
        // Secici de dolu kalir: kuru olan birimler listede.
        expect(store.list.map((c) => c.code.toLowerCase())).toContain('try')
    })

    it('ayni kur zamanli tablo benimsenir (fetchedAt tazelenir)', async () => {
        const store = setup({ [CURRENCY_STORAGE_KEY]: 'try' })
        await store.init()
        await flush()
        const updatedAt = store.snapshot.updatedAt

        // Saat tiklemeden ilerler (tik kendiliginden yenileme baslatirdi).
        vi.setSystemTime(NOW + 15 * MIN)
        fetchRatesSnapshot.mockResolvedValue(snap({ rates: { try: 41 }, updatedAt }))
        await store.refreshRates({ force: true })

        expect(store.snapshot.rates.try).toBe(41)
        expect(store.snapshot.fetchedAt).toBe(Date.now())
    })

    it('basarili yenileme eski gorunumun yerine gecer ve diske yazar', async () => {
        const store = setup({ [CURRENCY_STORAGE_KEY]: 'try' })
        await store.init()
        await flush()
        fetchRatesSnapshot.mockResolvedValue(snap({ rates: { try: 41 } }))
        await store.refreshRates({ force: true })
        expect(store.display.rate).toBe(41)
        expect(stub.localStore.fiat_rates.rates.try).toBe(41)
    })
})

describe('list', () => {
    it('vef/xdr ve kuru olmayan kodlar yok; usd her zaman var', async () => {
        const store = setup({ [CURRENCY_STORAGE_KEY]: 'try' })
        expect(store.list).toEqual([])
        await store.init()
        await flush()
        expect(store.list.map((c) => c.code)).toEqual(['USD', 'TRY', 'EUR'])
    })
})
