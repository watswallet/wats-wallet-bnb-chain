// utils/defaultTokenSeed.js -- varsayilan tokenlarin TEK kurali ve TEK yazicisi.
//
// KOK NEDEN (kullanici raporu: "yeni import edilen cuzdanda hicbir token gelmiyor"):
// varsayilanlar (ETH+USDT / ATS+BNB) yalniz App.vue acilisinda, `!imported_tokens[hesap]`
// kapisiyla tohumlaniyordu. Home.vue'nun TON tohumu (ensureTonNativeToken) bos kovayi
// `{'-239':[GRAM]}` olarak YARATIP diske yazinca kapi KALICI olarak kapaniyordu.
// Yan panelde App yeniden kurulmadigi icin Ekle > import > Home yolunda hic tohumlanmiyordu.
//
// Bu dosya kuralin kendisini ve yazicinin sozlesmesini kilitler. Sahte `chrome.storage`
// GERCEK davranisi taklit eder: get/set DERIN KOPYA verir/alir. Nesneyi paylasan bir
// sahte, "okudugum nesneyi yerinde degistirdim" hatalarini SESSIZCE gizlerdi.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const axiosGetMock = vi.fn()
vi.mock('axios', () => ({
    default: { get: (...args) => axiosGetMock(...args) },
}))

import {
    bucketNeedsDefaults, ensureDefaultTokens, resetDefaultTokenSeed,
    DEFAULT_TOKENS_RETRY_MS, SEED_STATUS,
} from './defaultTokenSeed'

const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)))

/**
 * Gercek chrome.storage.local gibi: get/set derin kopya, olmayan anahtar yanitta YOK.
 * `store` canli depodur: testin "baska bir baglam arada yazdi" simulasyonu icin.
 */
function installStorage(initial = {}) {
    const store = clone(initial)
    const log = { sets: [] }

    globalThis.chrome = {
        storage: {
            local: {
                get: async (keys) => {
                    const wanted = keys === undefined
                        ? Object.keys(store)
                        : (Array.isArray(keys) ? keys : [keys])
                    const out = {}
                    for (const k of wanted) if (k in store) out[k] = clone(store[k])
                    return out
                },
                set: async (obj) => {
                    log.sets.push(clone(obj))
                    Object.assign(store, clone(obj))
                },
            },
        },
    }

    return { store, log }
}

const img = { thumb: 't', small: 's', large: 'l' }

