// Kur modulu: /getRates yanitini ayristirma, 10 dk onbellek / 24 saat siniri ve kalici
// goruntu. Saf mantik: ag ve depo test icinde sahte nesnelerle verilir.
import { describe, it, expect, vi } from 'vitest'
import {
    RATES_TTL_MS,
    RATES_MAX_AGE_MS,
    RATES_FETCH_TIMEOUT_MS,
    RATES_STORAGE_KEY,
    parseRatesResponse,
    fetchRatesSnapshot,
    isSnapshotFresh,
    shouldAdoptSnapshot,
    resolveDisplay,
    readStoredSnapshot,
    writeSnapshot,
} from './fiatRates'

const NOW = Date.parse('2026-11-03T12:00:00.000Z')
const MIN = 60 * 1000
const H = 60 * MIN

const API = 'https://api.example.test'

// Sunucunun /getRates govdesi bicimi (tokenController.getFiatRates).
function body(overrides = {}) {
    return {
        success: true,
        base: 'usd',
        rates: { usd: 1, try: 48.04, eur: 0.86 },
        currencies: [
            { code: 'usd', name: 'US Dollar', symbol: '$' },
            { code: 'try', name: 'Turkish Lira', symbol: '₺' },
            { code: 'eur', name: 'Euro', symbol: '€' },
        ],
        updatedAt: new Date(NOW - H).toISOString(),
        stale: false,
        ...overrides,
    }
}

// Hazir Snapshot (ms zaman damgalari).
function snap(overrides = {}) {
    return {
        rates: { usd: 1, try: 48.04, eur: 0.86 },
        currencies: [{ code: 'try', name: 'Turkish Lira', symbol: '₺' }],
        updatedAt: NOW - H,
        stale: false,
        fetchedAt: NOW,
        ...overrides,
    }
}

// chrome.storage.local benzeri bellek ici depo (get(key) -> { [key]: deger }).
function memoryStorage(initial = {}) {
    const data = { ...initial }
    return {
        data,
        get: vi.fn(async (key) => (key in data ? { [key]: data[key] } : {})),
        set: vi.fn(async (items) => { Object.assign(data, items) }),
    }
}

describe('sabitler', () => {
    it('brief degerleri', () => {
        expect(RATES_TTL_MS).toBe(600000)
        expect(RATES_MAX_AGE_MS).toBe(86400000)
        expect(RATES_FETCH_TIMEOUT_MS).toBe(8000)
        expect(RATES_STORAGE_KEY).toBe('fiat_rates')
    })
})

