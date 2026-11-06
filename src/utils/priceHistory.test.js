import { describe, it, expect, beforeEach, vi } from 'vitest'
import axios from 'axios'
import { toChartPoints, fetchPriceHistory, fetchPriceSeries, chartTooltipLabel } from './priceHistory'

vi.mock('axios', () => ({ default: { post: vi.fn() } }))

const API = 'https://api.test'

beforeEach(() => { axios.post.mockReset() })

describe('toChartPoints', () => {
    it('[ms, fiyat] ciftlerini grafik noktalarina cevirir', () => {
        const points = toChartPoints([[1700000000000, 1.5], [1700086400000, 1.75]])
        expect(points).toHaveLength(2)
        expect(points[0].close).toBe(1.5)
        expect(typeof points[0].date).toBe('string')
    })

    // Asil hata: saglayici bos/bozuk govde dondugunde map() TypeError firlatiyor,
    // onMounted'daki yakalanmayan promise reddi grafik alanini BOS canvas birakiyordu.
    it('bozuk govdede bos dizi doner, firlatmaz', () => {
        expect(toChartPoints(null)).toEqual([])
        expect(toChartPoints(undefined)).toEqual([])
        expect(toChartPoints('nope')).toEqual([])
        expect(toChartPoints([{ close: 1 }])).toEqual([])
    })

    it('sayisal olmayan noktalari atar', () => {
        expect(toChartPoints([[1, 1], ['x', 2], [3, null], [4, 4]]).map(p => p.close)).toEqual([1, 4])
    })

    // Tarih etiketi UYGULAMA DILINE gore yazilir (sistem diline degil): `locale` EN SONA
    // eklenen istege bagli parametredir.
    it("tarih etiketi verilen dilin bicimindedir ('de' -> gun.ay.yil)", () => {
        const ms = 1700000000000
        const [nokta] = toChartPoints([[ms, 1]], 'de')
        expect(nokta.date).toBe(new Date(ms).toLocaleDateString('de'))
        expect(nokta.date).toMatch(/^\d{1,2}\.\d{1,2}\.\d{4}$/)
        // Ayni an en-US'te farkli yazilir: parametre gercekten bicime giriyor.
        expect(nokta.date).not.toBe(new Date(ms).toLocaleDateString('en-US'))
    })

    it('locale verilmezse eski davranis: sistem dili (toLocaleDateString())', () => {
        const ms = 1700000000000
        expect(toChartPoints([[ms, 1]])[0].date).toBe(new Date(ms).toLocaleDateString())
    })
})

describe('fetchPriceHistory', () => {
    it('sunucudaki fiyat gecmisi ucuna coingecko kimligiyle gider', async () => {
        axios.post.mockResolvedValue({ status: 200, data: { success: true, prices: [[1, 2]] } })

        const points = await fetchPriceHistory(API, 'bitcoin')

        expect(axios.post).toHaveBeenCalledWith(
            API + '/getTokenPriceHistory',
            expect.objectContaining({ id: 'bitcoin' }),
            expect.anything()
        )
        expect(points).toHaveLength(1)
    })

    // Ice aktarilan uzun kuyruk tokenlerin coingecko kimligi olmayabiliyor:
    // bu durumda ag istegi HIC yapilmamali.
    it('kimlik yoksa istek atmaz', async () => {
        expect(await fetchPriceHistory(API, null)).toEqual([])
        expect(await fetchPriceHistory(API, '')).toEqual([])
        expect(await fetchPriceHistory('', 'bitcoin')).toEqual([])
        expect(axios.post).not.toHaveBeenCalled()
    })

    it('ag hatasinda bos dizi doner', async () => {
        axios.post.mockRejectedValue(new Error('network down'))
        expect(await fetchPriceHistory(API, 'bitcoin')).toEqual([])
    })

    it('basarisiz/bos yanitta bos dizi doner', async () => {
        axios.post.mockResolvedValue({ status: 200, data: { success: false } })
        expect(await fetchPriceHistory(API, 'bitcoin')).toEqual([])

        axios.post.mockResolvedValue({ status: 500, data: {} })
        expect(await fetchPriceHistory(API, 'bitcoin')).toEqual([])
    })

    // 4. parametre `locale`: eski cagiranlarin (gun sayisi disinda hicbir sey vermeyen) imzasi bozulmaz.
    it("locale 4. arguman: tarih etiketi o dilde yazilir, istek govdesi degismez (usd)", async () => {
        const ms = 1700000000000
        axios.post.mockResolvedValue({ status: 200, data: { success: true, prices: [[ms, 2]] } })

        const points = await fetchPriceHistory(API, 'bitcoin', 30, 'de')

        expect(points[0].date).toBe(new Date(ms).toLocaleDateString('de'))
        expect(axios.post.mock.calls[0][1]).toEqual({ id: 'bitcoin', days: 30, currency: 'usd' })
    })
})

