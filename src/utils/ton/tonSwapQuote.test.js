import { describe, it, expect, vi } from 'vitest'
import {
    getTonSwapQuote, isQuoteFresh, QUOTE_MAX_AGE_MS, DEFAULT_SLIPPAGE,
} from './tonSwapQuote'

// AG YOK: fetchImpl disaridan verilir. Sunucu tarafinda da AYNI desen
// (server/controllers/tonController.js createTonSwapQuote).
const OFFER = 'EQBnGWMCf3-FZZq1W4IWcWiGAc3PHuZ0_H-7sad2oY00o83S'   // pTON v2
const ASK = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs'     // USDT
const ROUTER = 'EQByADL5Ra2dldrMSBctgfSm2X2W1P61NVW2RYDb8eJNJGx6'
const POOL = 'EQBOdxSlGhjxjVYVwi6blHxfS1tWsOXesMrA1npnuiWeOKgI'

// Sunucunun GERCEK yanit sekli (tonSwapQuote.test.js sunucu tarafi bunu kilitliyor).
const SERVER_QUOTE = {
    success: true,
    quote: {
        offerUnits: '1000000000',
        askUnits: '1451066',
        // BILEREK floor(askUnits * 0.99) DEGIL (o 1436555 ederdi).
        //
        // MUTASYON BOSLUGU: fixture ilk yazimda gercek API yanitindaki degeri
        // tasiyordu ve o deger TAM OLARAK floor(askUnits * 0.99) idi. Sonuc:
        // "minAskUnits'i istemcide hesapla" mutasyonu AYNI sayiyi uretiyor ve
        // hicbir test dusmuyordu - yani dosyanin EN ONEMLI kurali test edilmemis
        // oluyordu. Ayni sinif tuzak P2'de yasandi (altin vektorlerdeki miktarlar
        // kayan nokta hatasini tesadufen tetiklemiyordu).
        //
        // Turetilemeyecek bir deger kullanmak, "sunucudan GELDIGI GIBI gecer"
        // sozlesmesini gercekten olcer.
        minAskUnits: '1400000',
        poolAddress: POOL,
        priceImpact: 0.000000349,
        feeUnits: '4372',
        router: {
            address: ROUTER,
            majorVersion: 2,
            minorVersion: 2,
            routerType: 'ConstantProduct',
            ptonMasterAddress: OFFER,
        },
    },
}

const okFetch = (payload = SERVER_QUOTE, status = 200) => vi.fn(async () => ({
    ok: status < 400,
    status,
    json: async () => payload,
}))

const BASE = {
    apiBase: 'https://api.test',
    offerAddress: OFFER,
    askAddress: ASK,
    units: '1000000000',
}

const without = (path) => {
    const q = { ...SERVER_QUOTE.quote }
    if (path.includes('.')) {
        const [a, b] = path.split('.')
        q[a] = { ...q[a] }
        delete q[a][b]
    } else {
        delete q[path]
    }
    return { success: true, quote: q }
}