describe('parseRatesResponse', () => {
    it('gecerli govde: ms zaman damgasi, stale bool, fetchedAt = now; sayi olmayan ve <=0 oranlar atilir', () => {
        const result = parseRatesResponse(body({
            rates: { usd: 1, try: 48.04, eur: '0.86', gbp: 0, jpy: -150, cad: NaN, chf: Infinity, sek: null, nok: 10.5 },
            stale: true,
        }), NOW)
        expect(result).toEqual({
            rates: { usd: 1, try: 48.04, nok: 10.5 },
            currencies: [
                { code: 'usd', name: 'US Dollar', symbol: '$' },
                { code: 'try', name: 'Turkish Lira', symbol: '₺' },
                { code: 'eur', name: 'Euro', symbol: '€' },
            ],
            updatedAt: NOW - H,
            stale: true,
            fetchedAt: NOW,
        })
    })

    it('oran anahtarlari kucuk harfe indirilir; vef / xdr ve soz dizimi bozuk anahtarlar atilir', () => {
        const result = parseRatesResponse(body({
            rates: { usd: 1, TRY: 48.04, vef: 2, xdr: 0.7, usdt: 3, '': 4 },
        }), NOW)
        expect(result.rates).toEqual({ usd: 1, try: 48.04 })
    })

    it('currencies: code/name/symbol metin olmayan girdiler atilir, fazla alanlar kirpilir; dizi degilse bos', () => {
        const result = parseRatesResponse(body({
            currencies: [
                { code: 'try', name: 'Turkish Lira', symbol: '₺', extra: 1 },
                { code: 5, name: 'x', symbol: 'y' },
                { code: 'eur', name: null, symbol: '€' },
                { code: 'gbp', name: 'Pound', symbol: 7 },
                null,
                'usd',
            ],
        }), NOW)
        expect(result.currencies).toEqual([{ code: 'try', name: 'Turkish Lira', symbol: '₺' }])
        expect(parseRatesResponse(body({ currencies: 'x' }), NOW).currencies).toEqual([])
        expect(parseRatesResponse(body({ currencies: undefined }), NOW).currencies).toEqual([])
    })

    it('success:false, rates yok, base !== "usd" -> null', () => {
        expect(parseRatesResponse(body({ success: false }), NOW)).toBeNull()
        expect(parseRatesResponse(body({ success: undefined }), NOW)).toBeNull()
        expect(parseRatesResponse(body({ rates: undefined }), NOW)).toBeNull()
        expect(parseRatesResponse(body({ rates: null }), NOW)).toBeNull()
        expect(parseRatesResponse(body({ rates: [1, 2] }), NOW)).toBeNull()
        expect(parseRatesResponse(body({ rates: 'x' }), NOW)).toBeNull()
        expect(parseRatesResponse(body({ base: 'eur' }), NOW)).toBeNull()
        expect(parseRatesResponse(body({ base: undefined }), NOW)).toBeNull()
    })

    it('govde nesne degil -> null', () => {
        for (const v of [null, undefined, 'x', 5, [], true]) expect(parseRatesResponse(v, NOW)).toBeNull()
    })

    it('kullanilabilir tek oran kalmazsa null (bos tablo iyi bir onbellegi ezmesin)', () => {
        expect(parseRatesResponse(body({ rates: {} }), NOW)).toBeNull()
        expect(parseRatesResponse(body({ rates: { try: 'x', eur: 0, gbp: -1 } }), NOW)).toBeNull()
    })

    it("sunucunun 'kaynak yok' yaniti { usd: 1 } bos tablodur -> null (USD disinda oran sart)", () => {
        // server/utils/fx.js getRates son dal: { rates: { usd: 1 }, updatedAt: null, stale: true }.
        expect(parseRatesResponse(body({ rates: { usd: 1 }, updatedAt: null, stale: true }), NOW)).toBeNull()
        expect(parseRatesResponse(body({ rates: { usd: 1 } }), NOW)).toBeNull()
        expect(parseRatesResponse(body({ rates: { USD: 1 } }), NOW)).toBeNull()
        // USD yanindaki oranlar bozuksa da USD disinda kullanilabilir oran kalmaz.
        expect(parseRatesResponse(body({ rates: { usd: 1, try: 'x', eur: 0 } }), NOW)).toBeNull()
        // USD olmadan tek bir kullanilabilir oran yeter.
        expect(parseRatesResponse(body({ rates: { try: 48 } }), NOW)).not.toBeNull()
    })

    it('updatedAt yok / bozuk -> snapshot.updatedAt null (snapshot yine gecerli)', () => {
        for (const v of [undefined, null, '', 'bozuk', 12345, {}]) {
            const result = parseRatesResponse(body({ updatedAt: v }), NOW)
            expect(result).not.toBeNull()
            expect(result.updatedAt).toBeNull()
        }
    })

    it('stale yalnizca true ise true', () => {
        expect(parseRatesResponse(body({ stale: true }), NOW).stale).toBe(true)
        expect(parseRatesResponse(body({ stale: false }), NOW).stale).toBe(false)
        expect(parseRatesResponse(body({ stale: undefined }), NOW).stale).toBe(false)
        expect(parseRatesResponse(body({ stale: 'false' }), NOW).stale).toBe(false)
    })

    it('girdiyi degistirmez', () => {
        const input = body({ rates: { usd: 1, try: 48.04, gbp: 0 } })
        const copy = JSON.parse(JSON.stringify(input))
        parseRatesResponse(input, NOW)
        expect(input).toEqual(copy)
    })
})

