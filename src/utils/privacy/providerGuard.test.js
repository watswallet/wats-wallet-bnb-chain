import { describe, it, expect, vi, afterEach } from 'vitest'
import {
    createProviderGuard, parseProviderStatus, providerInfoOf, providerGuard, PROVIDER_STATUS_URL, STATUS_TIMEOUT_MS, STATUS_OK_TTL_MS,
    STATUS_FAIL_TTL_MS, QUOTE_WINDOW_MS, QUOTE_WINDOW_MAX,
} from './providerGuard'
import { MIN_PAYOUT_USDC } from './silentswapConfig'

// api.silentswap.com GET /dest-assets, 2026-10-15 canli yaniti (adres tasimaz).
const CANLI = { enabled: true, maintenanceMode: false, directEvmPayoutEnabled: false, minUsdcInRaw: '10000000', limits: { minUsdc: 12, maxUsdc: 20010 }, feeBps: 100 }
const tamam = (body) => ({ ok: true, status: 200, json: async () => body })
const T0 = 1_000_000

// Sahte saat ve sahte fetch: gercek ag ve gercek zamanlayici yok.
function kur(yanit, { minPayoutUsdc } = {}) {
    let t = T0
    const fetchImpl = vi.fn(async (...args) => yanit(...args))
    const guard = createProviderGuard({ fetchImpl, now: () => t, ...(minPayoutUsdc ? { minPayoutUsdc } : {}) })
    return { guard, fetchImpl, ileri: (ms) => { t += ms } }
}
const neden = async (promise) => {
    try { await promise } catch (e) { return { kod: e.message, limitUsdc: e.limitUsdc, reason: e.reason } }
    return null
}

afterEach(() => vi.unstubAllGlobals())

describe('parseProviderStatus', () => {
    it('canli yanit: alanlar okunur, minUsdcInRaw OKUNMAZ (olculen en az 12, ham deger 10)', () => {
        expect(parseProviderStatus(CANLI)).toEqual({ enabled: true, maintenanceMode: false, directEvmPayoutEnabled: false, minUsdc: 12, maxUsdc: 20010, feeBps: 100 })
    })

    it('govde nesne degilse null', () => {
        for (const v of [undefined, null, 'x', 5, true, [], [CANLI]]) expect(parseProviderStatus(v), String(v)).toBeNull()
    })

    it('alan tipi bozuksa yalniz O alan null olur, oteki alanlar okunur', () => {
        const r = parseProviderStatus({ enabled: 'false', maintenanceMode: true, directEvmPayoutEnabled: 1, limits: { minUsdc: '12', maxUsdc: -5 } })
        expect(r).toEqual({ enabled: null, maintenanceMode: true, directEvmPayoutEnabled: null, minUsdc: null, maxUsdc: null, feeBps: null })
        expect(parseProviderStatus({ limits: { minUsdc: 0, maxUsdc: NaN } })).toMatchObject({ minUsdc: null, maxUsdc: null })
        // 1e12 ve ustu okunamaz sayilir (ustel gosterim parseUnits'i patlatir; assertAllowed testi bunun sonucunu sinar).
        expect(parseProviderStatus({ limits: { minUsdc: 1e21, maxUsdc: 1e12 } })).toMatchObject({ minUsdc: null, maxUsdc: null })
        expect(parseProviderStatus({ limits: null })).toMatchObject({ minUsdc: null, maxUsdc: null })
        expect(parseProviderStatus({})).toEqual({ enabled: null, maintenanceMode: null, directEvmPayoutEnabled: null, minUsdc: null, maxUsdc: null, feeBps: null })
    })

    // feeBps (T2, sT7): tamsayi ve 0 < v <= 10000; aksi null (ekran "—" der, sabit yedek YOK).
    it('feeBps: gecerli tamsayi okunur', () => {
        expect(parseProviderStatus({ limits: { minUsdc: 12, maxUsdc: 20010 }, feeBps: 100 })).toMatchObject({ feeBps: 100 })
        expect(parseProviderStatus({ feeBps: 1 })).toMatchObject({ feeBps: 1 })
        expect(parseProviderStatus({ feeBps: 10000 })).toMatchObject({ feeBps: 10000 })
    })

    it('feeBps: 0, negatif, kesirli, 10000 ustu, dizge, NaN, null ve eksik alan null', () => {
        for (const v of [0, -1, 1.5, 10001, '100', NaN, Infinity, null, true, {}]) expect(parseProviderStatus({ feeBps: v }).feeBps, String(v)).toBeNull()
        expect(parseProviderStatus({ limits: { minUsdc: 12 } }).feeBps).toBeNull()
    })
})