describe('getTonSwapQuote — mutlu yol', () => {
    it('sunucu yanitini normalize eder', async () => {
        const q = await getTonSwapQuote({ ...BASE, fetchImpl: okFetch() })
        expect(q.askUnits).toBe('1451066')
        expect(q.minAskUnits).toBe('1400000')
        expect(q.poolAddress).toBe(POOL)
        expect(q.feeUnits).toBe('4372')
        expect(q.priceImpact).toBe(0.000000349)
    })

    // Teklif HANGI CIFT ICIN alindigini tasimali: tonSwap.js gonderim oncesi
    // bunlarin gonderilen varliklarla eslesmesini SART kosuyor. Kullanici teklifi
    // aldiktan sonra token degistirirse, eski teklifin minAskUnits'i BASKA BIR
    // CIFT icin hesaplanmistir.
    it('teklif HANGI CIFT icin alindigini tasir', async () => {
        const q = await getTonSwapQuote({ ...BASE, fetchImpl: okFetch() })
        expect(q.offerAddress).toBe(OFFER)
        expect(q.askAddress).toBe(ASK)
    })

    // routerFactory dogru SOZLESME SINIFINI secmek icin surume ve tipe ihtiyac
    // duyar. Ciplak adres yetmez: v1 ve v2 FARKLI alan duzeni kullaniyor
    // (docs/superpowers/notes/2026-08-26-stonfi-dogrulama.md §1).
    it('router SURUMUYLE BIRLIKTE tasinir - ciplak adres degil', async () => {
        const q = await getTonSwapQuote({ ...BASE, fetchImpl: okFetch() })
        expect(q.router).toEqual({
            address: ROUTER, majorVersion: 2, minorVersion: 2,
            routerType: 'ConstantProduct', ptonMasterAddress: OFFER,
        })
    })

    // Bu testin TEK isi: minAskUnits'in TURETILMEDIGINI, oldugu gibi gectigini
    // kanitlamak. Sunucu ne derse o - askUnits ile arasinda hicbir aritmetik
    // iliski varsayilmiyor.
    it('minAskUnits sunucudan GELDIGI GIBI gecer - TURETILMEZ', async () => {
        const weird = { success: true, quote: { ...SERVER_QUOTE.quote, minAskUnits: '7' } }
        const q = await getTonSwapQuote({ ...BASE, fetchImpl: okFetch(weird) })
        expect(q.minAskUnits).toBe('7')
    })

    // Kayma degistirilse bile minAskUnits DEGISMEZ: o deger sunucunun, bizim
    // hesabimizin degil.
    it('kayma degisse de minAskUnits AYNI kalir', async () => {
        const a = await getTonSwapQuote({ ...BASE, slippage: 0.01, fetchImpl: okFetch() })
        const b = await getTonSwapQuote({ ...BASE, slippage: 0.30, fetchImpl: okFetch() })
        expect(a.minAskUnits).toBe(b.minAskUnits)
    })

    // Tazelik kapisi (Gorev 7) buna bakar: teklif eskiyse kullanicinin GORDUGU
    // fiyatla zincire GIDEN fiyat ayrisir.
    it('teklif ZAMAN DAMGASI tasir', async () => {
        const before = Date.now()
        const q = await getTonSwapQuote({ ...BASE, fetchImpl: okFetch() })
        expect(q.fetchedAt).toBeGreaterThanOrEqual(before)
        expect(q.fetchedAt).toBeLessThanOrEqual(Date.now())
    })

    it('istek sunucu ucuna DOGRU govdeyle gider', async () => {
        const fetchImpl = okFetch()
        await getTonSwapQuote({ ...BASE, slippage: 0.02, fetchImpl })
        const [url, init] = fetchImpl.mock.calls[0]
        expect(url).toBe('https://api.test/ton/swap/simulate')
        expect(init.method).toBe('POST')
        expect(JSON.parse(init.body)).toEqual({
            offerAddress: OFFER, askAddress: ASK,
            units: '1000000000', slippageTolerance: 0.02,
        })
    })

    it('kayma verilmezse VARSAYILAN gider', async () => {
        const fetchImpl = okFetch()
        await getTonSwapQuote({ ...BASE, fetchImpl })
        expect(JSON.parse(fetchImpl.mock.calls[0][1].body).slippageTolerance).toBe(DEFAULT_SLIPPAGE)
    })
})

describe('getTonSwapQuote — eksik alan', () => {
    // KAYMA KORUMASI budur ve istemcide YENIDEN HESAPLANMAZ. Saglayicinin havuz
    // matematigini taklit etmek, iki degerin ayrismasi ve AYRISAN DEGERIN zincire
    // gitmesi demektir.
    it('minAskUnits eksikse HATA atar - hesaplamaya CALISMAZ', async () => {
        await expect(getTonSwapQuote({ ...BASE, fetchImpl: okFetch(without('minAskUnits')) }))
            .rejects.toThrow('TON_SWAP_QUOTE_FAILED')
    })

    it('askUnits eksikse HATA atar', async () => {
        await expect(getTonSwapQuote({ ...BASE, fetchImpl: okFetch(without('askUnits')) }))
            .rejects.toThrow('TON_SWAP_QUOTE_FAILED')
    })

    it('router adresi eksikse HATA atar', async () => {
        await expect(getTonSwapQuote({ ...BASE, fetchImpl: okFetch(without('router.address')) }))
            .rejects.toThrow('TON_SWAP_QUOTE_FAILED')
    })

    // Surum olmadan routerFactory dogru sinifi secemez; v1 mesaji v2 router'a
    // (ya da tersi) gonderilir ve islem duser.
    it('router SURUMU eksikse HATA atar', async () => {
        await expect(getTonSwapQuote({ ...BASE, fetchImpl: okFetch(without('router.majorVersion')) }))
            .rejects.toThrow('TON_SWAP_QUOTE_FAILED')
    })

    it('router nesnesi hic yoksa HATA atar', async () => {
        await expect(getTonSwapQuote({ ...BASE, fetchImpl: okFetch(without('router')) }))
            .rejects.toThrow('TON_SWAP_QUOTE_FAILED')
    })
})