// Bosluklu biciler dilde nbsp (U+00A0) / dar nbsp (U+202F) kullanir: duz boslukla karsilastirilir.
const norm = (s) => (typeof s === 'string' ? s.replace(/[  ]/g, ' ') : s)

describe('fetchPriceSeries', () => {
    it("istekte currency gonderir ve yanittaki currency'yi dondurur", async () => {
        axios.post.mockResolvedValue({ status: 200, data: { success: true, currency: 'try', prices: [[1, 40], [2, 41]] } })

        const seri = await fetchPriceSeries(API, 'bitcoin', 90, 'try')

        expect(axios.post).toHaveBeenCalledWith(
            API + '/getTokenPriceHistory',
            { id: 'bitcoin', days: 90, currency: 'try' },
            expect.anything()
        )
        expect(seri.currency).toBe('try')
        expect(seri.points.map(p => p.close)).toEqual([40, 41])
    })

    // 13 nadir birimde (ron kes cop pen ...) CoinGecko'da seri olmadigi icin sunucu USD doner.
    it('ron istendi, yanit usd -> { currency: "usd" } (etiket USD olur)', async () => {
        axios.post.mockResolvedValue({ status: 200, data: { success: true, currency: 'usd', prices: [[1, 2]] } })

        const seri = await fetchPriceSeries(API, 'bitcoin', 30, 'ron')

        expect(axios.post.mock.calls[0][1].currency).toBe('ron')
        expect(seri.currency).toBe('usd')
        expect(seri.points).toHaveLength(1)
    })

    it('yanittaki currency buyuk harfle gelse de kucuge iner', async () => {
        axios.post.mockResolvedValue({ status: 200, data: { success: true, currency: 'EUR', prices: [[1, 2]] } })
        expect((await fetchPriceSeries(API, 'bitcoin', 30, 'eur')).currency).toBe('eur')
    })

    // BS2: `currency` alanindan ONCEKI sunucu istegin birimini yok sayip USD seri verir. Istenen
    // birim varsayilirsa USD sayi secili birimin sembolu ("₺1.02") ile yazilirdi.
    it("yanit currency tasimiyorsa ya da gecersizse seri USD sayilir (istenen birim DEGIL)", async () => {
        axios.post.mockResolvedValue({ status: 200, data: { success: true, prices: [[1, 2]] } })
        expect((await fetchPriceSeries(API, 'bitcoin', 30, 'try')).currency).toBe('usd')

        for (const gecersiz of [5, null, '', '   ', {}, []]) {
            axios.post.mockResolvedValue({ status: 200, data: { success: true, currency: gecersiz, prices: [[1, 2]] } })
            expect((await fetchPriceSeries(API, 'bitcoin', 30, 'eur')).currency).toBe('usd')
        }
    })

    it("eski sunucu (currency alani yok, USD seri) + TRY gorunum: ipucu 'USD' koduyla yazilir, '₺' ile degil", async () => {
        axios.post.mockResolvedValue({ status: 200, data: { success: true, prices: [[1, 1.02]] } })

        const seri = await fetchPriceSeries(API, 'bitcoin', 30, 'try')
        const etiket = norm(chartTooltipLabel(seri.points[0].close, {
            seriesCurrency: seri.currency,
            display: { code: 'try', rate: 40, fellBack: false },
            locale: 'en',
        }))

        expect(etiket).toContain('USD')
        expect(etiket).not.toContain('₺')
    })

    it('currency verilmezse usd istenir ve usd doner', async () => {
        axios.post.mockResolvedValue({ status: 200, data: { success: true, prices: [[1, 2]] } })

        const seri = await fetchPriceSeries(API, 'bitcoin')

        expect(axios.post.mock.calls[0][1]).toEqual({ id: 'bitcoin', days: 30, currency: 'usd' })
        expect(seri.currency).toBe('usd')
    })

    it('istenen birim buyuk harfle gelse de istege kucuk harf gider', async () => {
        axios.post.mockResolvedValue({ status: 200, data: { success: true, prices: [[1, 2]] } })
        await fetchPriceSeries(API, 'bitcoin', 30, 'TRY')
        expect(axios.post.mock.calls[0][1].currency).toBe('try')
    })

    it('hata / bozuk govde -> { points: [], currency: istenen }, atmaz', async () => {
        const uyari = vi.spyOn(console, 'warn').mockImplementation(() => {})
        axios.post.mockRejectedValue(new Error('network down'))
        await expect(fetchPriceSeries(API, 'bitcoin', 30, 'try')).resolves.toEqual({ points: [], currency: 'try' })

        axios.post.mockResolvedValue({ status: 200, data: { success: false } })
        await expect(fetchPriceSeries(API, 'bitcoin', 30, 'try')).resolves.toEqual({ points: [], currency: 'try' })

        axios.post.mockResolvedValue({ status: 500, data: {} })
        await expect(fetchPriceSeries(API, 'bitcoin', 30, 'try')).resolves.toEqual({ points: [], currency: 'try' })

        axios.post.mockResolvedValue({ status: 200 })
        await expect(fetchPriceSeries(API, 'bitcoin', 30, 'try')).resolves.toEqual({ points: [], currency: 'try' })

        // Govde basarili gorunup fiyat dizisi bozuksa da hata yolu sayilir: istenen birim doner.
        axios.post.mockResolvedValue({ status: 200, data: { success: true, currency: 'usd', prices: 'nope' } })
        await expect(fetchPriceSeries(API, 'bitcoin', 30, 'try')).resolves.toEqual({ points: [], currency: 'try' })

        // Ag hatasi uyari yazar (sessiz yutulmaz) ama atmaz.
        expect(uyari).toHaveBeenCalledTimes(1)
        uyari.mockRestore()
    })

    it('basarili ama bos fiyat dizisi: nokta yok, yanittaki birim korunur', async () => {
        axios.post.mockResolvedValue({ status: 200, data: { success: true, currency: 'usd', prices: [] } })
        await expect(fetchPriceSeries(API, 'bitcoin', 30, 'ron')).resolves.toEqual({ points: [], currency: 'usd' })
    })

    it('kimlik / api yoksa istek atmaz ve istenen birimi dondurur', async () => {
        expect(await fetchPriceSeries(API, null, 30, 'try')).toEqual({ points: [], currency: 'try' })
        expect(await fetchPriceSeries(API, '', 30, 'try')).toEqual({ points: [], currency: 'try' })
        expect(await fetchPriceSeries('', 'bitcoin', 30, 'try')).toEqual({ points: [], currency: 'try' })
        expect(axios.post).not.toHaveBeenCalled()
    })

    // 5. parametre `locale`: yalniz tarih etiketini etkiler; sunucuya giden istek ve birim ayni kalir.
    it("locale 5. arguman: points[].date o dilin bicimindedir, istek govdesi ve birim degismez", async () => {
        const ms = 1700000000000
        axios.post.mockResolvedValue({ status: 200, data: { success: true, currency: 'usd', prices: [[ms, 2]] } })

        const seri = await fetchPriceSeries(API, 'bitcoin', 30, 'usd', 'de')

        expect(seri.points[0].date).toBe(new Date(ms).toLocaleDateString('de'))
        expect(seri.points[0].date).not.toBe(new Date(ms).toLocaleDateString('en-US'))
        expect(seri.currency).toBe('usd')
        expect(axios.post.mock.calls[0][1]).toEqual({ id: 'bitcoin', days: 30, currency: 'usd' })
    })

    it('locale verilmezse tarih etiketi eski davranista (sistem dili) kalir', async () => {
        const ms = 1700000000000
        axios.post.mockResolvedValue({ status: 200, data: { success: true, prices: [[ms, 2]] } })
        const seri = await fetchPriceSeries(API, 'bitcoin')
        expect(seri.points[0].date).toBe(new Date(ms).toLocaleDateString())
    })

    it('fetchPriceHistory eski imza: dizi doner (geri uyum)', async () => {
        axios.post.mockResolvedValue({ status: 200, data: { success: true, currency: 'usd', prices: [[1, 2], [3, 4]] } })

        const points = await fetchPriceHistory(API, 'bitcoin', 7)

        expect(Array.isArray(points)).toBe(true)
        expect(points.map(p => p.close)).toEqual([2, 4])
        expect(axios.post.mock.calls[0][1]).toEqual({ id: 'bitcoin', days: 7, currency: 'usd' })
    })
})