describe('providerInfoOf', () => {
    it('durum okunamadiysa (null) hepsi null, musait sayilir', () => {
        expect(providerInfoOf(null)).toEqual({ feeBps: null, minUsdc: null, maxUsdc: null, available: true })
    })

    it('enabled:false ya da maintenanceMode:true -> available:false', () => {
        expect(providerInfoOf(parseProviderStatus({ enabled: false })).available).toBe(false)
        expect(providerInfoOf(parseProviderStatus({ maintenanceMode: true })).available).toBe(false)
    })

    it('acik saglayici: yalniz sayilar ve bayrak', () => {
        const info = providerInfoOf(parseProviderStatus({ enabled: true, maintenanceMode: false, feeBps: 100, limits: { minUsdc: 15, maxUsdc: 5000 } }))
        expect(info).toEqual({ feeBps: 100, minUsdc: 15, maxUsdc: 5000, available: true })
        expect(Object.keys(info).sort()).toEqual(['available', 'feeBps', 'maxUsdc', 'minUsdc'])
    })
})

describe('providerGuard.info', () => {
    it('status() onbellegini kullanir: iki cagri tek fetch', async () => {
        const { guard, fetchImpl } = kur(() => tamam(CANLI))
        expect(await guard.info()).toEqual({ feeBps: 100, minUsdc: 12, maxUsdc: 20010, available: true })
        expect(await guard.info()).toEqual({ feeBps: 100, minUsdc: 12, maxUsdc: 20010, available: true })
        expect(fetchImpl).toHaveBeenCalledTimes(1)
    })

    it('okunamazsa hepsi null, musait', async () => {
        const { guard } = kur(async () => { throw new Error('ag') })
        expect(await guard.info()).toEqual({ feeBps: null, minUsdc: null, maxUsdc: null, available: true })
    })
})

describe('providerGuard.status: istek, onbellek ve birlesme', () => {
    it('sabit adrese GET atar: 8 sn gercek AbortSignal, cerez yok, HTTP onbellegi yok', async () => {
        const { guard, fetchImpl } = kur(() => tamam(CANLI))
        await guard.status()
        const [url, init] = fetchImpl.mock.calls[0]
        expect(url).toBe(PROVIDER_STATUS_URL)
        expect(url).toBe('https://api.silentswap.com/dest-assets')
        expect(init).toMatchObject({ method: 'GET', credentials: 'omit', cache: 'no-store' })
        expect(init.signal).toBeInstanceOf(AbortSignal)
        expect(STATUS_TIMEOUT_MS).toBe(8000)
    })

    it('basari 60 sn onbelleklenir: 59.999 sn icinde istek yok, 60 sn sonra yenilenir', async () => {
        const { guard, fetchImpl, ileri } = kur(() => tamam(CANLI))
        await guard.status()
        ileri(STATUS_OK_TTL_MS - 1)
        await guard.status()
        expect(fetchImpl).toHaveBeenCalledTimes(1)
        ileri(1)
        await guard.status()
        expect(fetchImpl).toHaveBeenCalledTimes(2)
    })

    it('basarisizlik (ag hatasi) 15 sn onbelleklenir ve null doner', async () => {
        const { guard, fetchImpl, ileri } = kur(() => { throw new TypeError('fetch failed') })
        expect(await guard.status()).toBeNull()
        ileri(STATUS_FAIL_TTL_MS - 1)
        expect(await guard.status()).toBeNull()
        expect(fetchImpl).toHaveBeenCalledTimes(1)
        ileri(1)
        await guard.status()
        expect(fetchImpl).toHaveBeenCalledTimes(2)
    })

    it('HTTP hata, JSON olmayan govde ve bos govde okunamaz sayilir (null)', async () => {
        for (const yanit of [
            () => ({ ok: false, status: 503, json: async () => CANLI }),
            () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('json degil') } }),
            () => tamam(null),
            () => tamam('metin'),
            () => undefined,
        ]) {
            const { guard } = kur(yanit)
            expect(await guard.status()).toBeNull()
        }
    })

    it('es zamanli okumalar tek istekte birlesir', async () => {
        const { guard, fetchImpl } = kur(() => tamam(CANLI))
        const sonuc = await Promise.all([guard.status(), guard.status(), guard.status()])
        expect(fetchImpl).toHaveBeenCalledTimes(1)
        expect(sonuc.every((s) => s.minUsdc === 12)).toBe(true)
    })

    it('saat geri alinirsa (negatif yas) onbellek gecersizdir: yeniden okunur', async () => {
        const { guard, fetchImpl, ileri } = kur(() => tamam(CANLI))
        await guard.status()
        ileri(-1000)
        await guard.status()
        expect(fetchImpl).toHaveBeenCalledTimes(2)
    })

    it('reset onbellegi ve pencereyi temizler', async () => {
        const { guard, fetchImpl } = kur(() => tamam(CANLI))
        await guard.status()
        guard.reset()
        await guard.status()
        expect(fetchImpl).toHaveBeenCalledTimes(2)
    })

    // Varsayilan fetch cagri aninda globalThis.fetch'e baglanir (providerFetch sarmalayicisi sonradan kurulabilir).
    it('varsayilan fetch globalThis.fetch e CAGRI ANINDA baglanir', async () => {
        const sahte = vi.fn(async () => tamam(CANLI))
        const guard = createProviderGuard()
        vi.stubGlobal('fetch', sahte)
        await guard.status()
        expect(sahte).toHaveBeenCalledTimes(1)
    })
})