describe('fetchRatesSnapshot', () => {
    it('POST api + /getRates, govde {}, timeout 8000; ayristirilmis snapshot doner', async () => {
        const http = { post: vi.fn(async () => ({ status: 200, data: body() })) }
        const result = await fetchRatesSnapshot({ api: API, http, now: () => NOW })
        expect(http.post).toHaveBeenCalledTimes(1)
        expect(http.post).toHaveBeenCalledWith(API + '/getRates', {}, { timeout: 8000 })
        expect(result.rates.try).toBe(48.04)
        expect(result.updatedAt).toBe(NOW - H)
        expect(result.fetchedAt).toBe(NOW)
    })

    it('ag hatasinda atar', async () => {
        const http = { post: vi.fn(async () => { throw new Error('ag yok') }) }
        await expect(fetchRatesSnapshot({ api: API, http, now: () => NOW })).rejects.toThrow('ag yok')
    })

    it('gecersiz yanitta atar (success:false, govde yok, bos tablo)', async () => {
        for (const data of [body({ success: false }), undefined, 'x', body({ rates: {} }), body({ rates: { usd: 1 }, updatedAt: null, stale: true })]) {
            const http = { post: vi.fn(async () => ({ status: 200, data })) }
            await expect(fetchRatesSnapshot({ api: API, http, now: () => NOW })).rejects.toThrow()
        }
        const noResponse = { post: vi.fn(async () => undefined) }
        await expect(fetchRatesSnapshot({ api: API, http: noResponse, now: () => NOW })).rejects.toThrow()
    })

    it('api adresi yoksa ag istegi ATMADAN atar', async () => {
        for (const api of [undefined, null, '', 5]) {
            const http = { post: vi.fn() }
            await expect(fetchRatesSnapshot({ api, http, now: () => NOW })).rejects.toThrow()
            expect(http.post).not.toHaveBeenCalled()
        }
    })

    it('fetchedAt yanit geldikten SONRA okunan saattir', async () => {
        let clock = NOW
        const http = { post: vi.fn(async () => { clock = NOW + 3000; return { data: body() } }) }
        const result = await fetchRatesSnapshot({ api: API, http, now: () => clock })
        expect(result.fetchedAt).toBe(NOW + 3000)
    })

    it('now verilmezse Date.now kullanilir', async () => {
        const http = { post: vi.fn(async () => ({ data: body() })) }
        const before = Date.now()
        const result = await fetchRatesSnapshot({ api: API, http })
        expect(result.fetchedAt).toBeGreaterThanOrEqual(before)
        expect(result.fetchedAt).toBeLessThanOrEqual(Date.now())
    })
})

describe('isSnapshotFresh', () => {
    it('9 dk 59 sn taze, 10 dk degil', () => {
        const s = snap({ fetchedAt: NOW - (10 * MIN - 1000) })
        expect(isSnapshotFresh(s, NOW)).toBe(true)
        expect(isSnapshotFresh(snap({ fetchedAt: NOW - 10 * MIN }), NOW)).toBe(false)
        expect(isSnapshotFresh(snap({ fetchedAt: NOW - 10 * MIN - 1 }), NOW)).toBe(false)
    })

    it('az once cekilen taze', () => {
        expect(isSnapshotFresh(snap({ fetchedAt: NOW }), NOW)).toBe(true)
    })

    it('snapshot null / fetchedAt bozuk -> taze degil', () => {
        expect(isSnapshotFresh(null, NOW)).toBe(false)
        expect(isSnapshotFresh(undefined, NOW)).toBe(false)
        expect(isSnapshotFresh(snap({ fetchedAt: undefined }), NOW)).toBe(false)
        expect(isSnapshotFresh(snap({ fetchedAt: NaN }), NOW)).toBe(false)
        expect(isSnapshotFresh(snap(), NaN)).toBe(false)
    })

    it('fetchedAt gelecekte (saat geri alindi) -> taze sayilmaz, yenilenir', () => {
        expect(isSnapshotFresh(snap({ fetchedAt: NOW + 1 }), NOW)).toBe(false)
        expect(isSnapshotFresh(snap({ fetchedAt: NOW + 24 * H }), NOW)).toBe(false)
    })
})