describe('getTonSwapQuote — hata yollari', () => {
    // Rota yoklugu bir HATA DEGIL, bir CEVAPTIR. "baglantinizi kontrol edin"
    // demek gercek sebebi gizler ve kullanici var olmayan bir havuzu arar.
    it('rota yoksa AYRI anahtar atar', async () => {
        const fetchImpl = okFetch({ success: false, code: 'TON_SWAP_NO_ROUTE' }, 404)
        await expect(getTonSwapQuote({ ...BASE, fetchImpl }))
            .rejects.toThrow('TON_SWAP_NO_ROUTE')
    })

    it('sunucu 502 verirse QUOTE_FAILED atar', async () => {
        const fetchImpl = okFetch({ success: false, code: 'TON_SWAP_QUOTE_FAILED' }, 502)
        await expect(getTonSwapQuote({ ...BASE, fetchImpl }))
            .rejects.toThrow('TON_SWAP_QUOTE_FAILED')
    })

    // Ag hatasi HAM SIZMAZ: hata sozlesmemiz makine-okunur anahtarlardir,
    // ham fetch mesaji degil (arayuz eslemesi ancak anahtari cevirebilir).
    it('ag hatasi HAM SIZMAZ, anahtara cevrilir', async () => {
        const fetchImpl = vi.fn(async () => { throw new Error('ECONNREFUSED 1.2.3.4:443') })
        await expect(getTonSwapQuote({ ...BASE, fetchImpl }))
            .rejects.toThrow('TON_SWAP_QUOTE_FAILED')
    })

    it('bozuk JSON de anahtara cevrilir', async () => {
        const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json') } }))
        await expect(getTonSwapQuote({ ...BASE, fetchImpl }))
            .rejects.toThrow('TON_SWAP_QUOTE_FAILED')
    })

    it('apiBase yoksa ZINCIRE HIC CIKMADAN durur', async () => {
        const fetchImpl = vi.fn()
        await expect(getTonSwapQuote({ ...BASE, apiBase: '', fetchImpl }))
            .rejects.toThrow('TON_API_BASE_MISSING')
        expect(fetchImpl).not.toHaveBeenCalled()
    })
})

describe('isQuoteFresh', () => {
    // Teklif bayatsa kullanicinin GORDUGU fiyatla zincire GIDEN fiyat ayrisir.
    it('taze teklif GECER', () => {
        expect(isQuoteFresh({ fetchedAt: Date.now() })).toBe(true)
    })

    it('bayat teklif GECMEZ', () => {
        expect(isQuoteFresh({ fetchedAt: Date.now() - QUOTE_MAX_AGE_MS - 1 })).toBe(false)
    })

    // TAM SINIRDA gecer: sinir DEGERI degil, ASILMASI reddediliyor
    // (tonSendAmountFits / jettonSendFits ile AYNI karar).
    it('tam sinirda GECER', () => {
        const now = Date.now()
        expect(isQuoteFresh({ fetchedAt: now - QUOTE_MAX_AGE_MS }, now)).toBe(true)
    })

    // Zaman damgasi olmayan teklif GUVENILMEZ: ne zaman alindigini bilmiyoruz.
    // Burada guvenli yon REDDETMEKTIR - bayat fiyatla imzalamak, kullanicinin
    // gordugunden baska bir fiyatla takas yapmasi demek.
    it('zaman damgasiz teklif GECMEZ', () => {
        expect(isQuoteFresh({})).toBe(false)
        expect(isQuoteFresh(null)).toBe(false)
        expect(isQuoteFresh({ fetchedAt: 'dun' })).toBe(false)
    })

    // Gelecege ait zaman damgasi bozuk bir saat ya da kurcalanmis veri demektir;
    // "sonsuza kadar taze" saymak kapiyi tumden devre disi birakirdi.
    it('GELECEK zaman damgasi GECMEZ', () => {
        expect(isQuoteFresh({ fetchedAt: Date.now() + 60_000 })).toBe(false)
    })
})