describe('providerGuard.assertAllowed: durum ve tutar siniri', () => {
    it('enabled === false ya da maintenanceMode PRIVATE_PROVIDER_DOWN', async () => {
        for (const govde of [{ ...CANLI, enabled: false }, { ...CANLI, maintenanceMode: true }]) {
            const { guard } = kur(() => tamam(govde))
            expect((await neden(guard.assertAllowed({ payoutUsdc: '15' }))).kod).toBe('PRIVATE_PROVIDER_DOWN')
        }
    })

    it('etkin en az = max(sunucu, 12): sinirin ALTI PRIVATE_MIN_AMOUNT ve limitUsdc tasir', async () => {
        const { guard } = kur(() => tamam(CANLI))
        expect(await neden(guard.assertAllowed({ payoutUsdc: '11.999999999999999999' }))).toEqual({ kod: 'PRIVATE_MIN_AMOUNT', limitUsdc: '12', reason: undefined })
        expect(await neden(guard.assertAllowed({ payoutUsdc: '12' }))).toBeNull()
        expect(await neden(guard.assertAllowed({ payoutUsdc: '12.000000000000000001' }))).toBeNull()
    })

    it('sunucu en az degeri yalniz YUKSELTME yonunde izlenir', async () => {
        const yuksek = kur(() => tamam({ ...CANLI, limits: { minUsdc: 15, maxUsdc: 20010 } }))
        expect(await neden(yuksek.guard.assertAllowed({ payoutUsdc: '14.99' }))).toMatchObject({ kod: 'PRIVATE_MIN_AMOUNT', limitUsdc: '15' })
        expect(await neden(yuksek.guard.assertAllowed({ payoutUsdc: '15' }))).toBeNull()
        const dusuk = kur(() => tamam({ ...CANLI, limits: { minUsdc: 5, maxUsdc: 20010 } }))
        expect(await neden(dusuk.guard.assertAllowed({ payoutUsdc: '11' }))).toMatchObject({ kod: 'PRIVATE_MIN_AMOUNT', limitUsdc: '12' })
        const ondalik = kur(() => tamam({ ...CANLI, limits: { minUsdc: 12.5, maxUsdc: 20010 } }))
        expect(await neden(ondalik.guard.assertAllowed({ payoutUsdc: '12.4' }))).toMatchObject({ kod: 'PRIVATE_MIN_AMOUNT', limitUsdc: '12.5' })
        // Ustel gosterim tuzagi: String(1e21) = '1e+21' parseUnits'i patlatir ve yerlesik 12 tabani sessizce atlanirdi. 1e12 ve ustu
        // okunamaz sayilir: yerlesik taban HER ZAMAN uygulanir; okunamayan ust sinir engel koymaz.
        const ustel = kur(() => tamam({ ...CANLI, limits: { minUsdc: 1e21, maxUsdc: 20010 } }))
        expect(await neden(ustel.guard.assertAllowed({ payoutUsdc: '11' }))).toMatchObject({ kod: 'PRIVATE_MIN_AMOUNT', limitUsdc: '12' })
        const ustelUst = kur(() => tamam({ ...CANLI, limits: { minUsdc: 5, maxUsdc: 1e21 } }))
        expect(await neden(ustelUst.guard.assertAllowed({ payoutUsdc: '1000000' }))).toBeNull()
    })

    it('ust sinir sunucu degeridir: ustu PRIVATE_MAX_AMOUNT ve limitUsdc tasir', async () => {
        const { guard } = kur(() => tamam(CANLI))
        expect(await neden(guard.assertAllowed({ payoutUsdc: '20010' }))).toBeNull()
        expect(await neden(guard.assertAllowed({ payoutUsdc: '20010.000000000000000001' }))).toEqual({ kod: 'PRIVATE_MAX_AMOUNT', limitUsdc: '20010', reason: undefined })
    })

    it('minUsdcInRaw okunmaz: 10 USDC hala yerlesik 12 altidir, ham deger siniri yukseltmez', async () => {
        const dusuk = kur(() => tamam({ ...CANLI, minUsdcInRaw: '10000000' }))
        expect(await neden(dusuk.guard.assertAllowed({ payoutUsdc: '10' }))).toMatchObject({ kod: 'PRIVATE_MIN_AMOUNT', limitUsdc: '12' })
        const yuksek = kur(() => tamam({ ...CANLI, minUsdcInRaw: '99000000000000000000' }))
        expect(await neden(yuksek.guard.assertAllowed({ payoutUsdc: '12' }))).toBeNull()
    })

    // Okunamazsa ENGEL KONMAZ: yerlesik 12 gecerli, ust sinir yok, teklif istegi hakem olur.
    it('durum okunamazsa engel yok: yalniz yerlesik en az 12 gecerli, ust sinir yok', async () => {
        const { guard } = kur(() => { throw new TypeError('fetch failed') })
        expect(await neden(guard.assertAllowed({ payoutUsdc: '12' }))).toBeNull()
        expect(await neden(guard.assertAllowed({ payoutUsdc: '1000000' }))).toBeNull()
        expect(await neden(guard.assertAllowed({ payoutUsdc: '11' }))).toMatchObject({ kod: 'PRIVATE_MIN_AMOUNT', limitUsdc: String(MIN_PAYOUT_USDC) })
    })

    it('kanonik olmayan tutar PRIVATE_UNSUPPORTED ve ag istegi YOK', async () => {
        const { guard, fetchImpl } = kur(() => tamam(CANLI))
        for (const v of [undefined, null, '', 'abc', '1e3', '-5', '10.', '.5', ' 25', '10.1234567890123456789', {}]) {
            expect(await neden(guard.assertAllowed({ payoutUsdc: v })), String(v)).toEqual({ kod: 'PRIVATE_UNSUPPORTED', limitUsdc: undefined, reason: 'request.payout' })
        }
        expect(fetchImpl).not.toHaveBeenCalled()
    })

    it('sayi olarak verilen kanonik tutar da kabul edilir (String(12) = "12")', async () => {
        const { guard } = kur(() => tamam(CANLI))
        expect(await neden(guard.assertAllowed({ payoutUsdc: 12 }))).toBeNull()
    })
})