describe('shouldAdoptSnapshot', () => {
    it('eldeki yoksa zamani bilinen tablo benimsenir', () => {
        expect(shouldAdoptSnapshot(null, snap())).toBe(true)
        expect(shouldAdoptSnapshot(undefined, snap())).toBe(true)
    })

    it('daha yeni ve ayni kur zamani benimsenir (esit: fetchedAt tazelenir)', () => {
        expect(shouldAdoptSnapshot(snap({ updatedAt: NOW - 2 * H }), snap({ updatedAt: NOW - H }))).toBe(true)
        expect(shouldAdoptSnapshot(snap({ updatedAt: NOW - H }), snap({ updatedAt: NOW - H }))).toBe(true)
    })

    it('eldekinden ESKI kur zamani benimsenmez (sunucu yedegi geride kaldi)', () => {
        expect(shouldAdoptSnapshot(snap({ updatedAt: NOW - H }), snap({ updatedAt: NOW - 3 * H }))).toBe(false)
        expect(shouldAdoptSnapshot(snap({ updatedAt: NOW }), snap({ updatedAt: NOW - 1 }))).toBe(false)
    })

    it('kur zamani bilinmeyen (null / sayi degil) tablo benimsenmez', () => {
        expect(shouldAdoptSnapshot(snap(), snap({ updatedAt: null }))).toBe(false)
        expect(shouldAdoptSnapshot(null, snap({ updatedAt: null }))).toBe(false)
        expect(shouldAdoptSnapshot(snap(), snap({ updatedAt: NaN }))).toBe(false)
        expect(shouldAdoptSnapshot(snap(), null)).toBe(false)
    })

    it('eldekinin zamani bilinmiyorsa zamani bilinen tablo gecer', () => {
        expect(shouldAdoptSnapshot(snap({ updatedAt: null }), snap({ updatedAt: NOW - 30 * H }))).toBe(true)
    })
})