// /getImportedTokens'in GERCEK satir bicimi (server LIST_FIELDS + `_id`).
const ETH = { _id: 'e1', name: 'Ethereum', symbol: 'eth', address: '0x0000000000000000000000000000000000000000', chain: 'ethereum', decimals: 18, coingecko_id: 'ethereum', image: img, marketcap_rank: 2 }
const USDT = { _id: 'e2', name: 'Tether', symbol: 'usdt', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', chain: 'ethereum', decimals: 6, coingecko_id: 'tether', image: img, marketcap_rank: 3 }
const ATS = { _id: 'b1', name: 'Alltoscan', symbol: 'ats', address: '0x75D8BB7fBd4782a134211dc350Ba5c715197B81d', chain: 'binance-smart-chain', decimals: 18, coingecko_id: 'alltoscan', image: img }
const BNB = { _id: 'b2', name: 'BNB', symbol: 'bnb', address: '0x0000000000000000000000000000000000000000', chain: 'binance-smart-chain', decimals: 18, coingecko_id: 'binancecoin', image: img, marketcap_rank: 4 }

// Home.vue'nun TON tohumunun yazdigi satir (utils/ton/tonTokenSeed.js).
const GRAM = { name: 'GRAM', symbol: 'GRAM', address: '0x0', decimals: 9, coingecko_id: 'the-open-network', id: 'the-open-network', chainId: -239 }
const USER_USDC = { name: 'USD Coin', symbol: 'usdc', address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18, coingecko_id: 'usd-coin', image: img }

const SERVER_DEFAULTS = { 1: [ETH, USDT], 56: [ATS, BNB] }
const serverOk = (importedTokens = SERVER_DEFAULTS) => ({ status: 200, data: { success: true, importedTokens } })

beforeEach(() => {
    // Basarisizlik onbellegi modul duzeyinde ve ayni hesap anahtari ('acc1') testler arasinda
    // tekrar kullaniliyor: sifirlanmazsa onceki testin hatasi sonrakini aga cikmadan keserdi.
    resetDefaultTokenSeed()
    axiosGetMock.mockReset()
    axiosGetMock.mockResolvedValue(serverOk())
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    delete globalThis.chrome
})

describe('bucketNeedsDefaults -- TEK kural: ne "1" ne "56" anahtari varsa varsayilan gerekir', () => {
    it.each([
        ['kova hic yok (undefined)', undefined, true],
        ['kova null', null, true],
        ['bos nesne', {}, true],
        // Kokun kendisi: ensureTonNativeToken kovayi bu bicimde YARATIR. Kovanin
        // VARLIGI sinyal olamaz -- bu kova var ama varsayilan yok.
        ["yalniz TON ('-239') satiri", { '-239': [GRAM] }, true],
        // CreateAccount'un eski cevrimdisi yolu `[hesap]: []` (DIZI) yaziyordu.
        ['hasarli dizi kovasi', [], true],
        ['yalniz Solana kovasi', { 'solana-mainnet': [{ address: 'So111' }] }, true],
        ["yalniz '1'", { 1: [ETH] }, false],
        ["yalniz '56'", { 56: [ATS] }, false],
        // Sunucu varsayilani HER ZAMAN iki anahtari da yaratir; token silmek de
        // anahtari BOSALTIR ama SILMEZ (SearchTokens.saveTokens `{[chainId]: []}` yazar).
        // Yani kullanici tum varsayilanlari silse de kova "saglikli"dir -- tekrar
        // tohumlamak onun KASITLI silmesini geri alirdi.
        ["'1':[] ve '56':[] (kullanici hepsini sildi)", { 1: [], 56: [] }, false],
        ["'1' + TON", { 1: [], '-239': [GRAM] }, false],
    ])('%s -> %s', (_ad, bucket, expected) => {
        expect(bucketNeedsDefaults(bucket)).toBe(expected)
    })
})

describe('ensureDefaultTokens -- saglikli kova', () => {
    it("'1':[] + '56':[] kovada AG ISTEGI YOK, yazim YOK, durum healthy", async () => {
        const { store, log } = installStorage({ imported_tokens: { acc1: { 1: [], 56: [] } } })

        const result = await ensureDefaultTokens('acc1')

        expect(result.status).toBe(SEED_STATUS.HEALTHY)
        expect(axiosGetMock).not.toHaveBeenCalled()
        expect(log.sets).toEqual([])
        expect(store.imported_tokens.acc1).toEqual({ 1: [], 56: [] })
    })
})

describe('ensureDefaultTokens -- tohumlama', () => {
    it('eksik kova: varsayilanlar TEK GET ile gelir, kova yazilir, durum seeded', async () => {
        const { store } = installStorage({ imported_tokens: {} })

        const result = await ensureDefaultTokens('acc1')

        expect(result.status).toBe(SEED_STATUS.SEEDED)
        expect(axiosGetMock).toHaveBeenCalledTimes(1)
        expect(store.imported_tokens.acc1).toEqual(SERVER_DEFAULTS)
    })

    // Dogrulama "toplam sifir satir"i reddeder; tek zincirde satir olmasi yeter.
    it('satirlar yalniz tek zincirde ({1:[ETH], 56:[]}) olsa da kullanilabilir: yazilir', async () => {
        axiosGetMock.mockResolvedValue(serverOk({ 1: [ETH], 56: [] }))
        const { store } = installStorage({ imported_tokens: {} })

        const result = await ensureDefaultTokens('acc1')

        expect(result.status).toBe(SEED_STATUS.SEEDED)
        expect(store.imported_tokens.acc1).toEqual({ 1: [ETH], 56: [] })
    })

    it('depoda imported_tokens HIC yoksa (Forgot password / sifirlama sonrasi) tohumlar', async () => {
        const { store } = installStorage({})

        const result = await ensureDefaultTokens('acc1')

        expect(result.status).toBe(SEED_STATUS.SEEDED)
        expect(store.imported_tokens).toEqual({ acc1: SERVER_DEFAULTS })
    })

    it("GRAM satirli hasarli kova ({'-239':[GRAM]}) iyilesir ve GRAM KORUNUR", async () => {
        const { store } = installStorage({ imported_tokens: { acc1: { '-239': [GRAM] } } })

        await ensureDefaultTokens('acc1')

        expect(store.imported_tokens.acc1).toEqual({ ...SERVER_DEFAULTS, '-239': [GRAM] })
    })

    it('hasarli DIZI kovasi nesneye cevrilir (dizi indeksleri anahtar OLMAZ)', async () => {
        const { store } = installStorage({ imported_tokens: { acc1: [] } })

        await ensureDefaultTokens('acc1')

        expect(Array.isArray(store.imported_tokens.acc1)).toBe(false)
        expect(store.imported_tokens.acc1).toEqual(SERVER_DEFAULTS)
    })

    // Birlestirme ANAHTAR BASINA ve MEVCUT KAZANIR. Sunucu ileride baska zincirler de
    // (burada '-239' ile temsil edilir) gonderirse kullanicinin kendi satirlari ezilmez.
    it('MEVCUT anahtar KAZANIR: sunucu ayni anahtari gonderse de depodaki satir ezilmez', async () => {
        const SERVER_GRAM = { ...GRAM, name: 'Toncoin (sunucu)', symbol: 'TON' }
        axiosGetMock.mockResolvedValue(serverOk({ ...SERVER_DEFAULTS, '-239': [SERVER_GRAM] }))
        const { store } = installStorage({ imported_tokens: { acc1: { '-239': [GRAM] } } })

        await ensureDefaultTokens('acc1')

        expect(store.imported_tokens.acc1['-239']).toEqual([GRAM])
        expect(store.imported_tokens.acc1[1]).toEqual([ETH, USDT])
        expect(store.imported_tokens.acc1[56]).toEqual([ATS, BNB])
    })

    // Istek suresince baska bir baglam (ImportToken, SearchTokens...) KENDI kovasina
    // yazmis olabilir: yazmadan hemen ONCE taze okunur ve kullanicinin satiri korunur.
    it("istek suresince kullanici '56'ya token eklediyse o satir KORUNUR (mevcut kazanir)", async () => {
        const { store } = installStorage({ imported_tokens: { acc1: { '-239': [GRAM] } } })
        axiosGetMock.mockImplementation(async () => {
            store.imported_tokens.acc1 = { '-239': [GRAM], 56: [USER_USDC] }
            return serverOk()
        })

        await ensureDefaultTokens('acc1')

        expect(store.imported_tokens.acc1[56]).toEqual([USER_USDC])
        expect(store.imported_tokens.acc1[1]).toEqual([ETH, USDT])
        expect(store.imported_tokens.acc1['-239']).toEqual([GRAM])
    })

    // Bayat anlik goruntuden TUM haritayi yazmak (App.vue ve CreateAccount.vue'nun
    // eski davranisi) arada yapilan baska yazimlari SESSIZCE geri alir.
    it('YALNIZ hedef hesabin kovasi yazilir; istek suresince degisen DIGER hesaplar EZILMEZ', async () => {
        const { store } = installStorage({
            imported_tokens: {
                acc1: { '-239': [GRAM] },
                acc2: { 1: [ETH] },
            },
        })
        axiosGetMock.mockImplementation(async () => {
            // Baska bir baglam istek sirasinda: acc2'ye token ekledi, acc3 yarati.
            store.imported_tokens.acc2 = { 1: [ETH, USER_USDC] }
            store.imported_tokens.acc3 = { 56: [BNB] }
            return serverOk()
        })

        await ensureDefaultTokens('acc1')

        expect(store.imported_tokens.acc2).toEqual({ 1: [ETH, USER_USDC] })
        expect(store.imported_tokens.acc3).toEqual({ 56: [BNB] })
        expect(store.imported_tokens.acc1).toEqual({ ...SERVER_DEFAULTS, '-239': [GRAM] })
    })

    it('yazma aninda depo bosalmissa (istek suresince sifirlama) yine yalniz o hesabi yazar', async () => {
        const { store } = installStorage({ imported_tokens: { acc1: {} } })
        axiosGetMock.mockImplementation(async () => {
            delete store.imported_tokens
            return serverOk()
        })

        await ensureDefaultTokens('acc1')

        expect(store.imported_tokens).toEqual({ acc1: SERVER_DEFAULTS })
    })

    it('istek suresince baska bir baglam kovayi zaten iyilestirdiyse YAZMAZ (durum healthy)', async () => {
        const { store, log } = installStorage({ imported_tokens: {} })
        axiosGetMock.mockImplementation(async () => {
            store.imported_tokens.acc1 = { 1: [ETH, USDT], 56: [ATS, BNB], '-239': [GRAM] }
            return serverOk()
        })

        const result = await ensureDefaultTokens('acc1')

        expect(result.status).toBe(SEED_STATUS.HEALTHY)
        expect(log.sets).toEqual([])
    })
})

describe('ensureDefaultTokens -- hata yollari: HICBIR sey yazilmaz, firlatmaz, sonraki yukleme tekrar dener', () => {
    const FAILURES = [
        ['ag hatasi', () => { axiosGetMock.mockRejectedValue(new Error('Network Error')) }],
        ['zaman asimi (ECONNABORTED)', () => {
            axiosGetMock.mockRejectedValue(Object.assign(new Error('timeout of 8000ms exceeded'), { code: 'ECONNABORTED' }))
        }],
        ['5xx', () => { axiosGetMock.mockRejectedValue(Object.assign(new Error('Request failed with status code 500'), { response: { status: 500 } })) }],
        // Home testlerinin axios sahtesi her GET'e bunu doner.
        ['{news: []} bicimli govde', () => { axiosGetMock.mockResolvedValue({ status: 200, data: { news: [] } }) }],
        ['data yok', () => { axiosGetMock.mockResolvedValue({ status: 200 }) }],
        ['data null', () => { axiosGetMock.mockResolvedValue({ status: 200, data: null }) }],
        ['importedTokens null', () => { axiosGetMock.mockResolvedValue({ status: 200, data: { importedTokens: null } }) }],
        ['importedTokens DIZI', () => { axiosGetMock.mockResolvedValue({ status: 200, data: { importedTokens: [ETH] } }) }],
        ['importedTokens metin', () => { axiosGetMock.mockResolvedValue({ status: 200, data: { importedTokens: 'x' } }) }],
        ['importedTokens bos nesne', () => { axiosGetMock.mockResolvedValue({ status: 200, data: { importedTokens: {} } }) }],
        ["importedTokens '1' liste DEGIL", () => { axiosGetMock.mockResolvedValue({ status: 200, data: { importedTokens: { 1: 'x' } } }) }],
        // Kuralin aradigi iki anahtardan hicbiri yok: yazsak bile kova hala "bos" sayilirdi.
        ['importedTokens beklenen zincirleri icermiyor', () => { axiosGetMock.mockResolvedValue({ status: 200, data: { importedTokens: { 137: [] } } }) }],
        // Bos veritabani 200 doner: anahtarlar VAR ama TOPLAM sifir satir. Yazilirsa hesap
        // "saglikli ama bos" sayilip bir daha tohumlanmazdi (sunucu doldugunda bile).
        ['importedTokens TOPLAM sifir satir ({1:[],56:[]}): bos veritabani', () => { axiosGetMock.mockResolvedValue({ status: 200, data: { importedTokens: { 1: [], 56: [] } } }) }],
        // Satir baska bir zincirde: '1' ve '56' yine bos, yazilirsa hesap "saglikli ama varsayilansiz" olurdu.
        ['importedTokens yalniz baska zincirde satir tasiyor ({137:[x], 1:[], 56:[]})', () => { axiosGetMock.mockResolvedValue({ status: 200, data: { importedTokens: { 137: [USDT], 1: [], 56: [] } } }) }],
        ['axios.get fonksiyon degil', () => { axiosGetMock.mockImplementation(() => { throw new TypeError('axios.get is not a function') }) }],
    ]

    it.each(FAILURES)('%s', async (_ad, arrange) => {
        const { store, log } = installStorage({ imported_tokens: { acc1: { '-239': [GRAM] } } })
        arrange()

        const result = await ensureDefaultTokens('acc1')

        expect(result.status).toBe(SEED_STATUS.FAILED)
        expect(log.sets).toEqual([])
        expect(store.imported_tokens).toEqual({ acc1: { '-239': [GRAM] } })
    })

    it('imported_tokens hic yokken de basarisizlik HIC yazmaz (bos nesne bile)', async () => {
        const { store, log } = installStorage({})
        axiosGetMock.mockRejectedValue(new Error('Network Error'))

        const result = await ensureDefaultTokens('acc1')

        expect(result.status).toBe(SEED_STATUS.FAILED)
        expect(log.sets).toEqual([])
        expect('imported_tokens' in store).toBe(false)
    })

    it('depo yazimi reddedilirse de firlatmaz', async () => {
        installStorage({ imported_tokens: {} })
        globalThis.chrome.storage.local.set = async () => { throw new Error('QUOTA_BYTES quota exceeded') }

        await expect(ensureDefaultTokens('acc1')).resolves.toEqual(expect.objectContaining({ status: SEED_STATUS.FAILED }))
    })

    it('depo okumasi reddedilirse de firlatmaz ve ag istegi atmaz', async () => {
        installStorage({})
        globalThis.chrome.storage.local.get = async () => { throw new Error('Extension context invalidated') }

        await expect(ensureDefaultTokens('acc1')).resolves.toEqual(expect.objectContaining({ status: SEED_STATUS.FAILED }))
        expect(axiosGetMock).not.toHaveBeenCalled()
    })

    it('hesap anahtari yoksa ag istegi ve yazim YOK', async () => {
        const { log } = installStorage({ imported_tokens: {} })

        for (const bad of [undefined, null, '']) {
            const result = await ensureDefaultTokens(bad)
            expect(result.status).toBe(SEED_STATUS.FAILED)
        }
        expect(axiosGetMock).not.toHaveBeenCalled()
        expect(log.sets).toEqual([])
    })

    it('basarisizliktan sonra (onbellek suresi dolunca) cagri TEKRAR dener ve iyilestirir', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        const { store } = installStorage({ imported_tokens: { acc1: { '-239': [GRAM] } } })
        axiosGetMock.mockRejectedValueOnce(new Error('Network Error'))

        expect((await ensureDefaultTokens('acc1')).status).toBe(SEED_STATUS.FAILED)
        vi.setSystemTime(Date.now() + DEFAULT_TOKENS_RETRY_MS)
        expect((await ensureDefaultTokens('acc1')).status).toBe(SEED_STATUS.SEEDED)

        expect(axiosGetMock).toHaveBeenCalledTimes(2)
        expect(store.imported_tokens.acc1).toEqual({ ...SERVER_DEFAULTS, '-239': [GRAM] })
    })
})