describe('providerGuard.takeQuoteSlot: kayan 60 sn penceresinde en cok 15 teklif', () => {
    it('16. teklif SDK cagrilmadan PRIVATE_RATE_LIMITED', () => {
        const { guard } = kur(() => tamam(CANLI))
        for (let i = 0; i < QUOTE_WINDOW_MAX; i++) guard.takeQuoteSlot()
        expect(() => guard.takeQuoteSlot()).toThrow('PRIVATE_RATE_LIMITED')
    })

    it('pencere kayar: en eski kayit 60 sn dolunca bir yer acilir (tam 60 sn pencerenin DISINDADIR)', () => {
        const { guard, ileri } = kur(() => tamam(CANLI))
        guard.takeQuoteSlot()
        ileri(30_000)
        for (let i = 0; i < QUOTE_WINDOW_MAX - 1; i++) guard.takeQuoteSlot()
        ileri(QUOTE_WINDOW_MS - 30_000 - 1)
        expect(() => guard.takeQuoteSlot()).toThrow('PRIVATE_RATE_LIMITED')
        ileri(1)
        expect(() => guard.takeQuoteSlot()).not.toThrow()
        expect(() => guard.takeQuoteSlot()).toThrow('PRIVATE_RATE_LIMITED')
    })

    it('reddedilen deneme pencereye yazilmaz: 60 sn sonra tam bir yer acilir', () => {
        const { guard, ileri } = kur(() => tamam(CANLI))
        for (let i = 0; i < QUOTE_WINDOW_MAX; i++) guard.takeQuoteSlot()
        for (let i = 0; i < 5; i++) expect(() => guard.takeQuoteSlot()).toThrow('PRIVATE_RATE_LIMITED')
        ileri(QUOTE_WINDOW_MS)
        for (let i = 0; i < QUOTE_WINDOW_MAX; i++) expect(() => guard.takeQuoteSlot()).not.toThrow()
        expect(() => guard.takeQuoteSlot()).toThrow('PRIVATE_RATE_LIMITED')
    })
})

describe('sabitler ve varsayilan ornek', () => {
    it('yerel pencere sunucu sinirinin (20 / 60 sn) altinda pay birakir; sureler spec 4.2 ile ayni', () => {
        expect(QUOTE_WINDOW_MAX).toBe(15)
        expect(QUOTE_WINDOW_MAX).toBeLessThan(20)
        expect(QUOTE_WINDOW_MS).toBe(60_000)
        expect([STATUS_OK_TTL_MS, STATUS_FAIL_TTL_MS, STATUS_TIMEOUT_MS]).toEqual([60_000, 15_000, 8000])
    })

    it('varsayilan ornek ayni arayuzu tasir', () => {
        expect(Object.keys(providerGuard).sort()).toEqual(['assertAllowed', 'info', 'reset', 'status', 'takeQuoteSlot'])
    })
})