describe('chartTooltipLabel', () => {
    const TRY = { code: 'try', rate: 40, fellBack: false }
    const USD = { code: 'usd', rate: 1, fellBack: false }

    it('seri secili birimdeyse sembolle yazar', () => {
        expect(norm(chartTooltipLabel(1234.5, { seriesCurrency: 'try', display: TRY, locale: 'tr' }))).toBe('₺1.234,50')
        expect(chartTooltipLabel(1234.5, { seriesCurrency: 'usd', display: USD, locale: 'en' })).toBe('$1,234.50')
    })

    it("seri usd'ye dusmus (13 nadir birim) -> kod etiketli 'USD ...'", () => {
        const ron = { code: 'ron', rate: 4.6, fellBack: false }
        expect(norm(chartTooltipLabel(12.34, { seriesCurrency: 'usd', display: ron, locale: 'en' }))).toBe('USD 12.34')
    })

    it("kur yok, gorunum usd'ye dusmus (fellBack) -> sembol degil kod", () => {
        const dusmus = { code: 'usd', rate: 1, fellBack: true, requested: 'try' }
        expect(norm(chartTooltipLabel(12.34, { seriesCurrency: 'usd', display: dusmus, locale: 'en' }))).toBe('USD 12.34')
    })

    it('seri birimi buyuk harfle gelse de ayni sayilir', () => {
        expect(norm(chartTooltipLabel(1, { seriesCurrency: 'TRY', display: TRY, locale: 'tr' }))).toBe('₺1,00')
    })

    it('kucuk fiyat price stilinde sifira yuvarlanmaz', () => {
        expect(chartTooltipLabel(0.000008, { seriesCurrency: 'usd', display: USD, locale: 'en' })).toBe('$0.000008')
    })

    it('display verilmezse USD gibi calisir; gecersiz deger atmaz, bos metin doner', () => {
        expect(chartTooltipLabel(2, { seriesCurrency: 'usd', locale: 'en' })).toBe('$2.00')
        expect(chartTooltipLabel(NaN, { seriesCurrency: 'usd', display: USD, locale: 'en' })).toBe('')
        expect(chartTooltipLabel(null, { seriesCurrency: 'usd', display: USD, locale: 'en' })).toBe('')
    })
})