describe('ensureDefaultTokens -- eszamanli cagrilar', () => {
    it('ayni hesap icin eszamanli cagrilar TEK ag istegine iner (App + Home ayni sayfada)', async () => {
        const { store } = installStorage({ imported_tokens: {} })
        let answer
        axiosGetMock.mockImplementation(() => new Promise((resolve) => { answer = resolve }))

        const first = ensureDefaultTokens('acc1')
        const second = ensureDefaultTokens('acc1')
        await vi.waitFor(() => expect(axiosGetMock).toHaveBeenCalledTimes(1))
        answer(serverOk())
        const [a, b] = await Promise.all([first, second])

        expect(axiosGetMock).toHaveBeenCalledTimes(1)
        expect(a.status).toBe(SEED_STATUS.SEEDED)
        expect(b.status).toBe(SEED_STATUS.SEEDED)
        expect(store.imported_tokens.acc1).toEqual(SERVER_DEFAULTS)
    })

    it('tamamlandiktan SONRA yeni cagri taze okur: kova artik saglikli, ag istegi YOK', async () => {
        installStorage({ imported_tokens: {} })

        await ensureDefaultTokens('acc1')
        const again = await ensureDefaultTokens('acc1')

        expect(again.status).toBe(SEED_STATUS.HEALTHY)
        expect(axiosGetMock).toHaveBeenCalledTimes(1)
    })

    it('FARKLI hesaplar birbirinin istegini paylasmaz ve ikisi de tohumlanir', async () => {
        const { store } = installStorage({ imported_tokens: {} })

        await Promise.all([ensureDefaultTokens('acc1'), ensureDefaultTokens('acc2')])

        expect(axiosGetMock).toHaveBeenCalledTimes(2)
        expect(Object.keys(store.imported_tokens).sort()).toEqual(['acc1', 'acc2'])
    })

    it('basarisiz bir cagri in-flight kaydini TEMIZLER (sonraki cagri takili kalmaz)', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        installStorage({ imported_tokens: {} })
        axiosGetMock.mockRejectedValueOnce(new Error('Network Error'))

        await ensureDefaultTokens('acc1')
        vi.setSystemTime(Date.now() + DEFAULT_TOKENS_RETRY_MS)
        const retry = await ensureDefaultTokens('acc1')

        expect(retry.status).toBe(SEED_STATUS.SEEDED)
    })
})