describe('resolveDisplay', () => {
    it('usd her zaman fellBack:false (snapshot null olsa da)', () => {
        expect(resolveDisplay('usd', null, NOW)).toEqual({ code: 'usd', rate: 1, fellBack: false })
        expect(resolveDisplay('usd', undefined, NOW)).toEqual({ code: 'usd', rate: 1, fellBack: false })
        expect(resolveDisplay('usd', snap({ updatedAt: NOW - 48 * H }), NOW)).toEqual({ code: 'usd', rate: 1, fellBack: false })
        expect(resolveDisplay('USD', null, NOW)).toEqual({ code: 'usd', rate: 1, fellBack: false })
    })

    it('taze kur', () => {
        expect(resolveDisplay('try', snap({ updatedAt: NOW - H }), NOW)).toEqual({ code: 'try', rate: 48.04, fellBack: false })
    })

    it('buyuk harfli kod kucuk harfe indirilir', () => {
        expect(resolveDisplay('TRY', snap(), NOW)).toEqual({ code: 'try', rate: 48.04, fellBack: false })
    })

    it('stale:true ama 23 saat -> kullanilir', () => {
        expect(resolveDisplay('try', snap({ stale: true, updatedAt: NOW - 23 * H }), NOW))
            .toEqual({ code: 'try', rate: 48.04, fellBack: false })
    })

    it('tam 24 saat kullanilir, 24 saat + 1 ms duser', () => {
        expect(resolveDisplay('try', snap({ updatedAt: NOW - RATES_MAX_AGE_MS }), NOW))
            .toEqual({ code: 'try', rate: 48.04, fellBack: false })
        expect(resolveDisplay('try', snap({ updatedAt: NOW - RATES_MAX_AGE_MS - 1 }), NOW))
            .toEqual({ code: 'usd', rate: 1, fellBack: true, requested: 'try' })
    })

    it('25 saat -> { code:"usd", rate:1, fellBack:true, requested:"try" }', () => {
        expect(resolveDisplay('try', snap({ updatedAt: NOW - 25 * H }), NOW))
            .toEqual({ code: 'usd', rate: 1, fellBack: true, requested: 'try' })
    })

    it('stale:false ama 25 saatlik kur da duser (bayrak degil yas belirler)', () => {
        expect(resolveDisplay('try', snap({ stale: false, updatedAt: NOW - 25 * H }), NOW).fellBack).toBe(true)
    })

    it('updatedAt null (yas kanitlanamaz) -> duser', () => {
        expect(resolveDisplay('try', snap({ updatedAt: null }), NOW))
            .toEqual({ code: 'usd', rate: 1, fellBack: true, requested: 'try' })
        expect(resolveDisplay('try', snap({ updatedAt: NaN }), NOW).fellBack).toBe(true)
    })

    it('gelecekteki updatedAt (saat kaymasi) -> kullanilir', () => {
        expect(resolveDisplay('try', snap({ updatedAt: NOW + 2 * H }), NOW))
            .toEqual({ code: 'try', rate: 48.04, fellBack: false })
    })

    it('kodu tabloda yok / snapshot null -> duser', () => {
        expect(resolveDisplay('gbp', snap(), NOW)).toEqual({ code: 'usd', rate: 1, fellBack: true, requested: 'gbp' })
        expect(resolveDisplay('try', null, NOW)).toEqual({ code: 'usd', rate: 1, fellBack: true, requested: 'try' })
        expect(resolveDisplay('try', undefined, NOW)).toEqual({ code: 'usd', rate: 1, fellBack: true, requested: 'try' })
        expect(resolveDisplay('try', {}, NOW)).toEqual({ code: 'usd', rate: 1, fellBack: true, requested: 'try' })
    })

    it('soz diziminde gecerli ama tabloda olmayan kod ("xyz") -> USD etiketli dusme, requested "xyz"', () => {
        expect(resolveDisplay('xyz', snap(), NOW)).toEqual({ code: 'usd', rate: 1, fellBack: true, requested: 'xyz' })
        expect(resolveDisplay('XYZ', snap(), NOW)).toEqual({ code: 'usd', rate: 1, fellBack: true, requested: 'xyz' })
    })

    it('tabloda kullanilamaz kur (0, negatif, NaN, dize) -> duser', () => {
        for (const bad of [0, -1, NaN, Infinity, '48']) {
            expect(resolveDisplay('try', snap({ rates: { usd: 1, try: bad } }), NOW).fellBack).toBe(true)
        }
    })

    it('vef / xdr ve bozuk kodlar tabloda olsa da secim sayilmaz -> USD etiketli', () => {
        const table = snap({ rates: { usd: 1, vef: 5, xdr: 0.7 } })
        expect(resolveDisplay('vef', table, NOW)).toEqual({ code: 'usd', rate: 1, fellBack: true, requested: 'vef' })
        expect(resolveDisplay('xdr', table, NOW).fellBack).toBe(true)
        for (const bad of ['usdt', '', 5, null, undefined]) {
            const result = resolveDisplay(bad, snap(), NOW)
            expect(result).toMatchObject({ code: 'usd', rate: 1, fellBack: true })
        }
    })

    it('prototip anahtarlari kur sayilmaz', () => {
        expect(resolveDisplay('try', snap({ rates: Object.create({ try: 48 }) }), NOW).fellBack).toBe(true)
    })

    it('her cagrida now ile yas hesaplar: ayni snapshot, ileri bir saat -> duser', () => {
        const s = snap({ updatedAt: NOW })
        expect(resolveDisplay('try', s, NOW + 23 * H).fellBack).toBe(false)
        expect(resolveDisplay('try', s, NOW + 25 * H).fellBack).toBe(true)
    })

    it('now sayi degilse duser (yas hesaplanamaz)', () => {
        expect(resolveDisplay('try', snap(), NaN).fellBack).toBe(true)
        expect(resolveDisplay('try', snap(), undefined).fellBack).toBe(true)
    })

    it('snapshot degistirilmez', () => {
        const s = snap()
        const copy = JSON.parse(JSON.stringify(s))
        resolveDisplay('try', s, NOW)
        resolveDisplay('xyz', s, NOW)
        expect(s).toEqual(copy)
    })
})