// API KESINTISI: hasarli bir hesapta her loadCurrentTokens (acilis, ag degisimi, hesap degisimi)
// ayni basarisiz istegi tekrarlar ve her seferinde en fazla 8 sn bekletirdi. Basarisizliktan
// sonra 60 sn boyunca hesap basina ag istegi atilmaz; kova yine de OKUNUR (iyilesmisse healthy).
// Saat: yalniz Date sahte (promise/mikro gorev akisi gercek kalir).
describe('ensureDefaultTokens -- basarisizlik onbellegi (60 sn)', () => {
    const T0 = Date.parse('2026-10-07T12:00:00.000Z')

    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(T0)
    })

    const down = () => axiosGetMock.mockRejectedValue(new Error('Network Error'))

    it('basarisizliktan sonra 60 sn icinde ikinci yukleme AGA CIKMAZ: failed hemen doner', async () => {
        installStorage({ imported_tokens: { acc1: { '-239': [GRAM] } } })
        down()

        const first = await ensureDefaultTokens('acc1')
        vi.setSystemTime(T0 + DEFAULT_TOKENS_RETRY_MS - 1)
        const second = await ensureDefaultTokens('acc1')

        expect(first.status).toBe(SEED_STATUS.FAILED)
        expect(second.status).toBe(SEED_STATUS.FAILED)
        expect(axiosGetMock).toHaveBeenCalledTimes(1)
    })

    it('60 sn dolunca TEKRAR dener; sunucu duzeldiyse tohumlar', async () => {
        const { store } = installStorage({ imported_tokens: { acc1: { '-239': [GRAM] } } })
        axiosGetMock.mockRejectedValueOnce(new Error('Network Error'))

        await ensureDefaultTokens('acc1')
        vi.setSystemTime(T0 + DEFAULT_TOKENS_RETRY_MS)
        const retry = await ensureDefaultTokens('acc1')

        expect(retry.status).toBe(SEED_STATUS.SEEDED)
        expect(axiosGetMock).toHaveBeenCalledTimes(2)
        expect(store.imported_tokens.acc1).toEqual({ ...SERVER_DEFAULTS, '-239': [GRAM] })
    })

    // Onbellekten donen cagri sureyi YENILEMEZ: yenileseydi yuklemeler surdukce pencere hic
    // kapanmaz ve hesap sunucu duzelse bile ASLA tekrar denenmezdi.
    it('onbellekten donen cagri 60 sn penceresini UZATMAZ', async () => {
        installStorage({ imported_tokens: { acc1: { '-239': [GRAM] } } })
        down()

        await ensureDefaultTokens('acc1')
        vi.setSystemTime(T0 + 30_000)
        await ensureDefaultTokens('acc1')
        vi.setSystemTime(T0 + 61_000)
        await ensureDefaultTokens('acc1')

        expect(axiosGetMock).toHaveBeenCalledTimes(2)
    })

    it('onbellek HESAP BASINA: bir hesabin hatasi digerinin istegini kesmez', async () => {
        installStorage({ imported_tokens: {} })
        axiosGetMock.mockRejectedValueOnce(new Error('Network Error'))

        const a = await ensureDefaultTokens('acc1')
        const b = await ensureDefaultTokens('acc2')

        expect(a.status).toBe(SEED_STATUS.FAILED)
        expect(b.status).toBe(SEED_STATUS.SEEDED)
        expect(axiosGetMock).toHaveBeenCalledTimes(2)
    })

    // Basari (ya da kovanin baska yoldan iyilesmesi) kaydi TEMIZLER: sonraki yeni hata yeniden
    // aga cikar, eski pencerenin icinde kalip susturulmaz.
    it('kova iyilesince onbellek kaydi temizlenir: sonraki yeni hata aga cikar', async () => {
        const { store } = installStorage({ imported_tokens: { acc1: {} } })
        down()

        expect((await ensureDefaultTokens('acc1')).status).toBe(SEED_STATUS.FAILED)
        expect(axiosGetMock).toHaveBeenCalledTimes(1)

        // Baska bir baglam (kullanici token ekledi) kovayi iyilestirdi: pencere ICINDE bile
        // gercek durum doner ve kayit silinir.
        store.imported_tokens.acc1 = { 1: [ETH] }
        expect((await ensureDefaultTokens('acc1')).status).toBe(SEED_STATUS.HEALTHY)
        expect(axiosGetMock).toHaveBeenCalledTimes(1)

        // Kova yeniden hasarli ve sunucu hala kapali: kayit silindigi icin YENIDEN denenir.
        store.imported_tokens.acc1 = {}
        expect((await ensureDefaultTokens('acc1')).status).toBe(SEED_STATUS.FAILED)
        expect(axiosGetMock).toHaveBeenCalledTimes(2)
    })

    it('basarili tohum onceki hata kaydini temizler', async () => {
        const { store } = installStorage({ imported_tokens: { acc1: {} } })
        axiosGetMock.mockRejectedValueOnce(new Error('Network Error'))

        await ensureDefaultTokens('acc1')
        vi.setSystemTime(T0 + DEFAULT_TOKENS_RETRY_MS)
        expect((await ensureDefaultTokens('acc1')).status).toBe(SEED_STATUS.SEEDED)

        // Saat geriye alindi (eski hatanin penceresi icinde) ve kova yeniden hasarli: temizlenmemis
        // bir kayit bu hatayi aga cikmadan keserdi.
        vi.setSystemTime(T0 + 5_000)
        store.imported_tokens.acc1 = {}
        down()
        expect((await ensureDefaultTokens('acc1')).status).toBe(SEED_STATUS.FAILED)
        expect(axiosGetMock).toHaveBeenCalledTimes(3)
    })

    // Saat sicramasi (NTP duzeltmesi, elle degisiklik): negatif sure "pencere icinde" SAYILMAZ,
    // aksi halde hesap saatlerce yeniden denenmezdi.
    it('saat geriye alinirsa (negatif sure) kayit gecersiz sayilir: hesap yeniden denenir', async () => {
        installStorage({ imported_tokens: { acc1: {} } })
        down()

        await ensureDefaultTokens('acc1')
        vi.setSystemTime(T0 - 3_600_000)
        await ensureDefaultTokens('acc1')

        expect(axiosGetMock).toHaveBeenCalledTimes(2)
    })

    it('resetDefaultTokenSeed onbellegi temizler (yalniz testler icin)', async () => {
        installStorage({ imported_tokens: { acc1: {} } })
        axiosGetMock.mockRejectedValueOnce(new Error('Network Error'))

        await ensureDefaultTokens('acc1')
        resetDefaultTokenSeed()

        expect((await ensureDefaultTokens('acc1')).status).toBe(SEED_STATUS.SEEDED)
    })
})

describe('ensureDefaultTokens -- ag istegi', () => {
    it('adres bos: yalniz /getImportedTokens, SINIRLI zaman asimi', async () => {
        installStorage({ imported_tokens: {} })

        await ensureDefaultTokens('acc1')

        const [url, config] = axiosGetMock.mock.calls[0]
        expect(url.endsWith('/getImportedTokens')).toBe(true)
        // Home acilisi bu cagriyi BEKLER: sinirsiz bir istek ana ekrani sonsuza dek
        // asili tutardi. Sinir ayni dosyalardaki gerekce ile (priceHistory.js: 8 sn).
        expect(config.timeout).toBeGreaterThan(0)
        expect(config.timeout).toBeLessThanOrEqual(10000)
    })

    // GIZLILIK KURALI: hesap adresleri bu cagriyla sunucumuza ulasmamali. Uc GET ve
    // govde yok; sorgu dizesi, params, headers ve govde TASINMAZ.
    it('hesap anahtari ya da adres istekle SUNUCUYA GITMEZ', async () => {
        const ADRES = '0xAbCdEf0000000000000000000000000000000001'
        installStorage({ imported_tokens: { [ADRES]: {}, 'hesap-anahtari-xyz': {} } })

        await ensureDefaultTokens('hesap-anahtari-xyz')

        expect(axiosGetMock.mock.calls).toHaveLength(1)
        const [url, config, ...rest] = axiosGetMock.mock.calls[0]
        expect(rest).toEqual([])
        expect(url).not.toContain('?')
        expect(url).not.toContain('hesap-anahtari-xyz')
        expect(url.toLowerCase()).not.toContain(ADRES.toLowerCase())
        expect(Object.keys(config)).toEqual(['timeout'])
    })
})