describe('readStoredSnapshot / writeSnapshot', () => {
    it('writeSnapshot -> read gidis-donus, anahtar "fiat_rates"', async () => {
        const storage = memoryStorage()
        const s = snap()
        await writeSnapshot(storage, s)
        expect(storage.set).toHaveBeenCalledWith({ fiat_rates: s })
        expect(Object.keys(storage.data)).toEqual(['fiat_rates'])
        expect(await readStoredSnapshot(storage)).toEqual(s)
        expect(storage.get).toHaveBeenCalledWith('fiat_rates')
    })

    it('updatedAt null olan snapshot da gidip gelir', async () => {
        const storage = memoryStorage()
        const s = snap({ updatedAt: null, stale: true })
        await writeSnapshot(storage, s)
        expect(await readStoredSnapshot(storage)).toEqual(s)
    })

    it('kayit yoksa null', async () => {
        expect(await readStoredSnapshot(memoryStorage())).toBeNull()
    })

    it("diskteki { usd: 1 } tablosu (eski surumun yazdigi) bos sayilir -> null", async () => {
        expect(await readStoredSnapshot(memoryStorage({ fiat_rates: snap({ rates: { usd: 1 } }) }))).toBeNull()
        expect(await readStoredSnapshot(memoryStorage({ fiat_rates: snap({ rates: { usd: 1, try: 'x' } }) }))).toBeNull()
    })

    it('bozuk icerik ({}, "x", rates nesne degil) -> null', async () => {
        const broken = [
            {}, 'x', 5, null, [],
            { ...snap(), rates: 'x' },
            { ...snap(), rates: [1] },
            { ...snap(), rates: null },
            { ...snap(), rates: { try: 'x' } },
            { ...snap(), fetchedAt: undefined },
            { ...snap(), fetchedAt: 'dun' },
            { ...snap(), updatedAt: 'dun' },
        ]
        for (const value of broken) {
            expect(await readStoredSnapshot(memoryStorage({ fiat_rates: value }))).toBeNull()
        }
    })

    it('okurken bozuk oranlar ve currencies girdileri ayiklanir', async () => {
        const storage = memoryStorage({
            fiat_rates: {
                ...snap(),
                rates: { usd: 1, try: 48.04, eur: 0, gbp: 'x' },
                currencies: [{ code: 'try', name: 'Turkish Lira', symbol: '₺' }, { code: 1 }],
            },
        })
        const result = await readStoredSnapshot(storage)
        expect(result.rates).toEqual({ usd: 1, try: 48.04 })
        expect(result.currencies).toEqual([{ code: 'try', name: 'Turkish Lira', symbol: '₺' }])
    })

    it('depo hatasi yutulur: okuma null, yazma atmaz', async () => {
        const failing = {
            get: vi.fn(async () => { throw new Error('depo bozuk') }),
            set: vi.fn(async () => { throw new Error('kota dolu') }),
        }
        expect(await readStoredSnapshot(failing)).toBeNull()
        await expect(writeSnapshot(failing, snap())).resolves.toBeUndefined()
        expect(await readStoredSnapshot(undefined)).toBeNull()
        await expect(writeSnapshot(undefined, snap())).resolves.toBeUndefined()
    })

    it('gecersiz snapshot yazilmaz (iyi kaydi ezmesin)', async () => {
        const storage = memoryStorage({ fiat_rates: snap() })
        await writeSnapshot(storage, null)
        await writeSnapshot(storage, undefined)
        await writeSnapshot(storage, 'x')
        expect(storage.set).not.toHaveBeenCalled()
        expect(await readStoredSnapshot(storage)).toEqual(snap())
    })

    it('parse -> write -> read -> resolveDisplay uctan uca', async () => {
        const storage = memoryStorage()
        const parsed = parseRatesResponse(body(), NOW)
        await writeSnapshot(storage, parsed)
        const restored = await readStoredSnapshot(storage)
        expect(restored).toEqual(parsed)
        expect(resolveDisplay('try', restored, NOW)).toEqual({ code: 'try', rate: 48.04, fellBack: false })
    })
})
